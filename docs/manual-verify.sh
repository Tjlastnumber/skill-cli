#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "[FAIL] Required command not found: ${cmd}" >&2
    exit 1
  fi
}

expect_fail_contains() {
  local expected="$1"
  shift

  local tmp
  tmp="$(mktemp)"

  set +e
  "$@" >"${tmp}" 2>&1
  local code=$?
  set -e

  if [[ ${code} -eq 0 ]]; then
    echo "[FAIL] Expected failure, but command succeeded: $*" >&2
    cat "${tmp}" >&2
    rm -f "${tmp}"
    exit 1
  fi

  if ! grep -Fq "${expected}" "${tmp}"; then
    echo "[FAIL] Output did not contain expected text: ${expected}" >&2
    echo "--- command output ---" >&2
    cat "${tmp}" >&2
    echo "----------------------" >&2
    rm -f "${tmp}"
    exit 1
  fi

  echo "[OK] Expected failure observed: $*"
  rm -f "${tmp}"
}

echo "== skill-cli manual verification (pnpm) =="

require_command pnpm

echo "\n[1/8] Install dependencies with pnpm"
pnpm install

echo "\n[2/8] Run tests"
pnpm test

echo "\n[3/8] Build TypeScript"
pnpm build

echo "\n[4/8] Show CLI help"
pnpm dev --help >/tmp/skill-cli-help.txt
grep -F "install" /tmp/skill-cli-help.txt >/dev/null
grep -F "doctor" /tmp/skill-cli-help.txt >/dev/null
echo "[OK] Help output contains expected commands"

echo "\n[5/8] Validate target-flag guard"
expect_fail_contains \
  "Exactly one target must be specified" \
  pnpm dev install demo-source --tool codex

echo "\n[6/8] Validate install command success path"
SANDBOX_DIR="$(mktemp -d)"
SANDBOX_HOME="${SANDBOX_DIR}/home"
SANDBOX_WORK="${SANDBOX_DIR}/workspace"
SANDBOX_SOURCE="${SANDBOX_WORK}/skills-source"
SANDBOX_TARGET="${SANDBOX_DIR}/targets/codex-global"
SANDBOX_STORE="${SANDBOX_DIR}/store"

mkdir -p "${SANDBOX_HOME}/.config/skill-cli"
mkdir -p "${SANDBOX_SOURCE}/alpha-skill"

cat >"${SANDBOX_HOME}/.config/skill-cli/config.json" <<EOF
{
  "storeDir": "${SANDBOX_STORE}",
  "tools": {
    "codex": {
      "globalDir": "${SANDBOX_TARGET}"
    }
  }
}
EOF

cat >"${SANDBOX_SOURCE}/alpha-skill/SKILL.md" <<'EOF'
# alpha
EOF

HOME="${SANDBOX_HOME}" pnpm dev install "${SANDBOX_SOURCE}" --tool codex --global

if [[ ! -L "${SANDBOX_TARGET}/alpha-skill" ]]; then
  echo "[FAIL] Expected symlink was not created at ${SANDBOX_TARGET}/alpha-skill" >&2
  rm -rf "${SANDBOX_DIR}"
  exit 1
fi

echo "[OK] Install created expected symlink target"

echo "\n[7/8] Validate list command output"
HOME="${SANDBOX_HOME}" pnpm dev list --tool all >/tmp/skill-cli-list.txt
if ! grep -Fq "skills-source" /tmp/skill-cli-list.txt; then
  echo "[FAIL] Expected list output to include skills-source bundle" >&2
  cat /tmp/skill-cli-list.txt >&2
  rm -f /tmp/skill-cli-list.txt
  rm -rf "${SANDBOX_DIR}"
  exit 1
fi
echo "[OK] List output includes installed bundle"
rm -f /tmp/skill-cli-list.txt

echo "\n[8/8] Validate doctor command summary"
HOME="${SANDBOX_HOME}" pnpm dev doctor --tool codex >/tmp/skill-cli-doctor.txt
if ! grep -Fq "Doctor summary:" /tmp/skill-cli-doctor.txt; then
  echo "[FAIL] Expected doctor summary output" >&2
  cat /tmp/skill-cli-doctor.txt >&2
  rm -f /tmp/skill-cli-doctor.txt
  rm -rf "${SANDBOX_DIR}"
  exit 1
fi
echo "[OK] Doctor output contains summary"
rm -f /tmp/skill-cli-doctor.txt

rm -rf "${SANDBOX_DIR}"

rm -f /tmp/skill-cli-help.txt

echo "\nAll manual verification checks passed."
