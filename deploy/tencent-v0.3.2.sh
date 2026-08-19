#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export ZQMUSIC_VERSION="v0.3.2"
exec bash "${SCRIPT_DIR}/tencent-v0.3.1.sh"
