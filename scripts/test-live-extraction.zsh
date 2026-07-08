#!/bin/zsh
set -euo pipefail

desired_node_major="$(tr -d '[:space:]' < .nvmrc)"

function current_node_major() {
  node -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || true
}

function use_nvm_node() {
  unset npm_config_prefix
  unset PREFIX

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
    nvm use --silent >/dev/null || true
  fi
}

function use_installed_node_major() {
  local node_bin
  local candidates

  candidates=(
    "$HOME/.nvm/versions/node/v${desired_node_major}"*/bin
    "${NVM_DIR:-$HOME/.nvm}/versions/node/v${desired_node_major}"*/bin
  )

  for node_bin in ${(On)candidates}; do
    if [[ -x "$node_bin/node" ]]; then
      export PATH="$node_bin:$PATH"
      return 0
    fi
  done

  return 1
}

if [[ "$(current_node_major)" != "$desired_node_major" ]]; then
  use_nvm_node
fi

if [[ "$(current_node_major)" != "$desired_node_major" ]]; then
  use_installed_node_major || true
fi

node -e 'const expected = require("node:fs").readFileSync(".nvmrc", "utf8").trim(); const current = process.versions.node; if (current.split(".")[0] !== expected) { console.error(`Matter Layer live extraction tests require Node ${expected}. Current Node: v${current}. Install Node ${expected} with "nvm install ${expected}" or run with PATH=\"$HOME/.nvm/versions/node/v24.18.0/bin:$PATH\" npm run test:live:extraction.`); process.exit(1); }'

echo "Using Node $(node -v) at $(command -v node)"

exec dotenv -e .env.local -- vitest run --config vitest.live.config.ts "$@"
