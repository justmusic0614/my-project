#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

install -d -m 700 .git/hooks
install -m 700 scripts/pre-commit .git/hooks/pre-commit

echo "[OK] installed: .git/hooks/pre-commit"
