#!/usr/bin/env bash
# ops/ota-keygen.sh <qa|prod> <certificate-out.pem> <private-key-out.pem>
#
# Makes the code-signing pair for Mento's self-hosted OTA: an RSA-2048 key and a self-signed
# certificate valid 10 years, with exactly the extensions expo-updates checks (the same ones
# `expo-updates codesigning:generate` writes): keyUsage critical digitalSignature, and
# extendedKeyUsage critical codeSigning. No basicConstraints CA flag.
#
# The certificate is public and ships inside the app (apps/mobile/certs/ota-<env>.pem).
# The private key never enters the repo or chat; it is written 0600 and never printed.
#   QA:   ops/ota-keygen.sh qa apps/mobile/certs/ota-qa.pem /srv/mento/ota-keys/qa-private-key.pem
#   Prod: run by the founder on a trusted machine; keep the key in the password manager and on
#         the prod host only (docs/OTA.md).
# Refuses to overwrite an existing key: a new key means every installed APK rejects updates.
set -euo pipefail
umask 077

[ $# -eq 3 ] || { echo "usage: $0 <qa|prod> <certificate-out.pem> <private-key-out.pem>" >&2; exit 2; }
ENV_NAME=$1 CERT=$2 KEY=$3
[[ $ENV_NAME =~ ^[a-z0-9-]+$ ]] || { echo "ota-keygen: bad env name" >&2; exit 2; }
[ -e "$KEY" ] && { echo "ota-keygen: $KEY exists; refusing to replace a signing key" >&2; exit 3; }
mkdir -p "$(dirname "$KEY")" "$(dirname "$CERT")"
chmod 700 "$(dirname "$KEY")" 2>/dev/null || true

CONF=$(mktemp)
trap 'rm -f "$CONF"' EXIT
cat >"$CONF" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = Mento OTA
[v3]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
sed -i "s/^CN = Mento OTA$/CN = Mento OTA ${ENV_NAME}/" "$CONF"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEY" 2>/dev/null
chmod 600 "$KEY"
openssl req -x509 -new -key "$KEY" -sha256 -days 3650 -config "$CONF" -out "$CERT"
chmod 644 "$CERT"
echo "ota-keygen: certificate $CERT ($(openssl x509 -in "$CERT" -noout -enddate)); key written to $KEY (0600)"
