#!/usr/bin/env bash
set -euo pipefail

models="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/.models"
revision=4f5ae23172ba60fd7bc11ef671cca678842c7072
checksum=13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609
weights=video_depth_anything_vits.pth
mkdir -p "$models"
staging="$(mktemp -d "$models/.download.XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT

if [[ ! -d "$models/video-depth-anything" ]]; then
    git init -q "$staging/source"
    git -C "$staging/source" fetch --depth 1 https://github.com/DepthAnything/Video-Depth-Anything.git "$revision"
    git -C "$staging/source" checkout -q --detach FETCH_HEAD
    mv -- "$staging/source" "$models/video-depth-anything"
fi
if [[ "$(git -C "$models/video-depth-anything" rev-parse HEAD)" != "$revision" ]]; then
    printf 'Unexpected model source revision. Move %s aside and run setup again.\n' "$models/video-depth-anything" >&2
    exit 1
fi

if [[ ! -f "$models/$weights" ]] || ! (cd -- "$models" && printf '%s  %s\n' "$checksum" "$weights" | sha256sum --check --status); then
    curl --fail --location --retry 2 --max-time 240 \
        'https://huggingface.co/depth-anything/Video-Depth-Anything-Small/resolve/main/video_depth_anything_vits.pth?download=true' \
        -o "$staging/$weights"
    (cd -- "$staging" && printf '%s  %s\n' "$checksum" "$weights" | sha256sum --check)
    mv -- "$staging/$weights" "$models/$weights"
fi
printf 'Video Depth Anything Small installed in %s\n' "$models"
