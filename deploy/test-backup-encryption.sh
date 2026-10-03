#!/usr/bin/env bash
# Synthetic round-trip only. No real backup or persistent key is read/written.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
umask 077
age-keygen -o "$temp/identity" >/dev/null 2>&1
age-keygen -y "$temp/identity" > "$temp/recipients"
printf 'synthetic database dump\n' | gzip > "$temp/source.gz"
bash "$root/deploy/encrypt-backup.sh" "$temp/source.gz" "$temp/recipients" "$temp/archive.age"
bash "$root/deploy/decrypt-backup.sh" "$temp/archive.age" "$temp/identity" "$temp/restored.gz"
cmp "$temp/source.gz" "$temp/restored.gz"
test "$(stat -c '%a' "$temp/restored.gz")" = 600
if bash "$root/deploy/decrypt-backup.sh" "$temp/archive.age" "$temp/identity" "$temp/restored.gz"; then
  echo 'FAIL: replaced existing recovery archive'; exit 1
fi
age-keygen -o "$temp/wrong-identity" >/dev/null 2>&1
if bash "$root/deploy/decrypt-backup.sh" "$temp/archive.age" "$temp/wrong-identity" "$temp/wrong.gz" 2>/dev/null; then
  echo 'FAIL: wrong recovery identity accepted'; exit 1
fi
test ! -e "$temp/wrong.gz"
head -c -1 "$temp/archive.age" > "$temp/truncated.age"
if bash "$root/deploy/decrypt-backup.sh" "$temp/truncated.age" "$temp/identity" "$temp/truncated.gz" 2>/dev/null; then
  echo 'FAIL: truncated ciphertext accepted'; exit 1
fi
test ! -e "$temp/truncated.gz"
# A decryptable payload must still be a valid gzip before publication.
printf 'not gzip' | age -R "$temp/recipients" > "$temp/not-gzip.age"
if bash "$root/deploy/decrypt-backup.sh" "$temp/not-gzip.age" "$temp/identity" "$temp/invalid.gz" 2>/dev/null; then
  echo 'FAIL: invalid restored gzip accepted'; exit 1
fi
test ! -e "$temp/invalid.gz"
test -z "$(find "$temp" -name '.decrypted-backup.*' -print)"
test "$(stat -c '%a' "$temp/archive.age")" = 600
if bash "$root/deploy/encrypt-backup.sh" "$temp/source.gz" "$temp/recipients" "$temp/archive.age"; then
  echo 'FAIL: replaced existing archive'; exit 1
fi
printf 'invalid-recipient\n' > "$temp/bad-recipient"
if bash "$root/deploy/encrypt-backup.sh" "$temp/source.gz" "$temp/bad-recipient" "$temp/bad.age" 2>/dev/null; then
  echo 'FAIL: invalid recipient accepted'; exit 1
fi
test ! -e "$temp/bad.age"
test -z "$(find "$temp" -name '.encrypted-backup.*' -print)"
echo 'PASS: encrypted round-trip, private permissions, overwrite refusal and failure cleanup'
