#!/usr/bin/env bash
# 交互式写入 staging 的第三方登录密钥（GitHub / Google）。
# 值从标准输入读取，不进入命令历史，也不会写入任何文件。
set -euo pipefail
cd "$(dirname "$0")/.."

NAMES=(GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET)
for name in "${NAMES[@]}"; do
  read -rsp "$name（直接回车跳过）: " value
  echo
  if [ -z "$value" ]; then
    echo "  跳过 $name"
    continue
  fi
  printf '%s' "$value" | pnpm exec wrangler secret put "$name" -c wrangler.staging.jsonc
  unset value
done

echo
echo "当前 staging 的 secrets："
pnpm exec wrangler secret list -c wrangler.staging.jsonc
echo
echo "校验（应为 {\"github\":true,\"google\":true,...}）："
curl -s https://staging.ljhsu.xin/api/providers; echo
