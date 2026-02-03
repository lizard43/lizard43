#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <image.jpg>"
  exit 1
fi

IMG="$1"
if [[ ! -f "$IMG" ]]; then
  echo "File not found: $IMG"
  exit 1
fi

# ====== even ======
# LEFT=40
# RIGHT=152
# TOP=150
# BOTTOM=170
# ==========================================

# ====== odd ======
LEFT=36
RIGHT=156
TOP=150
BOTTOM=170
# ==========================================


# Read original size (WxH)
orig="$(identify -format '%w %h' "$IMG" 2>/dev/null || true)"
if [[ -z "$orig" ]]; then
  echo "identify failed (is ImageMagick installed? is it a valid image?): $IMG"
  exit 1
fi
read -r W H <<<"$orig"

NEW_W=$(( W - LEFT - RIGHT ))
NEW_H=$(( H - TOP - BOTTOM ))

if (( NEW_W <= 0 || NEW_H <= 0 )); then
  echo "Crop margins too large for image size."
  echo "Image: ${W}x${H}"
  echo "Margins: L=$LEFT R=$RIGHT T=$TOP B=$BOTTOM"
  exit 1
fi

echo "Input : $IMG"
echo "Before: ${W}x${H}"
echo "Crop  : ${NEW_W}x${NEW_H}+${LEFT}+${TOP}  (remove L=$LEFT R=$RIGHT T=$TOP B=$BOTTOM)"

# Overwrite in place (you said git is your safety net)
convert "$IMG" -crop "${NEW_W}x${NEW_H}+${LEFT}+${TOP}" +repage "$IMG"

echo "After : $(identify -format '%wx%h' "$IMG")"

