#!/bin/bash

echo "🔄 重启服务并测试MCP优化"
echo "================================"

# 检查是否有运行中的进程
if pm2 list | grep -q "crypto-ai"; then
  echo "📦 使用PM2重启..."
  pm2 restart crypto-ai
  sleep 3
else
  echo "⚠️  未检测到PM2进程"
  echo "请手动启动服务："
  echo "  npm start"
  echo "或使用PM2："
  echo "  pm2 start ecosystem.config.cjs"
  exit 1
fi

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 2

# 健康检查
echo "🏥 健康检查..."
health=$(curl -s http://localhost:3000/health)
if [ $? -eq 0 ]; then
  echo "✅ 服务运行正常"
  echo "$health" | jq '.'
else
  echo "❌ 服务未响应"
  exit 1
fi

echo ""
echo "================================"
echo "✅ 服务已重启"
echo ""
echo "📝 测试建议："
echo "1. 打开浏览器访问 http://localhost:3000"
echo "2. 尝试以下测试用例："
echo "   - BTC现在多少钱？"
echo "   - ETH能开多吗？"
echo "   - SOL走势怎么样？"
echo "   - 今天涨幅最大的币"
echo ""
echo "3. 或运行自动化测试："
echo "   ./test-mcp-trigger.sh"
