#!/bin/bash

# 快速测试脚本 - 验证项目配置

echo "=========================================="
echo "  项目配置检查"
echo "=========================================="
echo ""

# 检查必要文件
echo "📋 检查文件结构..."
files=(
  "src/server.js"
  "src/config/index.js"
  "src/models/AIProvider.js"
  "src/services/ChatService.js"
  "src/services/MCPService.js"
  "src/services/StorageService.js"
  "public/index.html"
  "public/styles.css"
  "public/app.js"
  "package.json"
  ".env.example"
)

all_exist=true
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "✓ $file"
  else
    echo "✗ $file (缺失)"
    all_exist=false
  fi
done

echo ""

if [ "$all_exist" = true ]; then
  echo "✅ 所有必要文件都存在"
else
  echo "❌ 部分文件缺失，请检查"
  exit 1
fi

# 检查.env文件
echo ""
echo "📋 检查环境配置..."
if [ -f ".env" ]; then
  echo "✓ .env 文件存在"
  
  # 检查必要的环境变量
  if grep -q "DEEPSEEK_API_KEY" .env; then
    echo "✓ DEEPSEEK_API_KEY 已配置"
  else
    echo "⚠️  DEEPSEEK_API_KEY 未配置"
  fi
  
  if grep -q "PORT" .env; then
    echo "✓ PORT 已配置"
  else
    echo "⚠️  PORT 未配置"
  fi
else
  echo "⚠️  .env 文件不存在，请运行 ./deploy.sh 或手动创建"
fi

echo ""
echo "=========================================="
echo "✅ 配置检查完成"
echo "=========================================="
echo ""
echo "下一步："
echo "1. 如果还没有配置，运行: ./deploy.sh"
echo "2. 或手动配置: cp .env.example .env && 编辑 .env"
echo "3. 启动服务: npm start"
echo ""
