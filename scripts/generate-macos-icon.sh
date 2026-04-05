#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <input-svg> <output-icns>" >&2
  exit 1
fi

INPUT_SVG="$1"
OUTPUT_ICNS="$2"

for tool in qlmanage sips iconutil; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required macOS tool: $tool" >&2
    exit 1
  fi
done

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/doof-solitaire-icon.XXXXXX")"
ICONSET_DIR="$WORK_DIR/DoofSolitaire.iconset"
PREVIEW_DIR="$WORK_DIR/preview"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$ICONSET_DIR" "$PREVIEW_DIR"

qlmanage -t -s 1024 -o "$PREVIEW_DIR" "$INPUT_SVG" >/dev/null

MASTER_PNG="$(find "$PREVIEW_DIR" -name '*.png' -print -quit)"
if [ -z "$MASTER_PNG" ]; then
  echo "Failed to rasterize $INPUT_SVG" >&2
  exit 1
fi

render_icon() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$MASTER_PNG" --out "$ICONSET_DIR/$name" >/dev/null
}

render_icon 16 icon_16x16.png
render_icon 32 icon_16x16@2x.png
render_icon 32 icon_32x32.png
render_icon 64 icon_32x32@2x.png
render_icon 128 icon_128x128.png
render_icon 256 icon_128x128@2x.png
render_icon 256 icon_256x256.png
render_icon 512 icon_256x256@2x.png
render_icon 512 icon_512x512.png
render_icon 1024 icon_512x512@2x.png

mkdir -p "$(dirname "$OUTPUT_ICNS")"
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"