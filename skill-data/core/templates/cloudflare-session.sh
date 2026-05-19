#!/bin/bash
# Template: Reuse a CloudFlare-protected session via session bundle
#
# Purpose: drive an automated job against a site behind CloudFlare (or any
# bot manager that pins auth to fingerprint) by capturing cookies + UA +
# every sec-ch-ua-* Client Hint from a real logged-in browser and replaying
# them at launch.
#
# Usage: ./cloudflare-session.sh <bundle-name> <url> [headers-file]
#
#   <bundle-name>   name to store the bundle under
#                   (lives at ~/.agent-browser/sessions/<bundle-name>/)
#   <url>           protected URL to navigate to after launch
#   [headers-file]  optional path with pasted DevTools "Request headers"
#                   block. If omitted, the script reads stdin.
#
# Capture instructions:
#   1. Log in to the protected site in your everyday Chrome.
#   2. DevTools → Network → click any successful authenticated request.
#   3. Right-click → Copy → "Copy request headers".
#   4. Either save the paste to <headers-file> or pipe it into stdin:
#        pbpaste | ./cloudflare-session.sh h1 https://hackerone.com/bugs
#
# Required environment: agent-browser run on the same machine as the source
# browser so the egress IP matches the one that minted cf_clearance.

set -euo pipefail

BUNDLE_NAME="${1:?Usage: $0 <bundle-name> <url> [headers-file]}"
TARGET_URL="${2:?Usage: $0 <bundle-name> <url> [headers-file]}"
HEADERS_INPUT="${3:--}"   # default to stdin

echo "Importing session bundle '$BUNDLE_NAME'…"
if [[ "$HEADERS_INPUT" == "-" ]]; then
    agent-browser session import --from - --name "$BUNDLE_NAME"
else
    agent-browser session import --from "$HEADERS_INPUT" --name "$BUNDLE_NAME"
fi

echo
echo "Bundle summary:"
agent-browser session show "$BUNDLE_NAME"

echo
echo "Launching $TARGET_URL with bundle '$BUNDLE_NAME'…"
agent-browser --import-session "$BUNDLE_NAME" open "$TARGET_URL"

# Smoke test: a logged-in page should NOT show a CloudFlare interstitial.
# If you see a 403 or a challenge, see references/session-bundles.md →
# "Limits to be honest about" — most failures are (a) IP changed since
# capture, (b) Chrome major version mismatch, or (c) stale cookie.
agent-browser snapshot -i | head -40

echo
echo "Bundle '$BUNDLE_NAME' is reusable. Subsequent runs:"
echo "  agent-browser --import-session $BUNDLE_NAME open <url>"
echo
echo "Refresh with the same name when the session goes stale:"
echo "  pbpaste | agent-browser session import --from - --name $BUNDLE_NAME"
