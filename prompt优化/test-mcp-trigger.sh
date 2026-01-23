#!/bin/bash

# 测试MCP触发准确率
# 测试各种用户输入是否能正确触发MCP调用

BASE_URL="http://localhost:3000"

echo "🧪 测试MCP触发准确率"
echo "================================"

# 测试用例
test_cases=(
  "今天涨幅最大的币有哪些？"
  "热门币种推荐"
  "给我推荐适合现在埋伏的币"
  "DOGE走势怎么样"
  "PEPE能开多吗"
  "SHIB现在能买吗"
  "ARB的技术分析"
  "OP适合做空吗"
  "MATIC价格多少"
  "分析一下适合做空的币"
)

for prompt in "${test_cases[@]}"; do
  echo ""
  echo "📝 测试: $prompt"
  echo "---"
  
  response=$(curl -s -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"$prompt\",\"stream\":false}")
  
  # 检查是否包含工具调用标记
  if echo "$response" | grep -q "TOOL_CALL"; then
    echo "✅ 触发了MCP调用"
  else
    echo "❌ 未触发MCP调用"
  fi
  
  # 显示部分响应
  echo "$response" | jq -r '.message.content' | head -n 3
  
  sleep 1
done

echo ""
echo "================================"
echo "✅ 测试完成"
