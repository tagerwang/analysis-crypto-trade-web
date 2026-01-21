#!/bin/bash

# 从.env读取配置
if [ ! -f .env ]; then
  echo "❌ 错误：找不到 .env 文件"
  exit 1
fi

BASE_DOMAIN=$(grep "^BASE_DOMAIN=" .env | cut -d '=' -f2)
if [ -z "$BASE_DOMAIN" ]; then
  echo "❌ 错误：.env 文件中未配置 BASE_DOMAIN"
  exit 1
fi

SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
if [ -z "$SERVER_IP" ]; then
  echo "❌ 错误：.env 文件中未配置 SERVER_IP"
  exit 1
fi

SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)
SERVER_USER=${SERVER_USER:-root}

BASE_URL="https://${BASE_DOMAIN}/crypto-ai"

echo "🧪 测试部署修复..."
echo "📍 测试地址: ${BASE_URL}"
echo ""

# 测试1：健康检查
echo "📋 测试1：健康检查"
curl -s "$BASE_URL/health" | jq '.'
echo ""

# 测试2：获取会话列表
echo "📋 测试2：获取会话列表"
curl -s "$BASE_URL/api/sessions" | jq '.sessions | length'
echo ""

# 测试3：发送消息并测试MCP工具调用
echo "📋 测试3：测试MCP工具调用（查询BTC价格）"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "BTC现在多少钱？",
    "model": "deepseek"
  }')

echo "$RESPONSE" | jq '.success, .message.content' | head -20
echo ""

# 测试4：查看服务器日志（最后20行）
echo "📋 测试4：查看服务器日志"
ssh $SERVER_USER@$SERVER_IP 'pm2 logs crypto-ai-analyzer --lines 20 --nostream' 2>/dev/null | tail -30
echo ""

echo "✅ 测试完成！"
echo ""
echo "💡 提示："
echo "1. 访问 $BASE_URL 测试界面"
echo "2. 点击历史记录应该能正常加载"
echo "3. 询问价格时AI应该调用MCP工具"
