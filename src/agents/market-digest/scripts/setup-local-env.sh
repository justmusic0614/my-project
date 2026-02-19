#!/bin/bash
# 本地開發環境設置輔助腳本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

echo "Market Digest - Local Environment Setup"
echo "========================================"

# 建立 .env（如果不存在）
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created .env from .env.example"
  else
    echo "No .env.example found. Creating empty .env"
    touch "$ENV_FILE"
  fi
else
  echo ".env file already exists"
fi

echo ""
echo "Edit .env and fill in your API keys:"
echo "  $ENV_FILE"
echo ""

# 驗證配置
echo "Running config validation..."
echo ""
if node "$PROJECT_DIR/shared/config-validator.js"; then
  echo ""
  echo "Local environment setup complete!"
else
  echo ""
  echo "Config validation failed. Please check your .env file."
  exit 1
fi
