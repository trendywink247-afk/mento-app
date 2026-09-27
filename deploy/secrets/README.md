# deploy/secrets

Encrypted production secrets live here as `prod.env.sops.yaml` (SOPS + age).
Only `*.sops.yaml` files and this README are tracked — anything else in this
directory is gitignored, so a decrypted copy can never be committed by accident.

`prod.env.sops.yaml` does not exist yet: creating it needs the founder's and the
server's age keys. Setup, key custody, editing and rotation:
`docs/DEPLOYMENT_VPS.md` → "Secrets (SOPS + age)". Tooling proof:
`bash deploy/test-secrets.sh`.
