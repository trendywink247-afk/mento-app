#!/usr/bin/env bash
# /usr/local/sbin/qa-agent/apk-publish.sh — install the newest staged QA APK release (run as root).
# Installed once by root, then allowed for the agent in sudoers (see infra/qa-agent/README.md).
# It takes NO arguments: it installs only the tarball that ops/qa-apk.sh staged in the agent's out dir,
# only if the name is web-<sha>-qa-apk<N>.tar.gz and the checksum file next to it matches.
set -euo pipefail
OUT=/home/agent/qa-apk-out
[ "$(id -u)" -eq 0 ] || { echo "apk-publish: must run as root" >&2; exit 1; }
[ $# -eq 0 ] || { echo "apk-publish: takes no arguments" >&2; exit 1; }
TAR=$(readlink -f "$OUT/latest.tar.gz")
case "$TAR" in "$OUT"/web-*-qa-apk*.tar.gz) ;; *) echo "apk-publish: unexpected path $TAR" >&2; exit 1;; esac
[[ "$(basename "$TAR")" =~ ^web-[0-9a-f]{7}-qa-apk[0-9]+\.tar\.gz$ ]] || { echo "apk-publish: bad name" >&2; exit 1; }
# Copy into a root-owned place first so the agent cannot swap the file between the check and the install.
WORK=$(mktemp -d /var/tmp/apk-publish.XXXXXX); trap 'rm -rf "$WORK"' EXIT
cp "$TAR" "$TAR.sha256" "$WORK"/
exec /usr/local/sbin/qa-install-web "$WORK/$(basename "$TAR")"
