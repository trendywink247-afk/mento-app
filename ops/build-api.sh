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
#   Tag        : mento-api:<first 12 of sha>   (the tag qa-deploy-api.sh takes)
#   Labels     : org.opencontainers.image.revision=<full sha>
#
# Reproducibility: the recipe pins the source exactly. The FROM image (python:3.12-slim)
# and pip's resolution of services/api/requirements.txt can still float between builds;
# the output records the base image digest and the resulting image ID so a drift is
# visible. Rebuilding the same sha later may yield a different image ID.
set -euo pipefail

die() { echo "build-api: $*" >&2; exit 2; }

[ $# -eq 1 ] || die "usage: ops/build-api.sh <sha>"
REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || die "not in a git repo"
SHA="$(git -C "$REPO" rev-parse --verify --quiet "$1^{commit}")" || die "unknown commit: $1"
git -C "$REPO" cat-file -e "$SHA:services/api/Dockerfile" 2>/dev/null \
    || die "services/api/Dockerfile does not exist at $SHA"
SHORT="${SHA:0:12}"
IMAGE="mento-api:$SHORT"

cat <<EOF
# --- build $IMAGE from $SHA. Run as root on a host with docker. ---
set -euo pipefail
REPO=$REPO
SHA=$SHA
IMAGE=$IMAGE
SRC="\$(mktemp -d /srv/mento/build/api-$SHORT.XXXXXX)"
trap 'rm -rf "\$SRC"' EXIT

git -c safe.directory="\$REPO" -C "\$REPO" archive "\$SHA" services/api | tar -x -C "\$SRC"

docker build \\
    --file "\$SRC/services/api/Dockerfile" \\
    --tag "\$IMAGE" \\
    --label "org.opencontainers.image.revision=\$SHA" \\
    "\$SRC/services/api"

# Record what was actually built (paste this into the release notes / deploy ticket):
docker image inspect --format 'image={{index .RepoTags 0}} id={{.Id}} created={{.Created}}' "\$IMAGE"
docker image inspect --format 'base=python:3.12-slim' python:3.12-slim >/dev/null \\
    && docker image inspect --format 'base-digest={{index .RepoDigests 0}}' python:3.12-slim

# Then deploy to QA (root):
#   qa-deploy-api $SHORT
EOF
