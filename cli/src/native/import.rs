//! Session-bundle import: ingest a real browser's cookies + headers + UA + UA-CH
//! from a DevTools paste, cURL command, HAR file, or Playwright storage-state
//! JSON, normalise it, and persist a reusable bundle that the launch path can
//! apply atomically so a CloudFlare-protected origin keeps trusting the
//! captured `cf_clearance`.
//!
//! Why this exists: CloudFlare cookies only stay valid when the egress IP,
//! TLS fingerprint, UA, and UA-CH headers all match the browser that minted
//! them. We can't change the local Chromium's TLS stack, but if we replay UA
//! and every `sec-ch-ua-*` header exactly, and the user runs the agent on
//! the same machine, the cookie survives. This module is the ingestion side
//! of that contract.
//!
//! On-disk layout (under `~/.agent-browser/sessions/<name>/`):
//!   - `bundle.json` — manifest (UA, UA-CH, accept-language, origin, metadata)
//!   - `cookies.json` — cookie array (existing `parse_curl_cookies` shape)
//!   - `storage.json` — optional Playwright storage-state passthrough
//! All three honour `AGENT_BROWSER_ENCRYPTION_KEY` and are renamed with a
//! trailing `.enc` when encryption is active (mirrors `state.rs`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use crate::commands::{
    extract_cookie_header_from_curl, match_all_quoted_args, parse_cookie_header,
};

use super::cdp::client::CdpClient;
use super::cookies;
use super::network;
use super::state::{self, get_sessions_dir, StorageState};

pub const BUNDLE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
    Auto,
    DevTools,
    Curl,
    Har,
    StorageState,
}

impl SourceFormat {
    pub fn from_str(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "auto" | "" => Some(Self::Auto),
            "devtools" | "headers" => Some(Self::DevTools),
            "curl" => Some(Self::Curl),
            "har" => Some(Self::Har),
            "state" | "storage-state" | "storagestate" => Some(Self::StorageState),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::DevTools => "devtools",
            Self::Curl => "curl",
            Self::Har => "har",
            Self::StorageState => "storage-state",
        }
    }
}

/// Normalised result of importing one session, whatever the input format.
/// Field names are lower-case throughout (UA-CH header names, etc.) so the
/// stealth layer can look them up case-insensitively.
#[derive(Debug, Clone, Default)]
pub struct ImportedSession {
    pub source_format: Option<SourceFormat>,
    pub cookies: Vec<Value>,
    pub user_agent: Option<String>,
    pub ua_ch: BTreeMap<String, String>,
    pub accept_language: Option<String>,
    pub extra_headers: BTreeMap<String, String>,
    pub origin: Option<String>,
    pub storage_state: Option<StorageState>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub schema_version: u32,
    pub name: String,
    pub captured_at: u64,
    pub source_format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_chrome_full_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_chrome_major_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accept_language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub ua_ch: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra_headers: BTreeMap<String, String>,
    pub has_cookies: bool,
    pub has_storage_state: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

/// Auto-detect or parse with the explicit hint, returning a normalised
/// `ImportedSession`. The four code paths share the same bucketing helper so
/// new header names only need to be classified in one place.
pub fn parse_imported_session(raw: &str, hint: SourceFormat) -> Result<ImportedSession, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("input is empty — pipe DevTools headers, a cURL command, a HAR file, or a Playwright state JSON".to_string());
    }

    let format = match hint {
        SourceFormat::Auto => detect_format(trimmed),
        other => other,
    };

    let mut session = match format {
        SourceFormat::DevTools => parse_devtools(trimmed)?,
        SourceFormat::Curl => parse_curl(trimmed)?,
        SourceFormat::Har => parse_har(trimmed)?,
        SourceFormat::StorageState => parse_storage_state(trimmed)?,
        SourceFormat::Auto => unreachable!("Auto resolved above"),
    };
    session.source_format = Some(format);

    if !session.ua_ch.is_empty() && session.user_agent.is_none() {
        session.warnings.push(
            "no User-Agent header captured — UA derived from sec-ch-ua but origin may re-challenge".to_string(),
        );
    }
    if session.user_agent.is_some() && session.ua_ch.is_empty() {
        session.warnings.push(
            "no sec-ch-ua-* headers captured — CloudFlare may re-challenge if the origin issues Accept-CH".to_string(),
        );
    }

    Ok(session)
}

fn detect_format(trimmed: &str) -> SourceFormat {
    if trimmed.starts_with('{') {
        if trimmed.contains("\"log\"") && trimmed.contains("\"entries\"") {
            return SourceFormat::Har;
        }
        return SourceFormat::StorageState;
    }
    if trimmed.starts_with('[') {
        return SourceFormat::StorageState;
    }
    let head: String = trimmed.chars().take(5).collect::<String>().to_lowercase();
    if head.starts_with("curl")
        && head.len() > 4
        && head.chars().nth(4).is_some_and(|c| c.is_whitespace() || c == '\'' || c == '"')
    {
        return SourceFormat::Curl;
    }
    SourceFormat::DevTools
}

// ---------------------------------------------------------------------------
// DevTools "Headers panel" parser (alternating key/value lines)
// ---------------------------------------------------------------------------

fn parse_devtools(raw: &str) -> Result<ImportedSession, String> {
    let mut session = ImportedSession::default();
    let mut pseudo_authority: Option<String> = None;

    enum State {
        ExpectKey,
        ExpectValue(String),
    }
    let mut state = State::ExpectKey;

    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            // Blank line ends the headers block. Subsequent lines (request body,
            // for instance) are out of scope; bail out.
            break;
        }

        // HTTP/2 pseudo-headers (`:authority`, `:method`, etc.) — they always
        // appear on a single line OR as a key on one line + value on the next.
        // Handle both shapes.
        if line.starts_with(':') {
            if let Some(colon) = line[1..].find(':') {
                let name = line[..1 + colon].to_ascii_lowercase();
                let value = line[1 + colon + 1..].trim();
                if name == ":authority" {
                    pseudo_authority = Some(value.to_string());
                }
                state = State::ExpectKey;
            } else {
                state = State::ExpectValue(line.to_ascii_lowercase());
            }
            continue;
        }

        match std::mem::replace(&mut state, State::ExpectKey) {
            State::ExpectKey => {
                // "Name: value" on a single line — only treated as such when the
                // portion before the colon looks like an HTTP token (no spaces,
                // first char is not `;` or `,`). UA-CH values often contain
                // `;` and `,` inside quotes; the line-based parser leaves them
                // intact because we don't split on those characters.
                if let Some(colon) = line.find(':') {
                    let head = &line[..colon];
                    if !head.is_empty()
                        && head
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                    {
                        bucket_header(&mut session, head, line[colon + 1..].trim(), &mut pseudo_authority);
                        continue;
                    }
                }
                state = State::ExpectValue(line.trim().to_string());
            }
            State::ExpectValue(name) => {
                bucket_header(&mut session, &name, line.trim(), &mut pseudo_authority);
            }
        }
    }

    if session.origin.is_none() {
        if let Some(authority) = pseudo_authority {
            if !authority.is_empty() {
                session.origin = Some(format!("https://{}", authority));
            }
        }
    }

    Ok(session)
}

// ---------------------------------------------------------------------------
// cURL parser — extends parse_curl_cookies to also harvest UA + UA-CH
// ---------------------------------------------------------------------------

fn parse_curl(raw: &str) -> Result<ImportedSession, String> {
    let joined = raw
        .replace("\\\r\n", " ")
        .replace("\\\n", " ")
        .replace("^\r\n", " ")
        .replace("^\n", " ");

    let mut session = ImportedSession::default();
    let mut pseudo_authority: Option<String> = None;

    for header_line in match_all_quoted_args(&joined, "-H") {
        if let Some(colon) = header_line.find(':') {
            let name = header_line[..colon].trim();
            let value = header_line[colon + 1..].trim();
            if !name.is_empty() {
                bucket_header(&mut session, name, value, &mut pseudo_authority);
            }
        }
    }

    // Fall back to the existing Cookie-header extractors when no -H 'cookie:'
    // was emitted (some DevTools cURL exports use -b instead).
    if session.cookies.is_empty() {
        if let Some(header) = extract_cookie_header_from_curl(&joined) {
            if let Ok(cookies) = parse_cookie_header(&header) {
                session.cookies = cookies;
            }
        }
    }

    if session.origin.is_none() {
        if let Some(url) = first_curl_url(&joined) {
            if let Ok(parsed) = url::Url::parse(&url) {
                session.origin = Some(parsed.origin().ascii_serialization());
            }
        }
    }

    Ok(session)
}

fn first_curl_url(curl: &str) -> Option<String> {
    let mut tokens = curl.split_whitespace();
    let first = tokens.next()?;
    if !first.eq_ignore_ascii_case("curl") && !first.trim_matches(['\'', '"']).eq_ignore_ascii_case("curl") {
        return None;
    }
    for tok in tokens {
        let t = tok.trim_matches(['\'', '"']);
        if t.starts_with("http://") || t.starts_with("https://") {
            return Some(t.to_string());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// HAR parser — picks the most useful entry (most recent 2xx for an origin)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Har {
    log: HarLog,
}

#[derive(Debug, Deserialize)]
struct HarLog {
    #[serde(default)]
    entries: Vec<HarEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HarEntry {
    #[serde(default)]
    started_date_time: String,
    request: HarRequest,
    #[serde(default)]
    response: HarResponse,
}

#[derive(Debug, Deserialize)]
struct HarRequest {
    #[serde(default)]
    url: String,
    #[serde(default)]
    headers: Vec<HarHeader>,
    #[serde(default)]
    cookies: Vec<HarCookie>,
}

#[derive(Debug, Default, Deserialize)]
struct HarResponse {
    #[serde(default)]
    status: i64,
}

#[derive(Debug, Deserialize)]
struct HarHeader {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct HarCookie {
    name: String,
    value: String,
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

fn parse_har(raw: &str) -> Result<ImportedSession, String> {
    let har: Har = serde_json::from_str(raw).map_err(|e| format!("invalid HAR: {}", e))?;
    if har.log.entries.is_empty() {
        return Err("HAR contains no entries".to_string());
    }

    // Group entries by host, find the most common one, then pick the best
    // entry within that host: prefer most-recent 2xx; fall back to first
    // entry with non-empty cookies.
    let mut host_counts: BTreeMap<String, usize> = BTreeMap::new();
    for entry in &har.log.entries {
        if let Ok(u) = url::Url::parse(&entry.request.url) {
            if let Some(h) = u.host_str() {
                *host_counts.entry(h.to_string()).or_default() += 1;
            }
        }
    }
    let target_host = host_counts
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(h, _)| h);

    let target = target_host.as_deref();
    let best = har
        .log
        .entries
        .iter()
        .filter(|e| match (target, url::Url::parse(&e.request.url).ok().and_then(|u| u.host_str().map(String::from))) {
            (Some(t), Some(h)) => h == t,
            _ => target.is_none(),
        })
        .filter(|e| (200..400).contains(&e.response.status))
        .max_by(|a, b| a.started_date_time.cmp(&b.started_date_time))
        .or_else(|| {
            har.log
                .entries
                .iter()
                .find(|e| !e.request.cookies.is_empty())
        })
        .ok_or_else(|| "no usable HAR entry (no 2xx response and no cookies found)".to_string())?;

    let mut session = ImportedSession::default();
    let mut pseudo_authority: Option<String> = None;

    for h in &best.request.headers {
        bucket_header(&mut session, &h.name, h.value.trim(), &mut pseudo_authority);
    }
    for c in &best.request.cookies {
        let mut obj = json!({ "name": c.name, "value": c.value });
        if let Some(ref d) = c.domain {
            obj["domain"] = json!(d);
        }
        if let Some(ref p) = c.path {
            obj["path"] = json!(p);
        }
        session.cookies.push(obj);
    }

    if session.origin.is_none() {
        if let Ok(u) = url::Url::parse(&best.request.url) {
            session.origin = Some(u.origin().ascii_serialization());
        }
    }
    if session.origin.is_none() {
        if let Some(authority) = pseudo_authority {
            session.origin = Some(format!("https://{}", authority));
        }
    }

    Ok(session)
}

// ---------------------------------------------------------------------------
// Playwright storage-state parser
// ---------------------------------------------------------------------------

fn parse_storage_state(raw: &str) -> Result<ImportedSession, String> {
    let parsed: StorageState =
        serde_json::from_str(raw).map_err(|e| format!("invalid storage-state JSON: {}", e))?;

    let mut session = ImportedSession::default();
    session.cookies = parsed
        .cookies
        .iter()
        .map(|c| serde_json::to_value(c).unwrap_or(Value::Null))
        .filter(|v| !v.is_null())
        .collect();
    if let Some(first) = parsed.origins.first() {
        session.origin = Some(first.origin.clone());
    }
    session.storage_state = Some(parsed);
    Ok(session)
}

// ---------------------------------------------------------------------------
// Shared header bucketing
// ---------------------------------------------------------------------------

fn bucket_header(
    session: &mut ImportedSession,
    name: &str,
    value: &str,
    pseudo_authority: &mut Option<String>,
) {
    let lower = name.to_ascii_lowercase();
    if value.is_empty() {
        return;
    }
    match lower.as_str() {
        "user-agent" => {
            session.user_agent = Some(value.to_string());
        }
        "accept-language" => {
            session.accept_language = Some(value.to_string());
        }
        "cookie" => {
            if let Ok(parsed) = parse_cookie_header(value) {
                session.cookies = parsed;
            }
        }
        "origin" => {
            session.origin = Some(value.trim_end_matches('/').to_string());
        }
        ":authority" => {
            *pseudo_authority = Some(value.to_string());
        }
        ":method" | ":path" | ":scheme" => {
            // HTTP/2 pseudo-headers — uninteresting for replay; drop them.
        }
        "host" if session.origin.is_none() => {
            *pseudo_authority = Some(value.to_string());
        }
        _ if lower.starts_with("sec-ch-ua") => {
            session.ua_ch.insert(lower, value.to_string());
        }
        // Capture only forward-replayable request headers. Skip headers that
        // are connection-, length-, or response-specific so the bundle stays
        // safe to replay across runs.
        _ if matches!(
            lower.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "keep-alive"
                | "transfer-encoding"
                | "te"
                | "upgrade"
                | "proxy-connection"
        ) => {}
        _ => {
            session.extra_headers.insert(lower, value.to_string());
        }
    }
}

// ---------------------------------------------------------------------------
// On-disk bundle: layout, save, load, list, delete
// ---------------------------------------------------------------------------

pub fn bundle_dir(name: &str) -> PathBuf {
    get_sessions_dir().join(name)
}

fn encryption_key() -> Option<String> {
    std::env::var("AGENT_BROWSER_ENCRYPTION_KEY")
        .ok()
        .filter(|v| !v.is_empty())
}

fn write_blob(dir: &PathBuf, basename: &str, data: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create bundle dir: {}", e))?;
    let path = if let Some(key) = encryption_key() {
        let enc = state::encrypt_for_bundle(data, &key)?;
        let p = dir.join(format!("{}.enc", basename));
        fs::write(&p, &enc).map_err(|e| format!("Failed to write {}: {}", basename, e))?;
        p
    } else {
        let p = dir.join(basename);
        fs::write(&p, data).map_err(|e| format!("Failed to write {}: {}", basename, e))?;
        p
    };
    Ok(path)
}

fn read_blob(dir: &PathBuf, basename: &str) -> Result<Option<Vec<u8>>, String> {
    let plain = dir.join(basename);
    if plain.exists() {
        return fs::read(&plain)
            .map(Some)
            .map_err(|e| format!("Failed to read {}: {}", basename, e));
    }
    let encrypted = dir.join(format!("{}.enc", basename));
    if encrypted.exists() {
        let key = encryption_key().ok_or_else(|| {
            "Encrypted bundle requires AGENT_BROWSER_ENCRYPTION_KEY".to_string()
        })?;
        let data = fs::read(&encrypted).map_err(|e| format!("Failed to read {}: {}", basename, e))?;
        let decrypted = state::decrypt_for_bundle(&data, &key)?;
        return Ok(Some(decrypted));
    }
    Ok(None)
}

pub fn save_bundle(name: &str, imported: &ImportedSession) -> Result<PathBuf, String> {
    let dir = bundle_dir(name);

    // Prefer the brand list (`sec-ch-ua-full-version-list`) — it carries the
    // full Chromium version and is what JS-level `userAgentData` ultimately
    // sees. The bare `sec-ch-ua-full-version` header was deprecated in
    // Chrome 100+ in favour of the list; treat it as a fallback when the
    // list isn't present.
    let full_version_candidate = imported
        .ua_ch
        .get("sec-ch-ua-full-version-list")
        .map(String::as_str)
        .or_else(|| imported.ua_ch.get("sec-ch-ua-full-version").map(String::as_str));
    let (chrome_full, chrome_major) =
        chrome_version_from_ua(imported.user_agent.as_deref(), full_version_candidate);

    let manifest = Bundle {
        schema_version: BUNDLE_SCHEMA_VERSION,
        name: name.to_string(),
        captured_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        source_format: imported
            .source_format
            .unwrap_or(SourceFormat::Auto)
            .as_str()
            .to_string(),
        source_chrome_full_version: chrome_full,
        source_chrome_major_version: chrome_major,
        user_agent: imported.user_agent.clone(),
        accept_language: imported.accept_language.clone(),
        origin: imported.origin.clone(),
        ua_ch: imported.ua_ch.clone(),
        extra_headers: imported.extra_headers.clone(),
        has_cookies: !imported.cookies.is_empty(),
        has_storage_state: imported.storage_state.is_some(),
        notes: imported.warnings.clone(),
    };

    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Failed to serialise bundle: {}", e))?;
    write_blob(&dir, "bundle.json", &manifest_bytes)?;

    if !imported.cookies.is_empty() {
        let cookie_bytes = serde_json::to_vec_pretty(&imported.cookies)
            .map_err(|e| format!("Failed to serialise cookies: {}", e))?;
        write_blob(&dir, "cookies.json", &cookie_bytes)?;
    }
    if let Some(ref state) = imported.storage_state {
        let state_bytes = serde_json::to_vec_pretty(state)
            .map_err(|e| format!("Failed to serialise storage-state: {}", e))?;
        write_blob(&dir, "storage.json", &state_bytes)?;
    }

    Ok(dir)
}

/// Read a bundle by name. Returns the manifest plus the resolved cookies
/// and storage-state when the corresponding blobs are present.
pub fn load_bundle(name: &str) -> Result<(Bundle, Vec<Value>, Option<StorageState>), String> {
    let dir = bundle_dir(name);
    if !dir.exists() {
        return Err(format!(
            "session bundle '{}' not found at {}",
            name,
            dir.display()
        ));
    }
    let manifest_bytes = read_blob(&dir, "bundle.json")?
        .ok_or_else(|| format!("bundle '{}' is missing bundle.json", name))?;
    let manifest: Bundle = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("invalid bundle.json for '{}': {}", name, e))?;

    if manifest.schema_version != BUNDLE_SCHEMA_VERSION {
        return Err(format!(
            "bundle '{}' uses schema_version {} but this build expects {} — re-run `session import`",
            name, manifest.schema_version, BUNDLE_SCHEMA_VERSION
        ));
    }

    let cookies: Vec<Value> = if manifest.has_cookies {
        let bytes = read_blob(&dir, "cookies.json")?
            .ok_or_else(|| format!("bundle '{}' manifest claims has_cookies but cookies.json is missing", name))?;
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid cookies.json: {}", e))?
    } else {
        Vec::new()
    };

    let storage_state: Option<StorageState> = if manifest.has_storage_state {
        let bytes = read_blob(&dir, "storage.json")?
            .ok_or_else(|| format!("bundle '{}' manifest claims has_storage_state but storage.json is missing", name))?;
        Some(serde_json::from_slice(&bytes).map_err(|e| format!("invalid storage.json: {}", e))?)
    } else {
        None
    };

    Ok((manifest, cookies, storage_state))
}

pub fn list_bundles() -> Vec<String> {
    let dir = get_sessions_dir();
    if !dir.exists() {
        return Vec::new();
    }
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let bundle_path = path.join("bundle.json");
            let enc_path = path.join("bundle.json.enc");
            if !bundle_path.exists() && !enc_path.exists() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    names
}

pub fn delete_bundle(name: &str) -> Result<(), String> {
    let dir = bundle_dir(name);
    if !dir.exists() {
        return Err(format!("session bundle '{}' not found", name));
    }
    // Only remove the four well-known blobs and the dir itself — never recurse
    // blindly, in case the user has another `--session-name` state file in
    // the same dir.
    for basename in ["bundle.json", "cookies.json", "storage.json"] {
        let _ = fs::remove_file(dir.join(basename));
        let _ = fs::remove_file(dir.join(format!("{}.enc", basename)));
    }
    let _ = fs::remove_dir(&dir);
    Ok(())
}

fn chrome_version_from_ua(
    user_agent: Option<&str>,
    sec_ch_ua_full_version: Option<&str>,
) -> (Option<String>, Option<String>) {
    if let Some(raw) = sec_ch_ua_full_version {
        if let Some(v) = first_chrome_version_in_list(raw) {
            let major = v.split('.').next().unwrap_or("").to_string();
            return (Some(v), if major.is_empty() { None } else { Some(major) });
        }
        // Bare quoted version (`"148.0.7778.97"`) — not a brand list, but a
        // single value. Strip quotes; treat as the version directly.
        let bare = raw.trim().trim_matches('"').trim();
        if !bare.is_empty()
            && bare
                .chars()
                .all(|c| c.is_ascii_digit() || c == '.')
            && bare.contains('.')
        {
            let major = bare.split('.').next().unwrap_or("").to_string();
            return (
                Some(bare.to_string()),
                if major.is_empty() { None } else { Some(major) },
            );
        }
    }
    if let Some(ua) = user_agent {
        if let Some(start) = ua.find("Chrome/") {
            let rest = &ua[start + "Chrome/".len()..];
            let version: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if !version.is_empty() {
                let major = version.split('.').next().unwrap_or("").to_string();
                return (Some(version), if major.is_empty() { None } else { Some(major) });
            }
        }
    }
    (None, None)
}

/// Extract the first plausible Chrome version from a `sec-ch-ua-full-version-list`
/// value (e.g. `"Chromium";v="148.0.7778.97", "Not/A)Brand";v="99.0.0.0"`).
/// Picks the brand containing "Chromium" or "Chrome" preferentially.
fn first_chrome_version_in_list(value: &str) -> Option<String> {
    let entries = split_brand_list(value);
    let mut chromium_version = None;
    let mut any_version = None;
    for (brand, ver) in entries {
        if any_version.is_none() {
            any_version = Some(ver.clone());
        }
        let b = brand.to_ascii_lowercase();
        if b.contains("chromium") || b.contains("google chrome") || b == "chrome" {
            chromium_version = Some(ver);
            break;
        }
    }
    chromium_version.or(any_version)
}

/// Quote-aware tokenizer for a `Brand;v=Version, Brand;v=Version, ...` value.
/// Returns `(brand_unquoted, version_unquoted)` tuples. Commas and semicolons
/// inside double quotes are preserved.
pub fn split_brand_list(value: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut entries: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut in_quotes = false;
    for ch in value.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                buf.push(ch);
            }
            ',' if !in_quotes => {
                entries.push(std::mem::take(&mut buf));
            }
            _ => buf.push(ch),
        }
    }
    if !buf.trim().is_empty() {
        entries.push(buf);
    }
    for entry in entries {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let mut parts: Vec<String> = Vec::new();
        let mut piece = String::new();
        let mut in_q = false;
        for ch in entry.chars() {
            match ch {
                '"' => {
                    in_q = !in_q;
                    piece.push(ch);
                }
                ';' if !in_q => {
                    parts.push(std::mem::take(&mut piece));
                }
                _ => piece.push(ch),
            }
        }
        if !piece.trim().is_empty() {
            parts.push(piece);
        }
        if parts.is_empty() {
            continue;
        }
        let brand = parts[0].trim().trim_matches('"').to_string();
        let mut version = String::new();
        for p in parts.iter().skip(1) {
            let p = p.trim();
            if let Some(rest) = p.strip_prefix("v=") {
                version = rest.trim().trim_matches('"').to_string();
                break;
            }
        }
        if !brand.is_empty() && !version.is_empty() {
            out.push((brand, version));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Apply at launch: set headers, cookies, storage. Called from handle_launch
// and auto_launch after stealth init scripts are registered.
// ---------------------------------------------------------------------------

pub async fn apply_bundle_to_session(
    client: &CdpClient,
    session_id: &str,
    manifest: &Bundle,
    cookies: &[Value],
    storage_state: Option<&StorageState>,
) -> Result<(), String> {
    if !manifest.ua_ch.is_empty() || !manifest.extra_headers.is_empty() {
        let mut headers = std::collections::HashMap::new();
        for (k, v) in manifest.ua_ch.iter().chain(manifest.extra_headers.iter()) {
            headers.insert(k.clone(), v.clone());
        }
        let _ = network::set_extra_headers(client, session_id, &headers).await;
    }

    if !cookies.is_empty() {
        let origin = manifest.origin.as_deref();
        cookies::set_cookies(client, session_id, cookies.to_vec(), origin).await?;
    }

    if let Some(state) = storage_state {
        state::load_state_value(client, session_id, state).await?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const H1_PASTE: &str = "\
:authority\n\
hackerone.com\n\
:method\n\
POST\n\
:path\n\
/graphql\n\
:scheme\n\
https\n\
accept\n\
*/*\n\
accept-language\n\
en-US,en;q=0.9\n\
cookie\n\
h1_device_id=abc; cf_clearance=xyz123\n\
sec-ch-ua\n\
\"Not/A)Brand\";v=\"99\", \"Chromium\";v=\"148\"\n\
sec-ch-ua-mobile\n\
?0\n\
sec-ch-ua-platform\n\
\"macOS\"\n\
sec-ch-ua-platform-version\n\
\"26.4.1\"\n\
sec-ch-ua-arch\n\
\"arm\"\n\
sec-ch-ua-bitness\n\
\"64\"\n\
sec-ch-ua-full-version\n\
\"148.0.7778.97\"\n\
sec-ch-ua-full-version-list\n\
\"Not/A)Brand\";v=\"99.0.0.0\", \"Chromium\";v=\"148.0.7778.97\"\n\
sec-ch-ua-model\n\
\"\"\n\
user-agent\n\
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36\n\
";

    #[test]
    fn detects_devtools_format() {
        assert_eq!(detect_format(H1_PASTE.trim()), SourceFormat::DevTools);
    }

    #[test]
    fn devtools_parses_h1_paste() {
        let session = parse_imported_session(H1_PASTE, SourceFormat::Auto).unwrap();
        assert!(session.user_agent.as_ref().unwrap().contains("Chrome/148"));
        assert_eq!(
            session.ua_ch.get("sec-ch-ua-platform").map(String::as_str),
            Some("\"macOS\"")
        );
        assert_eq!(
            session.ua_ch.get("sec-ch-ua-mobile").map(String::as_str),
            Some("?0")
        );
        assert_eq!(
            session.accept_language.as_deref(),
            Some("en-US,en;q=0.9")
        );
        assert_eq!(session.origin.as_deref(), Some("https://hackerone.com"));
        assert_eq!(session.cookies.len(), 2);
        let cf = session
            .cookies
            .iter()
            .find(|c| c.get("name").and_then(|v| v.as_str()) == Some("cf_clearance"))
            .expect("cf_clearance cookie present");
        assert_eq!(cf.get("value").and_then(|v| v.as_str()), Some("xyz123"));
    }

    #[test]
    fn devtools_sec_ch_ua_preserves_quoted_separators() {
        let session = parse_imported_session(H1_PASTE, SourceFormat::Auto).unwrap();
        let sec_ch_ua = session.ua_ch.get("sec-ch-ua").unwrap();
        // The full string with `;` and `,` inside quotes must be preserved
        // verbatim — never split.
        assert_eq!(sec_ch_ua, "\"Not/A)Brand\";v=\"99\", \"Chromium\";v=\"148\"");
    }

    #[test]
    fn devtools_pseudo_headers_set_origin_only() {
        let raw = ":authority: example.com\n:method: GET\n:path: /\nuser-agent\nMozilla/5.0\n";
        let session = parse_imported_session(raw, SourceFormat::DevTools).unwrap();
        assert_eq!(session.origin.as_deref(), Some("https://example.com"));
        assert!(!session.extra_headers.contains_key(":authority"));
        assert!(!session.extra_headers.contains_key(":method"));
    }

    #[test]
    fn curl_extracts_headers_and_cookies() {
        let curl = "curl 'https://hackerone.com/graphql' \\\n  -H 'user-agent: Mozilla/5.0 Chrome/148.0.0.0 Safari/537.36' \\\n  -H 'sec-ch-ua: \"Chromium\";v=\"148\"' \\\n  -H 'sec-ch-ua-platform: \"macOS\"' \\\n  -H 'cookie: cf_clearance=abc; sid=def'";
        let session = parse_imported_session(curl, SourceFormat::Auto).unwrap();
        assert_eq!(session.source_format, Some(SourceFormat::Curl));
        assert!(session.user_agent.as_ref().unwrap().contains("Chrome/148"));
        assert_eq!(
            session.ua_ch.get("sec-ch-ua-platform").map(String::as_str),
            Some("\"macOS\"")
        );
        assert_eq!(session.cookies.len(), 2);
        assert_eq!(session.origin.as_deref(), Some("https://hackerone.com"));
    }

    #[test]
    fn har_picks_most_recent_2xx() {
        let har = r#"{
          "log": {
            "entries": [
              {
                "startedDateTime": "2024-01-01T00:00:00Z",
                "request": {
                  "url": "https://example.com/a",
                  "headers": [{"name": "user-agent", "value": "Mozilla/5.0 Chrome/142"}],
                  "cookies": [{"name": "old", "value": "1"}]
                },
                "response": {"status": 200}
              },
              {
                "startedDateTime": "2024-06-01T00:00:00Z",
                "request": {
                  "url": "https://example.com/b",
                  "headers": [
                    {"name": "user-agent", "value": "Mozilla/5.0 Chrome/148"},
                    {"name": "sec-ch-ua-platform", "value": "\"macOS\""}
                  ],
                  "cookies": [{"name": "fresh", "value": "2", "domain": ".example.com", "path": "/"}]
                },
                "response": {"status": 200}
              }
            ]
          }
        }"#;
        let session = parse_imported_session(har, SourceFormat::Auto).unwrap();
        assert!(session.user_agent.as_ref().unwrap().contains("Chrome/148"));
        assert_eq!(session.cookies.len(), 1);
        let c = &session.cookies[0];
        assert_eq!(c.get("name").and_then(|v| v.as_str()), Some("fresh"));
    }

    #[test]
    fn storage_state_passthrough() {
        let raw = r#"{"cookies":[{"name":"s","value":"v","domain":".example.com","path":"/"}],"origins":[{"origin":"https://example.com","localStorage":[]}]}"#;
        let session = parse_imported_session(raw, SourceFormat::Auto).unwrap();
        assert_eq!(session.source_format, Some(SourceFormat::StorageState));
        assert_eq!(session.cookies.len(), 1);
        assert!(session.storage_state.is_some());
        assert_eq!(session.origin.as_deref(), Some("https://example.com"));
    }

    #[test]
    fn empty_input_errors() {
        assert!(parse_imported_session("", SourceFormat::Auto).is_err());
        assert!(parse_imported_session("   \n  \n", SourceFormat::Auto).is_err());
    }

    #[test]
    fn split_brand_list_respects_quotes() {
        let v = "\"Chromium\";v=\"148.0.7778.97\", \"Not/A)Brand\";v=\"99.0.0.0\"";
        let parsed = split_brand_list(v);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].0, "Chromium");
        assert_eq!(parsed[0].1, "148.0.7778.97");
        assert_eq!(parsed[1].0, "Not/A)Brand");
        assert_eq!(parsed[1].1, "99.0.0.0");
    }

    #[test]
    fn chrome_version_from_ua_prefers_full_version_list() {
        let (full, major) = chrome_version_from_ua(
            Some("Mozilla/5.0 Chrome/100.0.0.0 Safari/537.36"),
            Some("\"Chromium\";v=\"148.0.7778.97\""),
        );
        assert_eq!(full.as_deref(), Some("148.0.7778.97"));
        assert_eq!(major.as_deref(), Some("148"));
    }

    #[test]
    fn chrome_version_from_ua_falls_back_to_ua() {
        let (full, major) =
            chrome_version_from_ua(Some("Mozilla/5.0 Chrome/123.0.456.78 Safari/537.36"), None);
        assert_eq!(full.as_deref(), Some("123.0.456.78"));
        assert_eq!(major.as_deref(), Some("123"));
    }
}
