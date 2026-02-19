#!/usr/bin/env bash
# 使用 curl 测试千问（通义）API 是否可用
# 用法: 在项目根目录执行 ./scripts/test-qwen-curl.sh 或 source .env && ./scripts/test-qwen-curl.sh

set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -z "$QWEN_API_KEY" ]; then
  echo "❌ 未设置 QWEN_API_KEY，请在 .env 中配置"
  exit 1
fi

BASE_URL="${BASE_URL:-https://dashscope-intl.aliyuncs.com/compatible-mode/v1}"
MODEL="${MODEL:-qwen-turbo}"

echo "🧪 测试千问 API (curl)"
echo "   Base URL: $BASE_URL"
echo "   Model: $MODEL"
echo "   API Key: ${QWEN_API_KEY:0:10}..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $QWEN_API_KEY" \
  -d '{
    "model": "'"$MODEL"'",
    "messages": [{"role": "user", "content": "你好，请用一句话介绍你自己。"}],
    "stream": false
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
HTTP_BODY=$(echo "$RESPONSE" | sed '$d')

echo "📡 HTTP 状态: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 请求成功"
  echo "$HTTP_BODY" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (d.choices?.[0]?.message?.content) {
      console.log('💬 回复:', d.choices[0].message.content);
    } else {
      console.log(JSON.stringify(d, null, 2));
    }
  "
else
  echo "❌ 请求失败"
  echo "$HTTP_BODY" | node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      console.log(d.error?.message || JSON.stringify(d, null, 2));
    } catch (e) {
      require('fs').readFileSync(0, 'utf8').split('\\n').forEach(l => console.log(l));
    }
  " 2>/dev/null || echo "$HTTP_BODY"
fi
