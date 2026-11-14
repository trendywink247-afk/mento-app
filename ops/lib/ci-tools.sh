# shellcheck shell=bash
# Pinned, checksum-verified tools for the local CI scripts (ops/ci.sh, ops/security-scan.sh).
# Source it; it defines functions only. Everything lands in /srv/mento/ci-cache/tools and is
# reused across runs. A checksum mismatch deletes the download and fails; nothing unverified runs.
#
# Pins: gitleaks/trivy/osv come from the former .github/workflows/security.yml (publisher
# checksums). shellcheck publishes no checksum file; its hash was recorded on first download
# (2026-11-11) and is pinned here, so any later change of that release asset is caught.

CI_TOOLS="${CI_TOOLS:-/srv/mento/ci-cache/tools}"

SHELLCHECK_VERSION=0.10.0
SHELLCHECK_SHA256=6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87
GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
TRIVY_VERSION=0.76.2
TRIVY_SHA256=bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf
OSV_VERSION=2.7.1
OSV_SHA256=fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8
# Python scanners, in their own venv (never mixed with the API venv).
PY_SCANNERS=(bandit==1.9.4 pip-audit==2.10.1 semgrep==1.185.0)
PLAYWRIGHT_VERSION=1.56.1

# _fetch <url> <sha256> <dest-file>: download to a temp name, verify, then move into place.
_fetch() {
    local url=$1 sum=$2 dest=$3 tmp
    tmp="$(mktemp "$CI_TOOLS/.dl.XXXXXX")" || return 1
    if ! curl -fsSL --retry 3 -o "$tmp" "$url"; then rm -f "$tmp"; echo "download failed: $url" >&2; return 1; fi
    if ! echo "$sum  $tmp" | sha256sum -c --status -; then
        rm -f "$tmp"; echo "CHECKSUM MISMATCH for $url — refusing to use it" >&2; return 1
    fi
    mv "$tmp" "$dest"
}

# tool_path <name>: print the path of a verified binary, installing it on first use.
tool_path() {
    local name=$1 dir bin url sum
    mkdir -p "$CI_TOOLS"
    case "$name" in
        shellcheck)
            dir="$CI_TOOLS/shellcheck-$SHELLCHECK_VERSION"; bin="$dir/shellcheck"
            url="https://github.com/koalaman/shellcheck/releases/download/v$SHELLCHECK_VERSION/shellcheck-v$SHELLCHECK_VERSION.linux.x86_64.tar.xz"
            sum=$SHELLCHECK_SHA256 ;;
        gitleaks)
            dir="$CI_TOOLS/gitleaks-$GITLEAKS_VERSION"; bin="$dir/gitleaks"
            url="https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
            sum=$GITLEAKS_SHA256 ;;
        trivy)
            dir="$CI_TOOLS/trivy-$TRIVY_VERSION"; bin="$dir/trivy"
            url="https://github.com/aquasecurity/trivy/releases/download/v$TRIVY_VERSION/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
            sum=$TRIVY_SHA256 ;;
        osv-scanner)
            dir="$CI_TOOLS/osv-scanner-$OSV_VERSION"; bin="$dir/osv-scanner"
            url="https://github.com/google/osv-scanner/releases/download/v$OSV_VERSION/osv-scanner_linux_amd64"
            sum=$OSV_SHA256 ;;
        *) echo "unknown tool $name" >&2; return 2 ;;
    esac
    if [ ! -x "$bin" ]; then
        mkdir -p "$dir"
        case "$name" in
            osv-scanner) _fetch "$url" "$sum" "$bin" || return 1 ;;
            shellcheck)
                _fetch "$url" "$sum" "$dir/pkg.tar.xz" || return 1
                tar -xJf "$dir/pkg.tar.xz" -C "$dir" --strip-components=1 "shellcheck-v$SHELLCHECK_VERSION/shellcheck" \
                    && rm -f "$dir/pkg.tar.xz" || return 1 ;;
            *)
                _fetch "$url" "$sum" "$dir/pkg.tgz" || return 1
                tar -xzf "$dir/pkg.tgz" -C "$dir" "$name" && rm -f "$dir/pkg.tgz" || return 1 ;;
        esac
        chmod 755 "$bin"
    fi
    echo "$bin"
}

# scanner_venv: print the path of the Python scanners' venv, building it on first use.
scanner_venv() {
    local key venv
    key="$(echo "${PY_SCANNERS[*]}" | sha256sum | cut -c1-12)"
    venv="$CI_TOOLS/pyscanners-$key"
    if [ ! -x "$venv/bin/bandit" ]; then
        rm -rf "$venv"
        if ! { python3.12 -m venv "$venv" && "$venv/bin/pip" install --quiet "${PY_SCANNERS[@]}"; } >&2; then
            rm -rf "$venv"; echo "scanner venv build failed" >&2; return 1
        fi
    fi
    echo "$venv"
}

# browser_tools: print a NODE_PATH holding pinned Playwright, with Chromium installed (no system deps).
browser_tools() {
    local dir="$CI_TOOLS/browser-tools-$PLAYWRIGHT_VERSION"
    if [ ! -x "$dir/node_modules/.bin/playwright" ]; then
        rm -rf "$dir"; mkdir -p "$dir"
        npm install --prefix "$dir" --no-package-lock --no-audit --no-fund "playwright@$PLAYWRIGHT_VERSION" >&2 \
            || { rm -rf "$dir"; return 1; }
    fi
    "$dir/node_modules/.bin/playwright" install chromium >&2 || return 1
    echo "$dir/node_modules"
}

# docker_usable: true when this user can talk to the Docker daemon.
docker_usable() { docker info >/dev/null 2>&1; }
