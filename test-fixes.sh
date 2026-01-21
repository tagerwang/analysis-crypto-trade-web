#!/bin/bash

echo "🧪 测试修复效果..."
echo ""

# 测试1：历史会话加载
echo "📋 测试1：历史会话加载"
echo "检查历史会话文件..."
ls -la storage/chats/2026-01-20/ 2>/dev/null || echo "没有找到历史会话"

# 获取一个历史会话ID
SESSION_ID=$(ls storage/chats/2026-01-20/ 2>/dev/null | head -1 | sed 's/.json//')

if [ ! -z "$SESSION_ID" ]; then
  echo "找到会话: $SESSION_ID"
  echo "测试加载会话..."
  curl -s http://localhost:3000/api/session/$SESSION_ID | jq '.'
else
  echo "⚠️  没有历史会话可测试"
fi

echo ""
echo "📋 测试2：MCP工具调用"
echo "测试查询BTC价格..."
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "BTC现在多少钱？",
    "model": "auto"
  }' | jq '.'

echo ""
echo "✅ 测试完成！"
echo ""
echo "💡 提示："
echo "1. 点击左侧历史记录应该能正常加载会话内容"
echo "2. AI应该能够调用MCP工具获取实时数据"
