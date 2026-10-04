#!/usr/bin/env bash
# Copy ciphertext only, then read back bytes instead of trusting SFTP metadata.
# This verifies transport integrity, not decryption, custody or restore readiness.
set -euo pipefail
umask 077
source_file=${1:?age archive required}
remote_directory=${2:?configured rclone destination directory required}
test -f "$source_file" && test ! -L "$source_file"
IFS= read -r header < "$source_file"
test "$header" = age-encryption.org/v1 || { echo 'Expected binary age archive' >&2; exit 2; }
digest=$(sha256sum -- "$source_file"); digest=${digest%% *}
destination="${remote_directory%/}/$digest.age"
# Content-addressed names avoid reusing a timestamp/name for different archives.
# Skip existing objects, then verify their bytes below. Immutable alone did not
# prevent replacement with the supported rclone version in the regression drill.
# No prune/delete or plaintext upload operation.
timeout 300 rclone copyto "$source_file" "$destination" --ignore-existing --immutable --retries 1 --low-level-retries 1 --timeout 30s
remote_digest=$(timeout 300 rclone cat "$destination" --retries 1 --low-level-retries 1 --timeout 30s | sha256sum)
remote_digest=${remote_digest%% *}
current_digest=$(sha256sum -- "$source_file"); current_digest=${current_digest%% *}
if [ "$digest" != "$remote_digest" ] || [ "$digest" != "$current_digest" ]; then
  echo 'Encrypted archive verification failed; retain local copy and investigate remote bytes' >&2
  exit 1
fi
echo 'Encrypted copy verified by SHA-256 readback; local archive retained'
