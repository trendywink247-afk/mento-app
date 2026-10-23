#!/usr/bin/env bash
# Print the exact root commands that build the API image for <sha>. Runs nothing
# itself and never calls docker (the agent has no docker); a human with docker
# pastes the output, or pipes it:  ops/build-api.sh <sha> | sudo bash
#
#   ops/build-api.sh <sha>
#
# Recipe:
#   Dockerfile : services/api/Dockerfile   (build context: services/api, no build args)
#   Source     : `git archive <sha>` of services/api only, so the image holds exactly
#                the committed tree: no untracked files, no local .env, no .venv.
#                git runs as user `agent` (owner of the repo; override with BUILD_GIT_USER,
#                empty = run git directly, for a root-owned clone); only tar and docker
#                run as root.
#   Build dir  : mktemp under /var/lib/mento-build (root:root, 0700), removed on exit.
#   Tag        : mento-api:<first 12 of sha>-r<N>. An existing tag is never reused or
#                overwritten: N starts at 1 and is incremented, at run time, past every
#                tag already present on the docker host. qa-deploy-api.sh takes the tag
#                part (<shortsha>-r<N>), which the commands print at the end.
#   Labels     : org.opencontainers.image.revision=<full sha>
#
# Reproducibility: the recipe pins the source exactly. The FROM image (python:3.12-slim)
# and pip's resolution of services/api/requirements.txt can still float between builds;
# the output records the base image digest and the resulting image ID so a drift is
# visible. Rebuilding the same sha later may yield a different image ID, hence a new -r<N>.
set -euo pipefail

die() { echo "build-api: $*" >&2; exit 2; }

[ $# -eq 1 ] || die "usage: ops/build-api.sh <sha>"
REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || die "not in a git repo"
SHA="$(git -C "$REPO" rev-parse --verify --quiet "$1^{commit}")" || die "unknown commit: $1"
git -C "$REPO" cat-file -e "$SHA:services/api/Dockerfile" 2>/dev/null \
    || die "services/api/Dockerfile does not exist at $SHA"
SHORT="${SHA:0:12}"
# User that owns the repo and runs git. Default `agent`; on a host where root owns the
# clone (production: /opt/mento/src) run with BUILD_GIT_USER= (empty) to run git directly.
GIT_USER="${BUILD_GIT_USER-agent}"
GIT_PREFIX=""
[ -z "$GIT_USER" ] || GIT_PREFIX="sudo -u $GIT_USER "

cat <<EOF
# --- build mento-api:$SHORT-r<N> from $SHA. Run as root on a host with docker. ---
set -euo pipefail
REPO=$REPO
SHA=$SHA
BUILD_ROOT=/var/lib/mento-build
install -d -m 700 -o root -g root "\$BUILD_ROOT"

# One build at a time, so two runs cannot pick the same -r<N>.
exec 9>>"\$BUILD_ROOT/.lock"
flock 9

# Never reuse a tag: take the first -r<N> that does not exist yet.
N=1
while docker image inspect "mento-api:$SHORT-r\$N" >/dev/null 2>&1; do N=\$((N + 1)); done
TAG="$SHORT-r\$N"
IMAGE="mento-api:\$TAG"

SRC="\$(mktemp -d "\$BUILD_ROOT/api-\$TAG.XXXXXX")"
trap 'rm -rf "\$SRC"' EXIT

# git as the repo owner; the root-only build dir is written by tar, not by git.
${GIT_PREFIX}git -C "\$REPO" archive "\$SHA" services/api | tar --no-same-owner -x -C "\$SRC"

docker build \\
    --file "\$SRC/services/api/Dockerfile" \\
    --tag "\$IMAGE" \\
    --label "org.opencontainers.image.revision=\$SHA" \\
    "\$SRC/services/api"

# Record what was actually built (paste this into the release notes / deploy ticket):
docker image inspect --format 'image={{index .RepoTags 0}} id={{.Id}} created={{.Created}}' "\$IMAGE"
docker image inspect --format 'base-digest={{index .RepoDigests 0}}' python:3.12-slim || true

echo "built \$IMAGE; deploy (root):  deploy-api <qa|prod> \$TAG"
EOF
