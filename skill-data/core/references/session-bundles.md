# Session bundles

A **session bundle** is a named, reusable snapshot of a logged-in browser's
**cookies + User-Agent + every `sec-ch-ua-*` Client Hint + accept-language**.
Apply it at launch with `--import-session <name>` to drive automated jobs
against a site that pins authentication to fingerprint (CloudFlare,
Akamai Bot Manager, etc.) without re-authenticating each run.

Bundles are stored under `~/.agent-browser/sessions/<name>/` and honour
`AGENT_BROWSER_ENCRYPTION_KEY` for at-rest encryption.

## When to use

- The target site uses CloudFlare (`cf_clearance` cookie present) or another
  bot manager that validates UA-CH or fingerprint on every request.
- The user has a valid logged-in session in their own Chrome.
- The agent will run on the same machine — or behind a proxy that egresses
  through the same IP — as the source browser.

When **not** to use:

- For ordinary cookie-only auth that doesn't validate UA-CH, prefer
  `cookies set --curl <file>` (simpler, no UA spoofing).
- If you need to log in fresh from a clean state, use the auth vault
  (`auth save` / `auth login`) instead.

## End-to-end runbook

```bash
# 1. In the user's everyday Chrome:
#      DevTools → Network tab → click any successful authenticated request
#      → right-click → Copy → "Copy request headers"
#    (The pasted block starts with ":authority\n<host>\n:method\n...\nuser-agent\n...\ncookie\n...")

# 2. Create the bundle. Auto-detects format; pipe via stdin or pass a file.
pbpaste | agent-browser session import --from - --name <bundle-name>
#   - macOS: pbpaste reads the clipboard
#   - Linux: xclip -o; or save the paste to a file first

# 3. Verify what was captured. Cookie values stay on disk; only names print.
agent-browser session show <bundle-name>

# 4. Launch authenticated. Implies --stealth.
agent-browser --import-session <bundle-name> open https://app.example.com
agent-browser snapshot -i   # confirm the logged-in UI is rendered
```

The CLI prints a summary on import:

```
Imported session bundle 'h1'
  path:           /Users/you/.agent-browser/sessions/h1
  source format:  devtools
  origin:         https://hackerone.com
  cookies:        7
  sec-ch-ua-*:    9
  user-agent:     Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Apple…
```

## Four supported input formats

`session import --from <file|->` auto-detects, or pass `--format <name>` to
force one:

| Format | When DevTools gives you this | Hint flag |
|---|---|---|
| **DevTools paste** | Right-click → Copy → "Copy request headers" (multi-line `key\nvalue`) | `--format devtools` |
| **cURL** | Right-click → Copy → "Copy as cURL" | `--format curl` |
| **HAR** | DevTools → Network → ⏬ "Export HAR…" — picks the most recent 2xx entry for the dominant host | `--format har` |
| **Playwright storage state** | The JSON that `agent-browser state save` produces (`cookies` + `origins`) | `--format state` |

The cURL parser harvests every `-H 'name: value'` flag, not just the cookie
header — so UA + UA-CH come along for free.

## Combining with other flags

| Combination | Behaviour |
|---|---|
| `--import-session` + `--state <path>` | Bundle and `--state` both load; bundle wins for its origin's cookies. Useful when the bundle covers one origin and `--state` covers others. |
| `--import-session` + `--profile <name>` | **Rejected** at startup. Pick one persistence strategy — a Chrome profile would silently override the bundle's UA. |
| `--import-session` + `--stealth-profile <base>` | Base profile picks the OS scaffolding; bundle overrides UA + UA-CH on top. Useful when bundle was captured on a different OS than the running machine. |
| `--import-session` without `--stealth` | Implicitly enables stealth. UA-CH spoofing requires the stealth init script. |
| `--import-session` + `--user-agent <ua>` | Explicit `--user-agent` wins; bundle UA is ignored (preserves existing precedence). |

## Inspecting and managing bundles

```bash
agent-browser session bundles         # list all bundles by name
agent-browser session show <name>     # manifest + UA, UA-CH, cookie names
agent-browser session delete <name>   # remove a bundle's on-disk files
```

`session show` is safe to print to a chat — it shows UA-CH header values
(low-sensitivity) and cookie *names* but never cookie *values*.

## Refreshing a stale bundle

If CloudFlare re-challenges, the bundle is stale. Re-paste fresh headers and
overwrite by name:

```bash
pbpaste | agent-browser session import --from - --name <same-name>
```

The on-disk files are atomically replaced.

## Limits to be honest about

- **TLS fingerprint is whatever your local Chromium ships.** agent-browser
  does not customise the TLS ClientHello. This is fine for CloudFlare *when
  the Chrome major version matches the bundle's*. The mismatch warning at
  launch tells you when it doesn't.
- **IP must match.** `cf_clearance` is bound to the egress IP. Run on the
  same machine as the source browser, or use a same-IP proxy
  (Tailscale / SSH SOCKS / residential proxy through your home network).
- **No Turnstile auto-solve.** If a fresh interactive challenge appears,
  solve it in your real browser, re-paste headers, re-import.
- **Bundles are per-origin in practice.** A bundle's UA + UA-CH apply
  globally to the agent's traffic, but the cookies and `cf_clearance` are
  origin-scoped. One bundle per protected site keeps things clean.

## Security

- Bundles live at `~/.agent-browser/sessions/<name>/bundle.json` +
  `cookies.json` + optional `storage.json`. They contain authentication
  cookies in plaintext unless `AGENT_BROWSER_ENCRYPTION_KEY` is set — when
  the env var is present, all three blobs are AES-256-GCM encrypted (same
  scheme `state save` uses).
- See [trust-boundaries.md](trust-boundaries.md) for what an agent driving
  the browser can and cannot reach.

## See also

- [session-management.md](session-management.md) — comparison of bundles vs
  `--session-name` vs `--profile` vs `--state`.
- [stealth-mode.md](stealth-mode.md) — what the stealth init script patches
  and how bundle UA + UA-CH layer on top.
- [authentication.md](authentication.md) — auth vault, OAuth flows, the
  full set of login strategies.
