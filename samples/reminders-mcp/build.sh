#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$REPO_DIR/build-reminders-mcp"
APP_DIR="$BUILD_DIR/DoofRemindersMCP.app"
APP_CONTENTS="$APP_DIR/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BIN="$APP_MACOS/doof-reminders-mcp"

if [[ -t 1 ]]; then
    BOLD="\033[1m"
    GREEN="\033[32m"
    YELLOW="\033[33m"
    RED="\033[31m"
    RESET="\033[0m"
else
    BOLD="" GREEN="" YELLOW="" RED="" RESET=""
fi

info()  { echo -e "${BOLD}${GREEN}==>${RESET} $*"; }
warn()  { echo -e "${BOLD}${YELLOW}warning:${RESET} $*"; }
error() { echo -e "${BOLD}${RED}error:${RESET} $*" >&2; }

if ! command -v swiftc >/dev/null 2>&1; then
    error "swiftc not found — install Xcode or the Swift toolchain"
    exit 1
fi

if ! command -v clang++ >/dev/null 2>&1; then
    error "clang++ not found — install Xcode command-line tools"
    exit 1
fi

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
if [[ -z "$SDK_PATH" ]]; then
    error "Could not determine the macOS SDK path"
    exit 1
fi

if [[ ! -f "$REPO_DIR/dist/cli.js" ]]; then
    error "dist/cli.js not found — run npm run build first"
    exit 1
fi

info "Emitting Doof sources"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

node "$REPO_DIR/dist/cli.js" emit -o "$BUILD_DIR" "$SCRIPT_DIR/main.do"

info "Staging native headers"
cp "$SCRIPT_DIR/native_mcp_stdio.hpp" "$BUILD_DIR/native_mcp_stdio.hpp"
cp "$SCRIPT_DIR/reminders_bridge.hpp" "$BUILD_DIR/reminders_bridge.hpp"

info "Compiling Swift bridge"
swiftc \
    -parse-as-library \
    -emit-object \
    -O \
    -sdk "$SDK_PATH" \
    "$SCRIPT_DIR/reminders_impl.swift" \
    -o "$BUILD_DIR/reminders_impl.o"

CPP_OBJECTS=()
info "Compiling generated C++"
while IFS= read -r -d '' cppFile; do
    objFile="${cppFile%.cpp}.o"
    clang++ \
        -std=c++17 \
        -O2 \
        -isysroot "$SDK_PATH" \
        -I"$BUILD_DIR" \
        -c "$cppFile" \
        -o "$objFile"
    CPP_OBJECTS+=("$objFile")
done < <(find "$BUILD_DIR" -maxdepth 1 -name '*.cpp' -print0 | sort -z)

mkdir -p "$APP_MACOS" "$APP_RESOURCES"

info "Writing Info.plist"
cat > "$APP_CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>doof-reminders-mcp</string>
  <key>CFBundleIdentifier</key>
  <string>com.doof.samples.remindersmcp</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Doof Reminders MCP</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSRemindersFullAccessUsageDescription</key>
  <string>Doof Reminders MCP needs access to read and modify your reminders on your behalf.</string>
</dict>
</plist>
PLIST

info "Linking bundled MCP executable"
swiftc \
    "${CPP_OBJECTS[@]}" \
    "$BUILD_DIR/reminders_impl.o" \
    -sdk "$SDK_PATH" \
    -Xlinker -lc++ \
    -framework Foundation \
    -framework EventKit \
    -o "$APP_BIN"

info "Build complete"
echo ""
echo "App bundle: $APP_DIR"
echo "Launch target for MCP hosts: $APP_BIN"