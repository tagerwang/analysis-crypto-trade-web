#!/bin/bash

# 配置多域名访问脚本
# 为 多域名 配置 Nginx

set -e

# 读取.env中的服务器配置
if [ ! -f .env ]; then
  echo "❌ 错误：找不到 .env 文件"
  exit 1
fi

SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)
SERVER_USER=${SERVER_USER:-root}
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)
APP_PORT=$(grep "^PORT=" .env | cut -d '=' -f2)
APP_PORT=${APP_PORT:-3000}

# 将逗号分隔的域名转换为空格分隔（用于 server_name）
NGINX_DOMAINS=$(echo $NEW_DOMAINS | tr ',' ' ')
# 获取主域名（第一个域名）
PRIMARY_DOMAIN=$(echo $NEW_DOMAINS | cut -d ',' -f1)

# 将逗号分隔的域名转换为数组
IFS=',' read -ra DOMAINS <<< "$NEW_DOMAINS"

echo "🌐 开始配置多域名访问..."
echo "📍 服务器: $SERVER_USER@$SERVER_IP"
echo "📋 域名: $NEW_DOMAINS"
echo ""

# 检查服务器连接
echo "📡 检查服务器连接..."
if ! ssh $SERVER_USER@$SERVER_IP "echo '连接成功'" > /dev/null 2>&1; then
    echo "❌ 无法连接到服务器"
    exit 1
fi
echo "✅ 服务器连接正常"
echo ""

# 在服务器上配置域名
echo "⚙️  配置 Nginx 虚拟主机..."
ssh $SERVER_USER@$SERVER_IP << ENDSSH

# 创建 Nginx 配置文件（先只配置 HTTP，SSL 证书后续通过 certbot 自动配置）
cat > /etc/nginx/sites-available/$PRIMARY_DOMAIN << EOF
# $PRIMARY_DOMAIN 域名配置
# 加密货币AI分析助手

server {
    listen 80;
    listen [::]:80;
    server_name $NGINX_DOMAINS;

    # 日志
    access_log /var/log/nginx/$PRIMARY_DOMAIN.access.log;
    error_log /var/log/nginx/$PRIMARY_DOMAIN.error.log;

    # 根路径代理到应用
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # WebSocket 支持（如果需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:$APP_PORT/health;
        access_log off;
    }
}
EOF

echo "✅ Nginx 配置文件已创建"

# 启用站点
if [ ! -L /etc/nginx/sites-enabled/$PRIMARY_DOMAIN ]; then
    ln -s /etc/nginx/sites-available/$PRIMARY_DOMAIN /etc/nginx/sites-enabled/
    echo "✅ 站点已启用"
else
    echo "⚠️  站点已经启用"
fi

# 测试 Nginx 配置
echo ""
echo "🧪 测试 Nginx 配置..."
nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx 配置测试通过"
    
    # 重载 Nginx
    echo "🔄 重载 Nginx..."
    systemctl reload nginx
    echo "✅ Nginx 已重载"
else
    echo "❌ Nginx 配置测试失败"
    exit 1
fi

ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 域名配置完成！"
else
    echo ""
    echo "❌ 域名配置失败"
    exit 1
fi

echo ""
echo "=========================================="
echo "  📋 后续步骤"
echo "=========================================="
echo ""
echo "1️⃣  DNS 配置"
echo "   请在域名服务商处添加以下 A 记录："
for domain in "${DOMAINS[@]}"; do
    echo "   - $domain → $SERVER_IP"
done
echo ""
echo "2️⃣  SSL 证书配置（推荐使用 Let's Encrypt）"
echo "   运行 SSL 配置脚本："
echo "   ./setup-ssl.sh"
echo ""
echo "   或手动在服务器上执行："
echo "   ssh $SERVER_USER@$SERVER_IP"
CERTBOT_DOMAINS=$(echo $NEW_DOMAINS | sed 's/,/ -d /g')
echo "   certbot --nginx -d $CERTBOT_DOMAINS"
echo ""
echo "3️⃣  测试访问"
echo "   配置完成后，可以通过以下地址访问："
for domain in "${DOMAINS[@]}"; do
    echo "   - https://$domain"
done
echo ""

