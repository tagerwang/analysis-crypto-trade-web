#!/bin/bash

# 价格验证测试脚本

echo "=========================================="
echo "价格数据验证测试"
echo "=========================================="
echo ""

SERVER="http://localhost:3000"

echo "测试场景：查询SAND价格"
echo "预期：AI会调用MCP获取实际价格，验证服务会检测并纠正错误价格"
echo ""

curl -X POST "$SERVER/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "SAND现在多少钱？",
    "sessionId": "test-price-validation"
  }' 2>/dev/null | jq -r '.message.content'

echo ""
echo "=========================================="
echo "检查要点："
echo "1. 查看服务器日志：pm2 logs"
echo "2. 检查是否有价格验证日志"
echo "3. 如果检测到偏差，应该看到纠正信息"
echo "=========================================="
echo ""
