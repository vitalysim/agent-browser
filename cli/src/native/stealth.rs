//! Stealth-mode browser launch and page-runtime helpers.
//!
//! This ports the fork's TypeScript stealth layer into the native CDP runtime:
//! Chrome launch flags, a realistic fingerprint profile, init-script patches,
//! User-Agent Client Hints, WebRTC blocking, and system Chrome selection.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct StealthConfig {
    pub enabled: bool,
    pub profile_name: Option<String>,
    pub block_webrtc: bool,
    pub use_system_chrome: bool,
    pub client_hints: bool,
    pub client_hints_mode: ClientHintsMode,
    pub input_coordinates: bool,
    pub input_realism: InputRealismMode,
    pub typing_realism: TypingRealismMode,
    pub chrome_major_version: Option<String>,
    pub chrome_full_version: Option<String>,
}

impl StealthConfig {
    pub fn new(enabled: bool, profile_name: Option<String>) -> Option<Self> {
        if !enabled {
            return None;
        }

        Some(Self {
            enabled,
            profile_name,
            block_webrtc: true,
            use_system_chrome: false,
            client_hints: true,
            client_hints_mode: ClientHintsMode::AcceptCh,
            input_coordinates: true,
            input_realism: InputRealismMode::Balanced,
            typing_realism: TypingRealismMode::Off,
            chrome_major_version: None,
            chrome_full_version: None,
        })
    }

    pub fn apply_browser_version(&mut self, product: Option<&str>, user_agent: Option<&str>) {
        if let Some((major, full)) = parse_chrome_version(product, user_agent) {
            self.chrome_major_version = Some(major);
            self.chrome_full_version = Some(full);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClientHintsMode {
    /// Send only low-entropy UA-CH headers. This is also the network default
    /// for Accept-CH mode until an origin explicitly asks for high entropy.
    LowEntropy,
    /// Balanced mode: low-entropy HTTP headers and full JS/CDP metadata.
    AcceptCh,
    /// Send full high-entropy UA-CH headers globally. Useful only in lab tests.
    Full,
}

impl ClientHintsMode {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "low-entropy" | "low" => Some(Self::LowEntropy),
            "accept-ch" | "accept_ch" | "balanced" => Some(Self::AcceptCh),
            "full" => Some(Self::Full),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InputRealismMode {
    Off,
    Balanced,
    Aggressive,
}

impl InputRealismMode {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "off" | "false" | "0" => Some(Self::Off),
            "balanced" | "true" | "1" => Some(Self::Balanced),
            "aggressive" => Some(Self::Aggressive),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TypingRealismMode {
    Off,
    Balanced,
}

impl TypingRealismMode {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "off" | "false" | "0" => Some(Self::Off),
            "balanced" | "true" | "1" => Some(Self::Balanced),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StealthProfile {
    pub user_agent: String,
    pub platform: String,
    pub vendor: String,
    pub vendor_sub: String,
    pub languages: Vec<String>,
    pub hardware_concurrency: u32,
    pub device_memory: u32,
    pub max_touch_points: u32,
    pub screen_width: u32,
    pub screen_height: u32,
    pub screen_avail_width: u32,
    pub screen_avail_height: u32,
    pub color_depth: u32,
    pub pixel_depth: u32,
    pub webgl_vendor: String,
    pub webgl_renderer: String,
    pub fingerprint_seed: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_hints: Option<ClientHintsData>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientHintsData {
    pub brands: Vec<BrandVersion>,
    pub full_version_list: Vec<BrandVersion>,
    pub mobile: bool,
    pub platform: String,
    pub platform_version: String,
    pub architecture: String,
    pub bitness: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrandVersion {
    pub brand: String,
    pub version: String,
}

fn brand(brand: &str, version: &str) -> BrandVersion {
    BrandVersion {
        brand: brand.to_string(),
        version: version.to_string(),
    }
}

fn chrome_client_hints(
    major_version: &str,
    full_version: &str,
    platform: &str,
    platform_version: &str,
    architecture: &str,
    bitness: &str,
    model: &str,
    mobile: bool,
) -> ClientHintsData {
    ClientHintsData {
        brands: vec![
            brand("Chromium", major_version),
            brand("Google Chrome", major_version),
            brand("Not_A Brand", "24"),
        ],
        full_version_list: vec![
            brand("Chromium", full_version),
            brand("Google Chrome", full_version),
            brand("Not_A Brand", "24.0.0.0"),
        ],
        mobile,
        platform: platform.to_string(),
        platform_version: platform_version.to_string(),
        architecture: architecture.to_string(),
        bitness: bitness.to_string(),
        model: model.to_string(),
    }
}

pub fn list_profiles() -> Vec<&'static str> {
    vec![
        "chrome-windows",
        "chrome-mac",
        "chrome-linux",
        "mobile-android",
        "mobile-ios",
    ]
}

pub fn profile(name: Option<&str>) -> StealthProfile {
    match name {
        Some("chrome-windows") => chrome_windows_profile(),
        Some("chrome-mac") => chrome_mac_profile(),
        Some("chrome-linux") => chrome_linux_profile(),
        Some("mobile-android") => mobile_android_profile(),
        Some("mobile-ios") => mobile_ios_profile(),
        _ if cfg!(target_os = "macos") => chrome_mac_profile(),
        _ if cfg!(target_os = "windows") => chrome_windows_profile(),
        _ => chrome_linux_profile(),
    }
}

pub fn profile_for_config(config: &StealthConfig) -> StealthProfile {
    let mut profile = profile(config.profile_name.as_deref());
    let Some(ref full_version) = config.chrome_full_version else {
        return profile;
    };
    let major_version = config
        .chrome_major_version
        .as_deref()
        .or_else(|| full_version.split('.').next())
        .unwrap_or("144");

    profile.user_agent = rewrite_chrome_version(&profile.user_agent, full_version);
    if let Some(ref mut hints) = profile.client_hints {
        rewrite_brand_versions(&mut hints.brands, major_version, "24");
        rewrite_brand_versions(&mut hints.full_version_list, full_version, "24.0.0.0");
    }

    profile
}

fn parse_chrome_version(
    product: Option<&str>,
    user_agent: Option<&str>,
) -> Option<(String, String)> {
    for source in [product, user_agent].into_iter().flatten() {
        if let Some(version) = extract_version_after(source, "Chrome/") {
            return Some(chrome_version_pair(&version));
        }
        if let Some(version) = extract_version_after(source, "Chromium/") {
            return Some(chrome_version_pair(&version));
        }
        if let Some(version) = source.strip_prefix("Chrome/") {
            return Some(chrome_version_pair(version));
        }
        if let Some(version) = source.strip_prefix("Chromium/") {
            return Some(chrome_version_pair(version));
        }
    }
    None
}

fn extract_version_after(source: &str, marker: &str) -> Option<String> {
    let start = source.find(marker)? + marker.len();
    let version = source[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn chrome_version_pair(version: &str) -> (String, String) {
    let full = version.to_string();
    let major = version
        .split('.')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("144")
        .to_string();
    (major, full)
}

fn rewrite_chrome_version(user_agent: &str, full_version: &str) -> String {
    let Some(start) = user_agent.find("Chrome/") else {
        return user_agent.to_string();
    };
    let version_start = start + "Chrome/".len();
    let version_end = user_agent[version_start..]
        .find(' ')
        .map(|offset| version_start + offset)
        .unwrap_or(user_agent.len());
    format!(
        "{}{}{}",
        &user_agent[..version_start],
        full_version,
        &user_agent[version_end..]
    )
}

fn rewrite_brand_versions(
    brands: &mut [BrandVersion],
    chrome_version: &str,
    not_brand_version: &str,
) {
    for brand in brands {
        if brand.brand == "Chromium" || brand.brand == "Google Chrome" {
            brand.version = chrome_version.to_string();
        } else if brand.brand == "Not_A Brand" {
            brand.version = not_brand_version.to_string();
        }
    }
}

pub fn config_from_env() -> Option<StealthConfig> {
    let enabled = env_bool("AGENT_BROWSER_STEALTH").unwrap_or(false);
    let profile_name = env::var("AGENT_BROWSER_STEALTH_PROFILE")
        .ok()
        .filter(|s| !s.is_empty());
    let mut config = StealthConfig::new(enabled, profile_name)?;
    apply_env_overrides(&mut config);
    Some(config)
}

pub fn config_from_command(cmd: &Value) -> Option<StealthConfig> {
    let enabled = cmd
        .get("stealth")
        .and_then(|v| v.as_bool())
        .or_else(|| env_bool("AGENT_BROWSER_STEALTH"))
        .unwrap_or(false);

    let profile_name = cmd
        .get("stealthProfile")
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| {
            env::var("AGENT_BROWSER_STEALTH_PROFILE")
                .ok()
                .filter(|s| !s.is_empty())
        });

    let mut config = StealthConfig::new(enabled, profile_name)?;

    if let Some(options) = cmd.get("stealthOptions") {
        if let Some(v) = options.get("blockWebRTC").and_then(|v| v.as_bool()) {
            config.block_webrtc = v;
        }
        if let Some(v) = options.get("useSystemChrome").and_then(|v| v.as_bool()) {
            config.use_system_chrome = v;
        }
        if let Some(v) = options.get("clientHints").and_then(|v| v.as_bool()) {
            config.client_hints = v;
        }
        if let Some(v) = options
            .get("clientHintsMode")
            .and_then(|v| v.as_str())
            .and_then(ClientHintsMode::from_str)
        {
            config.client_hints_mode = v;
        }
        if let Some(v) = options.get("inputCoordinates").and_then(|v| v.as_bool()) {
            config.input_coordinates = v;
        }
        if let Some(v) = options
            .get("inputRealism")
            .and_then(|v| v.as_str())
            .and_then(InputRealismMode::from_str)
        {
            config.input_realism = v;
        }
        if let Some(v) = options
            .get("typingRealism")
            .and_then(|v| v.as_str())
            .and_then(TypingRealismMode::from_str)
        {
            config.typing_realism = v;
        }
    }

    apply_env_overrides(&mut config);

    Some(config)
}

fn apply_env_overrides(config: &mut StealthConfig) {
    if let Some(v) = env_bool("AGENT_BROWSER_STEALTH_BLOCK_WEBRTC") {
        config.block_webrtc = v;
    }
    if let Some(v) = env_bool("AGENT_BROWSER_STEALTH_USE_SYSTEM_CHROME") {
        config.use_system_chrome = v;
    }
    if let Some(v) = env_bool("AGENT_BROWSER_STEALTH_CLIENT_HINTS") {
        config.client_hints = v;
    }
    if let Ok(v) = env::var("AGENT_BROWSER_STEALTH_CLIENT_HINTS_MODE") {
        if let Some(mode) = ClientHintsMode::from_str(&v) {
            config.client_hints_mode = mode;
        }
    }
    if let Some(v) = env_bool("AGENT_BROWSER_STEALTH_INPUT_COORDINATES") {
        config.input_coordinates = v;
    }
    if let Ok(v) = env::var("AGENT_BROWSER_STEALTH_INPUT_REALISM") {
        if let Some(mode) = InputRealismMode::from_str(&v) {
            config.input_realism = mode;
        }
    }
    if let Ok(v) = env::var("AGENT_BROWSER_STEALTH_TYPING_REALISM") {
        if let Some(mode) = TypingRealismMode::from_str(&v) {
            config.typing_realism = mode;
        }
    }
}

fn env_bool(name: &str) -> Option<bool> {
    env::var(name).ok().map(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

pub fn user_agent(config: &StealthConfig) -> String {
    profile_for_config(config).user_agent
}

pub fn client_hint_headers(config: &StealthConfig) -> HashMap<String, String> {
    if !config.client_hints {
        return HashMap::new();
    }

    let Some(hints) = profile_for_config(config).client_hints else {
        return HashMap::new();
    };

    let mut headers = HashMap::new();
    headers.insert("sec-ch-ua".to_string(), sec_ch_ua(&hints.brands));
    headers.insert(
        "sec-ch-ua-mobile".to_string(),
        if hints.mobile { "?1" } else { "?0" }.to_string(),
    );
    headers.insert(
        "sec-ch-ua-platform".to_string(),
        quote_header(&hints.platform),
    );

    if config.client_hints_mode != ClientHintsMode::Full {
        return headers;
    }

    headers.insert(
        "sec-ch-ua-arch".to_string(),
        quote_header(&hints.architecture),
    );
    headers.insert(
        "sec-ch-ua-bitness".to_string(),
        quote_header(&hints.bitness),
    );
    headers.insert(
        "sec-ch-ua-full-version-list".to_string(),
        sec_ch_ua(&hints.full_version_list),
    );
    headers.insert("sec-ch-ua-model".to_string(), quote_header(&hints.model));
    headers.insert(
        "sec-ch-ua-platform-version".to_string(),
        quote_header(&hints.platform_version),
    );
    headers
}

pub fn user_agent_metadata(config: &StealthConfig) -> Option<Value> {
    if !config.client_hints {
        return None;
    }

    let hints = profile_for_config(config).client_hints?;
    Some(json!({
        "brands": hints.brands,
        "fullVersionList": hints.full_version_list,
        "mobile": hints.mobile,
        "platform": hints.platform,
        "platformVersion": hints.platform_version,
        "architecture": hints.architecture,
        "bitness": hints.bitness,
        "model": hints.model,
    }))
}

pub fn user_agent_platform(config: &StealthConfig) -> String {
    profile_for_config(config).platform
}

pub fn accept_language(config: &StealthConfig) -> String {
    let p = profile_for_config(config);
    if p.languages.is_empty() {
        return "en-US,en;q=0.9".to_string();
    }

    let mut parts = Vec::new();
    for (index, lang) in p.languages.iter().enumerate() {
        if index == 0 {
            parts.push(lang.clone());
        } else {
            let quality = 10u32.saturating_sub(index as u32).max(1);
            parts.push(format!("{};q=0.{}", lang, quality));
        }
    }
    parts.join(",")
}

fn sec_ch_ua(brands: &[BrandVersion]) -> String {
    brands
        .iter()
        .map(|b| format!("\"{}\";v=\"{}\"", b.brand, b.version))
        .collect::<Vec<_>>()
        .join(", ")
}

fn quote_header(value: &str) -> String {
    format!("\"{}\"", value)
}

pub fn chrome_args(config: &StealthConfig, headless: bool, has_extensions: bool) -> Vec<String> {
    if !config.enabled {
        return Vec::new();
    }

    let p = profile_for_config(config);
    let mut args = vec![
        "--disable-blink-features=AutomationControlled".to_string(),
        "--disable-component-extensions-with-background-pages".to_string(),
        "--disable-default-apps".to_string(),
        "--disable-background-networking".to_string(),
        "--disable-sync".to_string(),
        "--disable-translate".to_string(),
        "--disable-infobars".to_string(),
        "--disable-popup-blocking".to_string(),
        "--disable-gpu".to_string(),
        "--lang=en-US".to_string(),
    ];

    if !has_extensions {
        args.push("--disable-extensions".to_string());
    }

    if headless {
        args.push(format!(
            "--window-size={},{}",
            p.screen_width, p.screen_height
        ));
        args.push("--start-maximized".to_string());
    }

    if config.block_webrtc {
        args.extend(
            [
                "--disable-webrtc",
                "--disable-webrtc-encryption",
                "--disable-webrtc-hw-encoding",
                "--disable-webrtc-hw-decoding",
                "--enforce-webrtc-ip-permission-check",
                "--force-webrtc-ip-handling-policy=default_public_interface_only",
            ]
            .into_iter()
            .map(String::from),
        );
    }

    args
}

pub fn init_script(config: &StealthConfig) -> String {
    if !config.enabled {
        return String::new();
    }

    let p = profile_for_config(config);
    let profile_json = serde_json::to_string(&p).unwrap_or_else(|_| "{}".to_string());
    let client_hints_json = p
        .client_hints
        .as_ref()
        .and_then(|h| serde_json::to_string(h).ok())
        .unwrap_or_else(|| "null".to_string());

    STEALTH_INIT_SCRIPT
        .replace("__PROFILE_JSON__", &profile_json)
        .replace("__CLIENT_HINTS_JSON__", &client_hints_json)
        .replace(
            "__BLOCK_WEBRTC__",
            if config.block_webrtc { "true" } else { "false" },
        )
        .replace(
            "__INPUT_COORDINATES__",
            if config.input_coordinates {
                "true"
            } else {
                "false"
            },
        )
        .replace(
            "__CLIENT_HINTS_ENABLED__",
            if config.client_hints { "true" } else { "false" },
        )
}

pub fn system_chrome_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ];
        for candidate in candidates {
            let path = PathBuf::from(candidate);
            if path.exists() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for name in [
            "google-chrome",
            "google-chrome-stable",
            "chromium-browser",
            "chromium",
            "brave-browser",
            "brave-browser-stable",
        ] {
            if let Ok(output) = std::process::Command::new("which").arg(name).output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(PathBuf::from(path));
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe".to_string(),
            env::var("LOCALAPPDATA")
                .map(|p| format!(r"{}\Google\Chrome\Application\chrome.exe", p))
                .unwrap_or_default(),
            env::var("PROGRAMFILES")
                .map(|p| format!(r"{}\Google\Chrome\Application\chrome.exe", p))
                .unwrap_or_default(),
            env::var("PROGRAMFILES(X86)")
                .map(|p| format!(r"{}\Google\Chrome\Application\chrome.exe", p))
                .unwrap_or_default(),
        ];
        for candidate in candidates {
            if candidate.is_empty() {
                continue;
            }
            let path = PathBuf::from(candidate);
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

fn chrome_windows_profile() -> StealthProfile {
    StealthProfile {
        user_agent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
                .to_string(),
        platform: "Win32".to_string(),
        vendor: "Google Inc.".to_string(),
        vendor_sub: String::new(),
        languages: vec!["en-US".to_string(), "en".to_string()],
        hardware_concurrency: 8,
        device_memory: 8,
        max_touch_points: 0,
        screen_width: 1920,
        screen_height: 1080,
        screen_avail_width: 1920,
        screen_avail_height: 1040,
        color_depth: 24,
        pixel_depth: 24,
        webgl_vendor: "Google Inc. (NVIDIA)".to_string(),
        webgl_renderer:
            "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)".to_string(),
        fingerprint_seed: 0x7f3c2d1e,
        client_hints: Some(chrome_client_hints(
            "144",
            "144.0.7559.97",
            "Windows",
            "15.0.0",
            "x86",
            "64",
            "",
            false,
        )),
    }
}

fn chrome_mac_profile() -> StealthProfile {
    StealthProfile {
        user_agent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
                .to_string(),
        platform: "MacIntel".to_string(),
        vendor: "Google Inc.".to_string(),
        vendor_sub: String::new(),
        languages: vec!["en-US".to_string(), "en".to_string()],
        hardware_concurrency: 10,
        device_memory: 8,
        max_touch_points: 0,
        screen_width: 1512,
        screen_height: 982,
        screen_avail_width: 1512,
        screen_avail_height: 919,
        color_depth: 30,
        pixel_depth: 30,
        webgl_vendor: "Google Inc. (Apple)".to_string(),
        webgl_renderer:
            "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)".to_string(),
        fingerprint_seed: 0x4a5b6c7d,
        client_hints: Some(chrome_client_hints(
            "144",
            "144.0.7559.97",
            "macOS",
            "10.15.7",
            "arm",
            "64",
            "",
            false,
        )),
    }
}

fn chrome_linux_profile() -> StealthProfile {
    StealthProfile {
        user_agent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
                .to_string(),
        platform: "Linux x86_64".to_string(),
        vendor: "Google Inc.".to_string(),
        vendor_sub: String::new(),
        languages: vec!["en-US".to_string(), "en".to_string()],
        hardware_concurrency: 8,
        device_memory: 8,
        max_touch_points: 0,
        screen_width: 1920,
        screen_height: 1080,
        screen_avail_width: 1920,
        screen_avail_height: 1053,
        color_depth: 24,
        pixel_depth: 24,
        webgl_vendor: "Google Inc. (Intel)".to_string(),
        webgl_renderer:
            "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)".to_string(),
        fingerprint_seed: 0x8e9f0a1b,
        client_hints: Some(chrome_client_hints(
            "144",
            "144.0.7559.97",
            "Linux",
            "6.5.0",
            "x86",
            "64",
            "",
            false,
        )),
    }
}

fn mobile_android_profile() -> StealthProfile {
    StealthProfile {
        user_agent:
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36"
                .to_string(),
        platform: "Linux armv81".to_string(),
        vendor: "Google Inc.".to_string(),
        vendor_sub: String::new(),
        languages: vec!["en-US".to_string(), "en".to_string()],
        hardware_concurrency: 8,
        device_memory: 8,
        max_touch_points: 5,
        screen_width: 412,
        screen_height: 915,
        screen_avail_width: 412,
        screen_avail_height: 857,
        color_depth: 24,
        pixel_depth: 24,
        webgl_vendor: "Qualcomm".to_string(),
        webgl_renderer: "Adreno (TM) 750".to_string(),
        fingerprint_seed: 0x2c3d4e5f,
        client_hints: Some(chrome_client_hints(
            "144",
            "144.0.7559.97",
            "Android",
            "14.0.0",
            "",
            "",
            "Pixel 8",
            true,
        )),
    }
}

fn mobile_ios_profile() -> StealthProfile {
    StealthProfile {
        user_agent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1"
                .to_string(),
        platform: "iPhone".to_string(),
        vendor: "Apple Computer, Inc.".to_string(),
        vendor_sub: String::new(),
        languages: vec!["en-US".to_string(), "en".to_string()],
        hardware_concurrency: 6,
        device_memory: 4,
        max_touch_points: 5,
        screen_width: 390,
        screen_height: 844,
        screen_avail_width: 390,
        screen_avail_height: 844,
        color_depth: 32,
        pixel_depth: 32,
        webgl_vendor: "Apple Inc.".to_string(),
        webgl_renderer: "Apple GPU".to_string(),
        fingerprint_seed: 0x6f7e8d9c,
        client_hints: None,
    }
}

const STEALTH_INIT_SCRIPT: &str = r###"
(function() {
  try {
    const profileData = __PROFILE_JSON__;
    const clientHintsData = __CLIENT_HINTS_JSON__;
    const blockWebRTC = __BLOCK_WEBRTC__;
    const patchInputCoordinates = __INPUT_COORDINATES__;
    const patchClientHints = __CLIENT_HINTS_ENABLED__ && !!clientHintsData;

    const originalToString = Function.prototype.toString;
    const patchedFunctions = new WeakSet();
    const mask = function(fn) {
      try { patchedFunctions.add(fn); } catch (_) {}
      return fn;
    };

    const newToString = mask(function() {
      if (this === newToString) {
        return 'function toString() { [native code] }';
      }
      if (patchedFunctions.has(this)) {
        const name = this.name || '';
        return 'function ' + name + '() { [native code] }';
      }
      return originalToString.call(this);
    });

    Object.defineProperty(Function.prototype, 'toString', {
      value: newToString,
      writable: true,
      configurable: true,
      enumerable: false,
    });

    const defineGetter = function(obj, prop, getter) {
      try {
        Object.defineProperty(obj, prop, {
          get: mask(getter),
          configurable: true,
          enumerable: true,
        });
      } catch (_) {}
    };

    const defineValue = function(obj, prop, value) {
      try {
        Object.defineProperty(obj, prop, {
          value,
          writable: false,
          configurable: true,
          enumerable: true,
        });
      } catch (_) {}
    };

    let seed = profileData.fingerprintSeed || 0x12345678;
    const random = function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };

    const webdriverGetter = function() { return undefined; };
    defineGetter(navigator, 'webdriver', webdriverGetter);
    try {
      delete Navigator.prototype.webdriver;
      defineGetter(Navigator.prototype, 'webdriver', webdriverGetter);
    } catch (_) {}

    const propsToRemove = [
      '__playwright',
      '__pw_manual',
      '__PW_inspect',
      '__pwInitScripts',
      '__playwright_evaluation_script__',
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
    ];
    const cleanupAutomationProps = function() {
      for (const prop of propsToRemove) {
        try { if (prop in window) delete window[prop]; } catch (_) {}
      }
      try {
        for (const key of Object.keys(document)) {
          if (key.startsWith('$cdc_') || key.startsWith('$wdc_')) {
            delete document[key];
          }
        }
      } catch (_) {}
    };
    cleanupAutomationProps();
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cleanupAutomationProps);
      }
      setTimeout(cleanupAutomationProps, 100);
      setTimeout(cleanupAutomationProps, 500);
    } catch (_) {}

    defineGetter(document, 'hidden', function() { return false; });
    defineGetter(document, 'visibilityState', function() { return 'visible'; });
    try {
      defineGetter(Document.prototype, 'hidden', function() { return false; });
      defineGetter(Document.prototype, 'visibilityState', function() { return 'visible'; });
    } catch (_) {}

    if (!window.chrome || !window.chrome.runtime) {
      const chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: mask(function() { return null; }),
          getIsInstalled: mask(function() { return false; }),
          installState: mask(function(callback) { if (callback) callback('not_installed'); }),
          runningState: mask(function() { return 'cannot_run'; }),
        },
        runtime: {
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
          connect: mask(function() { return undefined; }),
          sendMessage: mask(function() { return undefined; }),
          getManifest: mask(function() { return undefined; }),
          getURL: mask(function() { return undefined; }),
          id: undefined,
        },
        csi: mask(function() {
          return {
            onloadT: Date.now(),
            pageT: Date.now() - performance.timing.navigationStart,
            startE: performance.timing.navigationStart,
            tran: 15,
          };
        }),
        loadTimes: mask(function() {
          const timing = performance.timing;
          return {
            commitLoadTime: timing.responseStart / 1000,
            connectionInfo: 'http/1.1',
            finishDocumentLoadTime: timing.domContentLoadedEventEnd / 1000,
            finishLoadTime: timing.loadEventEnd / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: timing.responseStart / 1000,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'unknown',
            requestTime: timing.requestStart / 1000,
            startLoadTime: timing.navigationStart / 1000,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: false,
            wasNpnNegotiated: false,
          };
        }),
      };
      defineValue(window, 'chrome', chrome);
    }

    const pluginData = [
      { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer', mimeTypes: [{ type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }] },
      { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: '' }] },
      { name: 'Native Client', description: '', filename: 'internal-nacl-plugin', mimeTypes: [{ type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' }, { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }] },
    ];
    try {
      const plugins = [];
      const mimeTypes = [];
      const createMimeType = function(data, plugin) {
        const mimeType = Object.create(MimeType.prototype);
        defineValue(mimeType, 'type', data.type);
        defineValue(mimeType, 'suffixes', data.suffixes);
        defineValue(mimeType, 'description', data.description);
        defineValue(mimeType, 'enabledPlugin', plugin);
        return mimeType;
      };
      for (const data of pluginData) {
        const plugin = Object.create(Plugin.prototype);
        const pluginMimeTypes = [];
        for (const mimeData of data.mimeTypes) {
          const mimeType = createMimeType(mimeData, plugin);
          pluginMimeTypes.push(mimeType);
          mimeTypes.push(mimeType);
        }
        defineValue(plugin, 'name', data.name);
        defineValue(plugin, 'description', data.description);
        defineValue(plugin, 'filename', data.filename);
        defineValue(plugin, 'length', pluginMimeTypes.length);
        pluginMimeTypes.forEach(function(mimeType, index) {
          defineValue(plugin, String(index), mimeType);
          defineValue(plugin, mimeType.type, mimeType);
        });
        plugin.item = mask(function(index) { return pluginMimeTypes[index] || null; });
        plugin.namedItem = mask(function(name) { return pluginMimeTypes.find(function(m) { return m.type === name; }) || null; });
        plugin[Symbol.iterator] = mask(function*() { for (const mt of pluginMimeTypes) yield mt; });
        plugins.push(plugin);
      }
      const pluginArray = Object.create(PluginArray.prototype);
      defineValue(pluginArray, 'length', plugins.length);
      plugins.forEach(function(plugin, index) {
        defineValue(pluginArray, String(index), plugin);
        defineValue(pluginArray, plugin.name, plugin);
      });
      pluginArray.item = mask(function(index) { return plugins[index] || null; });
      pluginArray.namedItem = mask(function(name) { return plugins.find(function(p) { return p.name === name; }) || null; });
      pluginArray.refresh = mask(function() {});
      pluginArray[Symbol.iterator] = mask(function*() { for (const p of plugins) yield p; });

      const mimeTypeArray = Object.create(MimeTypeArray.prototype);
      defineValue(mimeTypeArray, 'length', mimeTypes.length);
      mimeTypes.forEach(function(mimeType, index) {
        defineValue(mimeTypeArray, String(index), mimeType);
        defineValue(mimeTypeArray, mimeType.type, mimeType);
      });
      mimeTypeArray.item = mask(function(index) { return mimeTypes[index] || null; });
      mimeTypeArray.namedItem = mask(function(name) { return mimeTypes.find(function(m) { return m.type === name; }) || null; });
      mimeTypeArray[Symbol.iterator] = mask(function*() { for (const m of mimeTypes) yield m; });
      defineGetter(navigator, 'plugins', function() { return pluginArray; });
      defineGetter(navigator, 'mimeTypes', function() { return mimeTypeArray; });
    } catch (_) {}

    defineGetter(navigator, 'platform', function() { return profileData.platform; });
    defineGetter(navigator, 'vendor', function() { return profileData.vendor; });
    defineGetter(navigator, 'vendorSub', function() { return profileData.vendorSub; });
    defineGetter(navigator, 'languages', function() { return Object.freeze([].concat(profileData.languages)); });
    defineGetter(navigator, 'language', function() { return profileData.languages[0]; });
    defineGetter(navigator, 'hardwareConcurrency', function() { return profileData.hardwareConcurrency; });
    defineGetter(navigator, 'deviceMemory', function() { return profileData.deviceMemory; });
    defineGetter(navigator, 'maxTouchPoints', function() { return profileData.maxTouchPoints; });

    try {
      if ('connection' in navigator) {
        defineGetter(navigator.connection, 'effectiveType', function() { return '4g'; });
        defineGetter(navigator.connection, 'rtt', function() { return 50; });
        defineGetter(navigator.connection, 'downlink', function() { return 10; });
        defineGetter(navigator.connection, 'saveData', function() { return false; });
      }
    } catch (_) {}

    const innerWidth = window.innerWidth || profileData.screenWidth;
    const innerHeight = window.innerHeight || profileData.screenHeight;
    const chromeHeight = 85;
    defineGetter(window, 'outerWidth', function() { return innerWidth; });
    defineGetter(window, 'outerHeight', function() { return innerHeight + chromeHeight; });
    defineGetter(screen, 'width', function() { return profileData.screenWidth; });
    defineGetter(screen, 'height', function() { return profileData.screenHeight; });
    defineGetter(screen, 'availWidth', function() { return profileData.screenAvailWidth; });
    defineGetter(screen, 'availHeight', function() { return profileData.screenAvailHeight; });
    defineGetter(screen, 'colorDepth', function() { return profileData.colorDepth; });
    defineGetter(screen, 'pixelDepth', function() { return profileData.pixelDepth; });
    defineGetter(window, 'screenX', function() { return 0; });
    defineGetter(window, 'screenY', function() { return 0; });
    defineGetter(window, 'screenLeft', function() { return 0; });
    defineGetter(window, 'screenTop', function() { return 0; });
    if (!window.devicePixelRatio || window.devicePixelRatio === 0) {
      defineGetter(window, 'devicePixelRatio', function() { return 1; });
    }

    try {
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      let isProcessing = false;
      const addNoiseToImageData = function(imageData) {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 16) {
          if (data[i + 3] > 0) {
            const noise = Math.floor((random() * 3) - 1);
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
          }
        }
        return imageData;
      };
      HTMLCanvasElement.prototype.toDataURL = mask(function(type, quality) {
        if (isProcessing) return originalToDataURL.call(this, type, quality);
        try {
          isProcessing = true;
          const ctx = this.getContext('2d');
          if (!ctx || !this.width || !this.height) return originalToDataURL.call(this, type, quality);
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = this.width;
          tempCanvas.height = this.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (!tempCtx) return originalToDataURL.call(this, type, quality);
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          addNoiseToImageData(imageData);
          tempCtx.putImageData(imageData, 0, 0);
          return originalToDataURL.call(tempCanvas, type, quality);
        } finally {
          isProcessing = false;
        }
      });
      HTMLCanvasElement.prototype.toBlob = mask(function(callback, type, quality) {
        if (isProcessing) return originalToBlob.call(this, callback, type, quality);
        try {
          isProcessing = true;
          const ctx = this.getContext('2d');
          if (!ctx || !this.width || !this.height) return originalToBlob.call(this, callback, type, quality);
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = this.width;
          tempCanvas.height = this.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (!tempCtx) return originalToBlob.call(this, callback, type, quality);
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          addNoiseToImageData(imageData);
          tempCtx.putImageData(imageData, 0, 0);
          return originalToBlob.call(tempCanvas, callback, type, quality);
        } finally {
          isProcessing = false;
        }
      });
      CanvasRenderingContext2D.prototype.getImageData = mask(function(sx, sy, sw, sh) {
        const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
        if (sw <= 300 && sh <= 300) {
          addNoiseToImageData(imageData);
        }
        return imageData;
      });
    } catch (_) {}

    try {
      const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
      const spoofGetParameter = function(original) {
        return mask(function(parameter) {
          const debugInfo = this.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            if (parameter === debugInfo.UNMASKED_VENDOR_WEBGL || parameter === 0x9245) {
              return profileData.webglVendor;
            }
            if (parameter === debugInfo.UNMASKED_RENDERER_WEBGL || parameter === 0x9246) {
              return profileData.webglRenderer;
            }
          }
          return original.call(this, parameter);
        });
      };
      WebGLRenderingContext.prototype.getParameter = spoofGetParameter(originalGetParameter);
      if (typeof WebGL2RenderingContext !== 'undefined') {
        WebGL2RenderingContext.prototype.getParameter = spoofGetParameter(WebGL2RenderingContext.prototype.getParameter);
      }
      const originalGetSupportedExtensions = WebGLRenderingContext.prototype.getSupportedExtensions;
      WebGLRenderingContext.prototype.getSupportedExtensions = mask(function() {
        const extensions = originalGetSupportedExtensions.call(this) || [];
        if (!extensions.includes('WEBGL_debug_renderer_info')) extensions.push('WEBGL_debug_renderer_info');
        return extensions;
      });
    } catch (_) {}

    try {
      if (typeof AnalyserNode !== 'undefined') {
        const originalGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = mask(function(array) {
          originalGetFloatFrequencyData.call(this, array);
          for (let i = 0; i < array.length; i++) array[i] += (random() - 0.5) * 0.01;
        });
        const originalGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
        AnalyserNode.prototype.getByteFrequencyData = mask(function(array) {
          originalGetByteFrequencyData.call(this, array);
          for (let i = 0; i < array.length; i++) array[i] = Math.max(0, Math.min(255, array[i] + Math.floor(random() * 3) - 1));
        });
      }
      if (typeof AudioBuffer !== 'undefined') {
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = mask(function(channel) {
          const data = originalGetChannelData.call(this, channel);
          if (data.length < 50000) {
            for (let i = 0; i < data.length; i++) data[i] += (random() - 0.5) * 0.0001;
          }
          return data;
        });
      }
    } catch (_) {}

    try {
      if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = mask(async function(permissionDesc) {
          const result = await originalQuery(permissionDesc);
          if (permissionDesc && permissionDesc.name === 'notifications') {
            const notificationPermission = Notification.permission;
            return new Proxy(result, {
              get: function(target, prop) {
                if (prop === 'state') {
                  if (notificationPermission === 'granted') return 'granted';
                  if (notificationPermission === 'denied') return 'denied';
                  return 'prompt';
                }
                return target[prop];
              }
            });
          }
          return result;
        });
      }
    } catch (_) {}

    if (patchClientHints) {
      try {
        const userAgentData = {
          brands: clientHintsData.brands.map(function(b) { return Object.freeze({ brand: b.brand, version: b.version }); }),
          mobile: clientHintsData.mobile,
          platform: clientHintsData.platform,
          getHighEntropyValues: mask(function(hints) {
            hints = Array.isArray(hints) ? hints : [];
            return Promise.resolve({
              brands: clientHintsData.brands.map(function(b) { return Object.freeze({ brand: b.brand, version: b.version }); }),
              fullVersionList: clientHintsData.fullVersionList.map(function(b) { return Object.freeze({ brand: b.brand, version: b.version }); }),
              mobile: clientHintsData.mobile,
              model: clientHintsData.model,
              platform: clientHintsData.platform,
              platformVersion: clientHintsData.platformVersion,
              architecture: clientHintsData.architecture,
              bitness: clientHintsData.bitness,
              uaFullVersion: clientHintsData.fullVersionList[0] ? clientHintsData.fullVersionList[0].version : '',
            });
          }),
          toJSON: mask(function() {
            return {
              brands: clientHintsData.brands,
              mobile: clientHintsData.mobile,
              platform: clientHintsData.platform,
            };
          }),
        };
        Object.freeze(userAgentData.brands);
        defineGetter(navigator, 'userAgentData', function() { return userAgentData; });
      } catch (_) {}
    }

    if (patchInputCoordinates) {
      try {
        const OriginalMouseEvent = window.MouseEvent;
        const toolbarHeight = 85;
        const windowX = window.screenX || 0;
        const windowY = window.screenY || 0;
        function PatchedMouseEvent(type, eventInitDict) {
          if (eventInitDict) {
            const init = Object.assign({}, eventInitDict);
            const clientX = init.clientX || 0;
            const clientY = init.clientY || 0;
            if (init.screenX === clientX && init.screenY === clientY) {
              init.screenX = clientX + windowX;
              init.screenY = clientY + windowY + toolbarHeight;
            }
            return new OriginalMouseEvent(type, init);
          }
          return new OriginalMouseEvent(type, eventInitDict);
        }
        PatchedMouseEvent.prototype = OriginalMouseEvent.prototype;
        Object.setPrototypeOf(PatchedMouseEvent, OriginalMouseEvent);
        mask(PatchedMouseEvent);
        window.MouseEvent = PatchedMouseEvent;
        if (typeof PointerEvent !== 'undefined') {
          const OriginalPointerEvent = window.PointerEvent;
          function PatchedPointerEvent(type, eventInitDict) {
            if (eventInitDict) {
              const init = Object.assign({}, eventInitDict);
              const clientX = init.clientX || 0;
              const clientY = init.clientY || 0;
              if (init.screenX === clientX && init.screenY === clientY) {
                init.screenX = clientX + windowX;
                init.screenY = clientY + windowY + toolbarHeight;
              }
              return new OriginalPointerEvent(type, init);
            }
            return new OriginalPointerEvent(type, eventInitDict);
          }
          PatchedPointerEvent.prototype = OriginalPointerEvent.prototype;
          Object.setPrototypeOf(PatchedPointerEvent, OriginalPointerEvent);
          mask(PatchedPointerEvent);
          window.PointerEvent = PatchedPointerEvent;
        }
      } catch (_) {}
    }

    if (blockWebRTC) {
      try {
        const originalRTCPeerConnection = window.RTCPeerConnection;
        function BlockedRTCPeerConnection() {
          throw new DOMException("Failed to construct 'RTCPeerConnection': WebRTC is disabled", 'NotSupportedError');
        }
        if (originalRTCPeerConnection) {
          BlockedRTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
        }
        mask(BlockedRTCPeerConnection);
        Object.defineProperty(window, 'RTCPeerConnection', {
          value: BlockedRTCPeerConnection,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        if (window.webkitRTCPeerConnection) {
          Object.defineProperty(window, 'webkitRTCPeerConnection', {
            value: BlockedRTCPeerConnection,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
        if (navigator.mediaDevices) {
          if (navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia = mask(function(constraints) {
              if (constraints && (constraints.video || constraints.audio)) {
                return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
              }
              return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
            });
          }
          if (navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices = mask(function() { return Promise.resolve([]); });
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
})();
"###;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_include_fork_profiles() {
        let profiles = list_profiles();
        assert!(profiles.contains(&"chrome-windows"));
        assert!(profiles.contains(&"chrome-mac"));
        assert!(profiles.contains(&"mobile-android"));
    }

    #[test]
    fn chrome_args_include_automation_control_flag() {
        let config = StealthConfig::new(true, Some("chrome-windows".to_string())).unwrap();
        let args = chrome_args(&config, true, false);
        assert!(args.contains(&"--disable-blink-features=AutomationControlled".to_string()));
        assert!(args.contains(&"--disable-webrtc".to_string()));
    }

    #[test]
    fn init_script_contains_core_patches() {
        let config = StealthConfig::new(true, Some("chrome-windows".to_string())).unwrap();
        let script = init_script(&config);
        assert!(script.contains("webdriver"));
        assert!(script.contains("window.chrome"));
        assert!(script.contains("toDataURL"));
        assert!(script.contains("userAgentData"));
    }

    #[test]
    fn client_hint_headers_match_profile() {
        let config = StealthConfig::new(true, Some("chrome-windows".to_string())).unwrap();
        let headers = client_hint_headers(&config);
        assert!(headers
            .get("sec-ch-ua")
            .is_some_and(|value| value.contains("Google Chrome")));
        assert_eq!(
            headers.get("sec-ch-ua-platform").map(String::as_str),
            Some("\"Windows\"")
        );
        assert!(!headers.contains_key("sec-ch-ua-arch"));
    }

    #[test]
    fn full_client_hint_mode_sends_high_entropy_headers() {
        let mut config = StealthConfig::new(true, Some("chrome-windows".to_string())).unwrap();
        config.client_hints_mode = ClientHintsMode::Full;
        let headers = client_hint_headers(&config);
        assert_eq!(
            headers.get("sec-ch-ua-arch").map(String::as_str),
            Some("\"x86\"")
        );
        assert!(headers.contains_key("sec-ch-ua-full-version-list"));
    }

    #[test]
    fn browser_version_rewrites_user_agent_and_client_hints() {
        let mut config = StealthConfig::new(true, Some("chrome-windows".to_string())).unwrap();
        config.apply_browser_version(
            Some("Chrome/145.0.7654.21"),
            Some("Mozilla/5.0 Chrome/145.0.7654.21 Safari/537.36"),
        );

        let user_agent = user_agent(&config);
        assert!(user_agent.contains("Chrome/145.0.7654.21"));

        let metadata = user_agent_metadata(&config).unwrap();
        let brands = metadata
            .get("brands")
            .and_then(|value| value.as_array())
            .unwrap();
        assert!(brands.iter().any(|brand| {
            brand.get("brand").and_then(|value| value.as_str()) == Some("Google Chrome")
                && brand.get("version").and_then(|value| value.as_str()) == Some("145")
        }));
    }
}
