#!/usr/bin/env bash
# Install a QA web export tarball on this box (run as root).
#
#   qa-install-web.sh <tarball.tar.gz>     # install (needs a sibling <tarball>.tar.gz.sha256)
#   qa-install-web.sh --rollback           # swap /opt/mento-staging/web back to the previous release
#
# Layout (matches deploy/staging/README.md's existing convention):
#   /opt/mento-staging/web-releases/<name>/   one directory per unpacked release
#   /opt/mento-staging/web                    symlink, the live release Caddy/Nginx serves
#   /opt/mento-staging/previous-web           symlink, the release live immediately before
#                                              the last successful install (or rollback)
#
# <name> is the tarball's basename with .tar.gz stripped, e.g.
# web-0f1e133-qa.tar.gz -> web-0f1e133-qa.
#
# Both the install and rollback paths use the same atomic swap: build the new
# symlink at a temp path, then `mv -T` it onto the live name — `mv` within one
# filesystem is a single rename syscall, so there is no instant where `web`
# is missing or half-written.
set -euo pipefail

ROOT_DIR=/opt/mento-staging
RELEASES_DIR="$ROOT_DIR/web-releases"
WEB_LINK="$ROOT_DIR/web"
PREVIOUS_LINK="$ROOT_DIR/previous-web"

die() { echo "qa-install-web: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"

# Atomically point symlink $1 at target $2 (both absolute paths).
swap_symlink() {
    local link=$1 target=$2 tmp
    tmp="${link}.tmp.$$"
    ln -sfn "$target" "$tmp"
    mv -T "$tmp" "$link"
}

do_rollback() {
    [ -L "$PREVIOUS_LINK" ] || die "no $PREVIOUS_LINK symlink — nothing to roll back to"
    local prev_target current_target
    prev_target="$(readlink -f "$PREVIOUS_LINK")"
    [ -d "$prev_target" ] || die "$PREVIOUS_LINK points at $prev_target, which doesn't exist"
    if [ -L "$WEB_LINK" ] || [ -e "$WEB_LINK" ]; then
        current_target="$(readlink -f "$WEB_LINK")"
    else
        current_target=""
    fi
    echo "qa-install-web: rolling back $WEB_LINK: $current_target -> $prev_target"
    swap_symlink "$WEB_LINK" "$prev_target"
    # Swap, don't just overwrite: running --rollback a second time undoes the
    # first rollback instead of pointing previous-web at itself.
    if [ -n "$current_target" ]; then
        swap_symlink "$PREVIOUS_LINK" "$current_target"
    fi
    echo "qa-install-web: live: $prev_target"
}

do_install() {
    local tarball=$1 sumfile name target_dir old_target
    [ -f "$tarball" ] || die "no such file: $tarball"
    sumfile="${tarball}.sha256"
    [ -f "$sumfile" ] || die "missing checksum file: $sumfile"

    echo "qa-install-web: verifying $sumfile"
    (cd "$(dirname "$tarball")" && sha256sum --check "$(basename "$sumfile")") \
        || die "checksum verification FAILED for $tarball — not installing"

    name="$(basename "$tarball")"
    name="${name%.tar.gz}"
    [ "$name" != "$(basename "$tarball")" ] || die "expected a .tar.gz, got: $tarball"
    target_dir="$RELEASES_DIR/$name"
    [ ! -e "$target_dir" ] || die "release already exists: $target_dir (remove it first if this is intentional)"

    mkdir -p "$target_dir"
    echo "qa-install-web: unpacking $tarball -> $target_dir"
    tar -xzf "$tarball" -C "$target_dir"

    if [ -L "$WEB_LINK" ] || [ -e "$WEB_LINK" ]; then
        old_target="$(readlink -f "$WEB_LINK")"
        echo "qa-install-web: saving current release as previous: $old_target"
        swap_symlink "$PREVIOUS_LINK" "$old_target"
    else
        echo "qa-install-web: no existing $WEB_LINK — first install, nothing to save as previous"
    fi

    echo "qa-install-web: flipping $WEB_LINK -> $target_dir"
    swap_symlink "$WEB_LINK" "$target_dir"
    echo "qa-install-web: live: $target_dir"
}

case "${1:-}" in
    --rollback)
        [ $# -eq 1 ] || die "usage: qa-install-web.sh --rollback"
        do_rollback
        ;;
    "" | --help | -h)
        die "usage: qa-install-web.sh <tarball.tar.gz> | --rollback"
        ;;
    *)
        [ $# -eq 1 ] || die "usage: qa-install-web.sh <tarball.tar.gz>"
        do_install "$1"
        ;;
esac
