#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Error: this script is intended for macOS." >&2
  exit 1
fi

DEVICE_IDENTIFIER="${1:-${DOOF_IOS_DEVICE:-}}"
SIGN_IDENTITY="${DOOF_IOS_SIGN_IDENTITY:-}"
PROVISIONING_PROFILE="${DOOF_IOS_PROVISIONING_PROFILE:-}"

if [[ -z "$DEVICE_IDENTIFIER" ]]; then
  echo "Error: provide a connected device identifier as the first argument or set DOOF_IOS_DEVICE." >&2
  echo "Example:" >&2
  echo "  xcrun devicectl list devices" >&2
  echo "  DOOF_IOS_DEVICE=<udid> DOOF_IOS_SIGN_IDENTITY='Apple Development: Name (TEAMID)' DOOF_IOS_PROVISIONING_PROFILE=~/Library/MobileDevice/Provisioning\ Profiles/profile.mobileprovision bash scripts/build-solitaire-ios-device.sh" >&2
  exit 1
fi

if [[ -z "$SIGN_IDENTITY" || -z "$PROVISIONING_PROFILE" ]]; then
  echo "Error: set DOOF_IOS_SIGN_IDENTITY and DOOF_IOS_PROVISIONING_PROFILE for device signing." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "1/2: Building TypeScript (dist/cli.js)"
npm run build

echo "2/2: Building, signing, installing, and launching Doof Solitaire on iOS device $DEVICE_IDENTIFIER"
node dist/cli.js run \
  --target ios-app \
  --ios-destination device \
  --ios-device "$DEVICE_IDENTIFIER" \
  --ios-sign-identity "$SIGN_IDENTITY" \
  --ios-provisioning-profile "$PROVISIONING_PROFILE" \
  samples/solitaire