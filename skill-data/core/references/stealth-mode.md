# Stealth Mode

Stealth mode is a browser fingerprint consistency layer for authorized
vulnerability research, application testing, and lab environments. It reduces
common automation-specific browser artifacts, but it is not an anonymity
system and does not bypass network-level controls such as IP reputation, TLS
fingerprinting, proxy quality, account history, or CAPTCHA workflows.

## Basic Use

```bash
agent-browser --stealth open https://target.example
agent-browser --stealth --stealth-profile chrome-mac open https://target.example
```

Profiles:

- `chrome-windows`
- `chrome-mac`
- `chrome-linux`
- `mobile-android`
- `mobile-ios`

If no profile is provided, agent-browser chooses a desktop Chrome profile
matching the host OS where possible.

## Capabilities

- **Launch hardening** - Adds Chromium launch flags that reduce common
  automation-specific browser surfaces.
- **Runtime fingerprint patches** - Registers page init scripts for navigator,
  screen, WebGL/canvas/audio, plugins, permissions, visibility, Chrome runtime
  shape, WebRTC behavior, and input coordinate artifacts.
- **Full session coverage** - Applies stealth setup to existing pages, new
  tabs, popups, attached CDP targets, cross-origin iframe sessions, and
  isolated recording contexts.
- **Browser version alignment** - Reads `Browser.getVersion` and rewrites the
  generated Chrome User-Agent and User-Agent Client Hints metadata to match
  the running browser version.
- **Client Hint modes** - Defaults to `accept-ch`, which sends low-entropy HTTP
  Client Hints while keeping full JS/CDP metadata consistent. Use `full` only
  in controlled lab tests.
- **Input realism** - Adds CDP mouse timestamps, pointer type, and small
  movement interpolation when enabled.

## Advanced Configuration

Use `stealthOptions` in `agent-browser.json`:

```json
{
  "stealth": true,
  "stealthProfile": "chrome-mac",
  "stealthOptions": {
    "clientHintsMode": "accept-ch",
    "inputRealism": "balanced",
    "typingRealism": "off",
    "blockWebRTC": true,
    "useSystemChrome": false,
    "clientHints": true,
    "inputCoordinates": true
  }
}
```

Options:

- `blockWebRTC` (`true`) - Apply WebRTC launch/runtime restrictions.
- `useSystemChrome` (`false`) - Prefer installed system Chrome/Chromium when
  available.
- `clientHints` (`true`) - Apply User-Agent Client Hints metadata and headers.
- `clientHintsMode` (`accept-ch`) - `low-entropy`, `accept-ch`, or `full`.
- `inputCoordinates` (`true`) - Patch page-observed click coordinate artifacts.
- `inputRealism` (`balanced`) - `off`, `balanced`, or `aggressive` for CDP
  mouse timestamping and movement interpolation.
- `typingRealism` (`off`) - Reserved typing cadence mode; currently defaults
  off to keep typing deterministic.

The same controls can be set with environment variables:

```bash
AGENT_BROWSER_STEALTH=1
AGENT_BROWSER_STEALTH_PROFILE=chrome-mac
AGENT_BROWSER_STEALTH_CLIENT_HINTS_MODE=accept-ch
AGENT_BROWSER_STEALTH_INPUT_REALISM=balanced
AGENT_BROWSER_STEALTH_TYPING_REALISM=off
AGENT_BROWSER_STEALTH_BLOCK_WEBRTC=1
AGENT_BROWSER_STEALTH_USE_SYSTEM_CHROME=0
AGENT_BROWSER_STEALTH_CLIENT_HINTS=1
AGENT_BROWSER_STEALTH_INPUT_COORDINATES=1
```

## Operational Notes

- Stealth setup is registered before navigation on local launch paths and
  re-applied when new CDP sessions attach.
- Existing external CDP pages may already have executed page JavaScript before
  agent-browser connects. Stealth is still registered for the next document and
  evaluated on the current context where possible.
- Provider implementations can add their own stealth handling. The global
  `--stealth` flag and `AGENT_BROWSER_STEALTH` environment variable are
  forwarded where compatible.
- For scoped security testing, combine stealth mode with `--allowed-domains`,
  `--action-policy`, and a dedicated browser profile or storage state.
