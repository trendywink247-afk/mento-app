#!/usr/bin/env bash
# Retained only to explain the replacement to callers and the old console wrapper.
# Local rebuilds and direct production directory swaps bypass accepted artifacts.
set -euo pipefail
cat >&2 <<'MESSAGE'
Direct web deployment is retired. No build, upload or server change was made.
Use Staging Release to build and accept a candidate, then Production Release to
promote that same artifact after the documented operational gates pass.
See docs/RELEASE_PIPELINES.md. Production promotion must remain locked until ready.
MESSAGE
exit 1
