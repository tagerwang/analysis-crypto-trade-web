#!/bin/bash

# 加密交易分析AI助手 - 一键部署脚本
# 适用于已有服务器环境，不影响现有服务

set -e

echo "=========================================="
echo "  Crypto AI Analyzer - 一键部署"
echo "=========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查Node.js
echo "📋 检查环境..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 未检测到Node.js，请先安装Node.js 18+${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js版本过低（当前: $(node -v)），需要18+${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js版本: $(node -v)${NC}"

# 检查npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ 未检测到npm${NC}"
    exit 1
fi

echo -e "${GREEN}✓ npm版本: $(npm -v)${NC}"

# 检查端口占用
DEFAULT_PORT=3000
echo ""
echo "🔍 检查端口占用..."
read -p "请输入应用端口 (默认: 3000): " PORT
PORT=${PORT:-$DEFAULT_PORT}

if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  端口 $PORT 已被占用${NC}"
    read -p "是否继续？(y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ]; then
        echo "部署已取消"
        exit 0
    fi
fi

# 创建.env文件
echo ""
echo "⚙️  配置环境变量..."

if [ ! -f .env ]; then
    echo "创建 .env 文件..."
    
    read -p "请输入DeepSeek API Key (必填): " DEEPSEEK_KEY
    while [ -z "$DEEPSEEK_KEY" ]; do
        echo -e "${RED}DeepSeek API Key不能为空${NC}"
        read -p "请输入DeepSeek API Key: " DEEPSEEK_KEY
    done
    
    read -p "请输入千问 API Key (可选，回车跳过): " QWEN_KEY
    
    read -p "历史记录保留天数 (默认: 30): " RETENTION_DAYS
    RETENTION_DAYS=${RETENTION_DAYS:-30}
    
    cat > .env << EOF
# 应用配置
PORT=$PORT
NODE_ENV=production

# AI模型API密钥
DEEPSEEK_API_KEY=$DEEPSEEK_KEY
QWEN_API_KEY=$QWEN_KEY

# MCP服务配置
# 如果MCP服务在同一服务器，使用内网地址（更快）
MCP_BINANCE_URL=http://127.0.0.1:8080/mcp
MCP_COINGECKO_URL=http://127.0.0.1:8080/mcp-coingecko
# 或使用外部域名（需要先设置BASE_DOMAIN）
# MCP_BINANCE_URL=https://\${BASE_DOMAIN}/mcp
# MCP_COINGECKO_URL=https://\${BASE_DOMAIN}/mcp-coingecko
MCP_CRYPTO_COM_URL=https://mcp.crypto.com/market-data/mcp

# 历史记录配置
RETENTION_DAYS=$RETENTION_DAYS
MAX_CHAT_SIZE_MB=10
EOF
    
    echo -e "${GREEN}✓ .env 文件已创建${NC}"
else
    echo -e "${YELLOW}⚠️  .env 文件已存在，跳过创建${NC}"
fi

# 安装依赖
echo ""
echo "📦 安装依赖..."
npm install --production

echo -e "${GREEN}✓ 依赖安装完成${NC}"

# 创建必要目录
echo ""
echo "📁 创建存储目录..."
mkdir -p storage/chats
echo -e "${GREEN}✓ 存储目录已创建${NC}"

# 检查PM2
echo ""
echo "🔧 配置进程管理..."
if ! command -v pm2 &> /dev/null; then
    echo "PM2未安装，正在安装..."
    npm install -g pm2
    echo -e "${GREEN}✓ PM2安装完成${NC}"
else
    echo -e "${GREEN}✓ PM2已安装${NC}"
fi

# 创建PM2配置
cat > ecosystem.config.cjs << EOF
module.exports = {
  apps: [{
    name: 'crypto-ai-analyzer',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '500M',
    autorestart: true,
    watch: false
  }]
};
EOF

mkdir -p logs

# 启动服务
echo ""
echo "🚀 启动服务..."

# 停止旧进程（如果存在）
pm2 delete crypto-ai-analyzer 2>/dev/null || true

# 启动新进程
pm2 start ecosystem.config.cjs

# 保存PM2配置
pm2 save

# 设置开机自启
pm2 startup | tail -n 1 | bash || echo -e "${YELLOW}⚠️  开机自启设置失败，请手动执行 'pm2 startup'${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}✅ 部署完成！${NC}"
echo "=========================================="
echo ""
echo "📊 服务信息："
echo "   - 应用名称: crypto-ai-analyzer"
echo "   - 运行端口: $PORT"
echo "   - 访问地址: http://localhost:$PORT"
echo ""
echo "🔧 常用命令："
echo "   - 查看状态: pm2 status"
echo "   - 查看日志: pm2 logs crypto-ai-analyzer"
echo "   - 重启服务: pm2 restart crypto-ai-analyzer"
echo "   - 停止服务: pm2 stop crypto-ai-analyzer"
echo "   - 删除服务: pm2 delete crypto-ai-analyzer"
echo ""
echo "📝 配置文件："
echo "   - 环境变量: .env"
echo "   - PM2配置: ecosystem.config.cjs"
echo "   - 存储目录: storage/chats"
echo ""

# 健康检查
echo "🔍 健康检查..."
sleep 3

if curl -s http://localhost:$PORT/health > /dev/null; then
    echo -e "${GREEN}✓ 服务运行正常${NC}"
    echo ""
    echo "🎉 现在可以访问 http://localhost:$PORT 开始使用！"
else
    echo -e "${RED}❌ 服务启动失败，请检查日志: pm2 logs crypto-ai-analyzer${NC}"
fi

echo ""
