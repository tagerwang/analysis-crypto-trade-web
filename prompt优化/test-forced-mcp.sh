#!/bin/bash

# 测试强制MCP调用功能

echo "🧪 测试强制MCP调用功能"
echo "================================"

# 测试1：单个币种查询（应该触发MCP）
echo ""
echo "测试1：btc现在可以开空吗？"
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "btc现在可以开空吗？",
    "sessionId": "test_forced_mcp_'$(date +%s)'"
  }' | jq -r '.message.content'

echo ""
echo "================================"
echo "✅ 测试完成"
echo ""
echo "检查要点："
echo "1. 是否调用了MCP工具（查看服务器日志）"
echo "2. 价格是否准确（应该接近实际价格）"
echo "3. 是否包含大盘分析"
