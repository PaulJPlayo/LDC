#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/ubuntu/ldc-medusa"
BACKEND_DIR="${REPO_DIR}/medusa-backend"
ADMIN_BUILD_DIR="${BACKEND_DIR}/.medusa/server/public/admin"
ADMIN_PUBLIC_DIR="${BACKEND_DIR}/public/admin"

export GIT_SSH_COMMAND="ssh -i /home/ubuntu/.ssh/ldc_medusa_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git config --global --add safe.directory "${REPO_DIR}"

mkdir -p "${REPO_DIR}"
cd "${REPO_DIR}"
if [[ ! -d .git ]]; then
  git init
  git remote add origin git@github.com:PaulJPlayo/LDC.git
fi
git fetch origin
git reset --hard origin/main

cd "${BACKEND_DIR}"
npm ci

# Build the admin UI bundle and expose it from /public/admin.
NODE_OPTIONS=--max-old-space-size=1536 node node_modules/@medusajs/cli/cli.js build
if [[ -d "${ADMIN_BUILD_DIR}" ]]; then
  rm -rf "${ADMIN_PUBLIC_DIR}"
  mkdir -p "$(dirname "${ADMIN_PUBLIC_DIR}")"
  cp -R "${ADMIN_BUILD_DIR}" "${ADMIN_PUBLIC_DIR}"
fi

sudo systemctl restart medusa-backend
