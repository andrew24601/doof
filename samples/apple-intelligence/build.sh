#!/bin/bash
# build.sh — Build the Apple Intelligence sample
#
# Compiles the Doof-generated C++ code together with the Swift bridge
# to Apple Intelligence's FoundationModels framework.
#
# Source files (this directory):
#   apple-intelligence.do          — Doof source
#   apple_intelligence_bridge.hpp  — C++ bridge header
#   apple_intelligence_impl.swift  — Swift FoundationModels implementation
#
# Generated C++ (../../build-apple/):
#   apple-intelligence.cpp / .hpp  — emitted by the Doof compiler
#   doof_runtime.hpp               — emitted runtime header
#
# Requirements:
#   - macOS 26+ SDK (Xcode 18+)
#   - Apple Silicon Mac
#   - swiftc and clang++ available (Xcode or Swift toolchain)
#
# Usage:
#   cd samples/apple-intelligence && ./build.sh
#
# The resulting binary is ../../build-apple/apple-intelligence.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$(cd "$SCRIPT_DIR/../../build-apple" && pwd)"

# ── Colours (if terminal supports them) ───────────────────────────────────
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

# ── Verify toolchain ─────────────────────────────────────────────────────
if ! command -v swiftc &>/dev/null; then
    error "swiftc not found — install Xcode or the Swift toolchain"
    exit 1
fi
if ! command -v clang++ &>/dev/null; then
    error "clang++ not found — install Xcode command-line tools (xcode-select --install)"
    exit 1
fi

SDK_PATH=$(xcrun --show-sdk-path 2>/dev/null || echo "")
if [[ -z "$SDK_PATH" ]]; then
    error "Could not determine SDK path — make sure Xcode command-line tools are installed"
    exit 1
fi

info "Using SDK: ${SDK_PATH}"
info "swiftc: $(swiftc --version 2>&1 | head -1)"

# ── Check for FoundationModels framework ──────────────────────────────────
FM_FLAGS=""
if [[ -d "$SDK_PATH/System/Library/Frameworks/FoundationModels.framework" ]]; then
    info "FoundationModels framework found — Apple Intelligence support enabled"
    FM_FLAGS="-framework FoundationModels"
else
    warn "FoundationModels framework not found in the SDK"
    warn "The binary will compile but Apple Intelligence calls will return errors at runtime"
    warn "(Requires macOS 26+ SDK / Xcode 18+)"
fi

# ── Stage the bridge header into the build directory ─────────────────────
# The emitter-generated apple-intelligence.hpp uses #include "./apple_intelligence_bridge.hpp"
# (relative to build-apple/).  Copying it there keeps the generated code untouched.
info "Staging bridge header into build directory…"
cp "$SCRIPT_DIR/apple_intelligence_bridge.hpp" "$BUILD_DIR/apple_intelligence_bridge.hpp"

# ── Step 1: Compile Swift bridge ─────────────────────────────────────────
info "Compiling Swift bridge (apple_intelligence_impl.swift)…"
swiftc \
    -parse-as-library \
    -emit-object \
    -O \
    -sdk "$SDK_PATH" \
    "$SCRIPT_DIR/apple_intelligence_impl.swift" \
    -o "$BUILD_DIR/apple_intelligence_impl.o"

# ── Step 2: Compile C++ code ─────────────────────────────────────────────
info "Compiling C++ (apple-intelligence.cpp)…"
clang++ \
    -std=c++17 \
    -O2 \
    -isysroot "$SDK_PATH" \
    -I"$BUILD_DIR" \
    -c "$BUILD_DIR/apple-intelligence.cpp" \
    -o "$BUILD_DIR/apple-intelligence.o"

# ── Step 3: Link with swiftc (handles Swift runtime paths automatically) ─
info "Linking…"
swiftc \
    "$BUILD_DIR/apple-intelligence.o" \
    "$BUILD_DIR/apple_intelligence_impl.o" \
    -sdk "$SDK_PATH" \
    -Xlinker -lc++ \
    -framework Foundation \
    $FM_FLAGS \
    -o "$BUILD_DIR/apple-intelligence"

# ── Done ──────────────────────────────────────────────────────────────────
info "Build complete: ${BOLD}${BUILD_DIR}/apple-intelligence${RESET}"
echo ""
echo "Run with:"
echo "  ./build-apple/apple-intelligence"
