#!/bin/bash

# 部署加密货币AI助手到服务器
# 从.env读取配置

# 读取.env中的域名配置
if [ ! -f .env ]; then
  echo "❌ 错误：找不到 .env 文件"
  echo "请先创建 .env 文件并配置 BASE_DOMAIN"
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

APP_NAME="crypto-ai-analyzer"
APP_PORT="3000"
APP_PATH="/opt/crypto-ai-analyzer"
NGINX_LOCATION="/crypto-ai"
BASE_URL="https://${BASE_DOMAIN}/crypto-ai"

echo "🚀 开始部署加密货币AI助手到服务器..."
echo "📍 目标地址: ${BASE_URL}"
echo ""

# 1. 检查服务器连接
echo "📡 步骤 1/6: 检查服务器连接..."
if ! ssh $SERVER_USER@$SERVER_IP "echo '连接成功'" > /dev/null 2>&1; then
    echo "❌ 无法连接到服务器"
    exit 1
fi
echo "✅ 服务器连接正常"
echo ""

# 2. 安装 Node.js 和 pm2（如果未安装）
echo "📦 步骤 2/6: 检查并安装依赖..."
ssh $SERVER_USER@$SERVER_IP << 'ENDSSH'
# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# 检查 pm2
if ! command -v pm2 &> /dev/null; then
    echo "安装 pm2..."
    npm install -g pm2
fi

echo "Node.js 版本: $(node -v)"
echo "npm 版本: $(npm -v)"
echo "pm2 版本: $(pm2 -v)"
ENDSSH

if [ $? -eq 0 ]; then
    echo "✅ 依赖安装完成"
else
    echo "❌ 依赖安装失败"
    exit 1
fi
echo ""

# 3. 创建应用目录
echo "📁 步骤 3/6: 创建应用目录..."
ssh $SERVER_USER@$SERVER_IP "mkdir -p $APP_PATH"
echo "✅ 目录创建完成"
echo ""

# 4. 上传文件
echo "📤 步骤 4/6: 上传应用文件..."
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.DS_Store' \
    --exclude '.kiro' \
    --exclude 'logs' \
    --exclude '*.log' \
    --exclude 'START_HERE.txt' \
    --exclude '*.md' \
    --exclude 'test-setup.sh' \
    --exclude 'deploy*.sh' \
    ./ $SERVER_USER@$SERVER_IP:$APP_PATH/

if [ $? -eq 0 ]; then
    echo "✅ 文件上传成功"
else
    echo "❌ 文件上传失败"
    exit 1
fi
echo ""

# 5. 安装依赖并启动服务
echo "🔧 步骤 5/6: 安装依赖并启动服务..."
ssh $SERVER_USER@$SERVER_IP << ENDSSH
cd $APP_PATH

# 安装依赖
echo "安装 npm 依赖..."
npm install --production

# 停止旧服务（如果存在）
pm2 delete $APP_NAME 2>/dev/null || true

# 启动服务
echo "启动服务..."
pm2 start src/server.js --name $APP_NAME --log-date-format 'YYYY-MM-DD HH:mm:ss'

# 保存 pm2 配置
pm2 save

# 设置开机自启
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "服务状态:"
pm2 status
ENDSSH

if [ $? -eq 0 ]; then
    echo "✅ 服务启动成功"
else
    echo "❌ 服务启动失败"
    exit 1
fi
echo ""

# 6. 配置 Nginx 反向代理
echo "🌐 步骤 6/6: 配置 Nginx 反向代理..."
ssh $SERVER_USER@$SERVER_IP << 'ENDSSH'
# 备份原配置
cp /etc/nginx/sites-available/mcp-crypto-api /etc/nginx/sites-available/mcp-crypto-api.bak

# 添加新的 location 到现有配置
cat > /tmp/crypto-ai-location.conf << 'EOF'
    location /crypto-ai/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
EOF

# 检查配置中是否已存在 crypto-ai location
if grep -q "location /crypto-ai" /etc/nginx/sites-available/mcp-crypto-api; then
    echo "Nginx 配置已存在，跳过添加"
else
    # 在最后一个 } 之前插入新的 location
    sed -i '/^}$/i\    location /crypto-ai/ {\n        proxy_pass http://127.0.0.1:3000/;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        \n        proxy_connect_timeout 60s;\n        proxy_send_timeout 60s;\n        proxy_read_timeout 60s;\n    }\n' /etc/nginx/sites-available/mcp-crypto-api
    
    echo "Nginx 配置已更新"
fi

# 测试配置
nginx -t

if [ $? -eq 0 ]; then
    # 重载 Nginx
    systemctl reload nginx
    echo "✅ Nginx 配置已重载"
else
    echo "❌ Nginx 配置测试失败，恢复备份"
    cp /etc/nginx/sites-available/mcp-crypto-api.bak /etc/nginx/sites-available/mcp-crypto-api
    exit 1
fi
ENDSSH

if [ $? -eq 0 ]; then
    echo "✅ Nginx 配置完成"
else
    echo "❌ Nginx 配置失败"
    exit 1
fi
echo ""

# 7. 测试部署
echo "🧪 测试部署..."
sleep 3

echo "测试健康检查..."
curl -s ${BASE_URL}/health | python3 -m json.tool 2>/dev/null || echo "健康检查失败"

echo ""
echo "==================================="
echo "✅ 部署完成！"
echo "==================================="
echo ""
echo "🌐 访问地址："
echo "  ${BASE_URL}/"
echo ""
echo "📊 管理命令："
echo "  查看日志: ssh root@$SERVER_IP 'pm2 logs $APP_NAME'"
echo "  查看状态: ssh root@$SERVER_IP 'pm2 status'"
echo "  重启服务: ssh root@$SERVER_IP 'pm2 restart $APP_NAME'"
echo "  停止服务: ssh root@$SERVER_IP 'pm2 stop $APP_NAME'"
echo ""
