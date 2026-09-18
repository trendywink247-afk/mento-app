#!/usr/bin/env bash
# Renamed to deploy-web.sh (2026-09-19: the build is the whole web app, not a
# console). This wrapper keeps muscle memory + old docs working for one release.
exec "$(dirname "${BASH_SOURCE[0]}")/deploy-web.sh" "$@"
