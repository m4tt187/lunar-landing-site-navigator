#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# AI-assisted: written with Anthropic Claude under the direction of the team.
# Publishes the production build (web/dist) to the gh-pages branch.
set -eu
cd "$(dirname "$0")/.."
npm run build
commit=$(git rev-parse --short HEAD)
work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT
cp -R web/dist/. "$work/"
touch "$work/.nojekyll"
cd "$work"
git init -q -b gh-pages
git config user.name "$(git -C "$OLDPWD" config user.name)"
git config user.email "$(git -C "$OLDPWD" config user.email)"
git config core.sshCommand "$(git -C "$OLDPWD" config core.sshCommand)"
git add -A
git commit -q -m "Publish build of $commit"
git push -q -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages
echo "published $commit"
