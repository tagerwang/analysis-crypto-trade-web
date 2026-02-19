#!/bin/bash

# SSL 证书配置脚本
# 使用 Let's Encrypt 为新域名申请免费 SSL 证书
# 统一使用 certbot --nginx，无需在服务器上创建 /var/www/certbot

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
EXTRA_DOMAINS=$(grep "^EXTRA_DOMAINS=" .env | cut -d '=' -f2 | tr -d ' ')

# 将逗号分隔的域名转换为数组
IFS=',' read -ra DOMAINS <<< "$NEW_DOMAINS"
# 获取主域名
PRIMARY_DOMAIN="${DOMAINS[0]}"

echo "🔐 开始配置 SSL 证书..."
echo "📍 服务器: $SERVER_USER@$SERVER_IP"
echo "📋 主站域名: $NEW_DOMAINS"
[ -n "$EXTRA_DOMAINS" ] && echo "📋 额外子域（单独证书）: $EXTRA_DOMAINS"
echo ""

# 检查服务器连接
echo "📡 检查服务器连接..."
if ! ssh $SERVER_USER@$SERVER_IP "echo '连接成功'" > /dev/null 2>&1; then
    echo "❌ 无法连接到服务器"
    exit 1
fi
echo "✅ 服务器连接正常"
echo ""

echo "⚠️  重要提示："
echo "   1. 请确保 DNS 已经配置并生效"
echo "   2. 域名必须能够解析到服务器 IP: $SERVER_IP"
echo "   3. 需要提供邮箱地址用于证书通知"
echo ""

read -p "请输入邮箱地址（用于证书到期提醒）: " EMAIL

if [ -z "$EMAIL" ]; then
    echo "❌ 邮箱地址不能为空"
    exit 1
fi

echo ""
echo "📋 将为以下域名申请证书："
echo "   主站（一张证书）："
for domain in "${DOMAINS[@]}"; do
    echo "   - $domain"
done
if [ -n "$EXTRA_DOMAINS" ]; then
  echo "   额外子域（各单独证书）："
  IFS=',' read -ra EXTRA_ARR <<< "$EXTRA_DOMAINS"
  for domain in "${EXTRA_ARR[@]}"; do
    echo "   - $domain"
  done
fi
echo ""

read -p "确认继续？(y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "已取消"
    exit 0
fi

echo ""
echo "🚀 开始申请证书..."

ssh $SERVER_USER@$SERVER_IP << ENDSSH
# 安装 certbot（如果未安装）
if ! command -v certbot &> /dev/null; then
    echo "📦 安装 certbot..."
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
    echo "✅ certbot 安装完成"
else
    echo "✅ certbot 已安装"
fi

# 主站域名（由客户端展开传入）
IFS=',' read -ra DOMAINS <<< "$NEW_DOMAINS"

echo ""
echo "🔐 申请主站 SSL 证书..."

CERTBOT_DOMAINS=""
for domain in \${DOMAINS[@]}; do
    CERTBOT_DOMAINS="\$CERTBOT_DOMAINS -d \$domain"
done

certbot --nginx \\
    \$CERTBOT_DOMAINS \\
    --email $EMAIL \\
    --agree-tos \\
    --no-eff-email \\
    --redirect

if [ \$? -ne 0 ]; then
    echo "❌ 主站 SSL 证书申请失败"
    exit 1
fi

# 额外子域：每个域名单独一张证书（certbot --nginx，无需 /var/www/certbot）
EXTRA_DOMAINS_CSV="$EXTRA_DOMAINS"
if [ -n "\$EXTRA_DOMAINS_CSV" ]; then
  echo ""
  echo "🔐 申请额外子域 SSL 证书..."
  IFS=',' read -ra EXTRA_ARR <<< "\$EXTRA_DOMAINS_CSV"
  for domain in \${EXTRA_ARR[@]}; do
    domain=\$(echo "\$domain" | tr -d ' ')
    [ -z "\$domain" ] && continue
    echo "   - \$domain"
    certbot --nginx -d "\$domain" \\
      --email $EMAIL \\
      --agree-tos \\
      --no-eff-email \\
      --redirect
    if [ \$? -ne 0 ]; then
      echo "⚠️  \$domain 证书申请失败，继续下一个"
    fi
  done
fi

echo ""
echo "✅ SSL 证书申请完成"
echo ""
echo "📋 证书信息："
certbot certificates

echo ""
echo "🔄 测试自动续期..."
certbot renew --dry-run

if [ \$? -eq 0 ]; then
  echo "✅ 自动续期配置成功"
else
  echo "⚠️  自动续期测试失败，请检查配置"
fi
ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "  ✅ SSL 证书配置完成！"
    echo "=========================================="
    echo ""
    echo "🌐 现在可以通过 HTTPS 访问："
    for domain in "${DOMAINS[@]}"; do
        echo "   - https://$domain"
    done
    if [ -n "$EXTRA_DOMAINS" ]; then
      IFS=',' read -ra EXTRA_ARR <<< "$EXTRA_DOMAINS"
      for domain in "${EXTRA_ARR[@]}"; do
        domain=$(echo "$domain" | tr -d ' ')
        [ -n "$domain" ] && echo "   - https://$domain"
      done
    fi
    echo ""
    echo "🔄 证书自动续期："
    echo "   Let's Encrypt 证书有效期 90 天"
    echo "   certbot 会自动续期，无需手动操作"
    echo ""
    echo "📋 管理命令："
    echo "   查看证书: ssh $SERVER_USER@$SERVER_IP 'certbot certificates'"
    echo "   手动续期: ssh $SERVER_USER@$SERVER_IP 'certbot renew'"
    echo "   测试续期: ssh $SERVER_USER@$SERVER_IP 'certbot renew --dry-run'"
    echo ""
else
    echo ""
    echo "❌ SSL 证书配置失败"
    echo ""
    echo "故障排查："
    echo "  1. 检查 DNS 解析："
    for domain in "${DOMAINS[@]}"; do
        echo "     nslookup $domain"
    done
    echo ""
    echo "  2. 检查端口开放："
    echo "     telnet $SERVER_IP 80"
    echo "     telnet $SERVER_IP 443"
    echo ""
    echo "  3. 查看 Nginx 日志："
    echo "     ssh $SERVER_USER@$SERVER_IP 'tail -100 /var/log/nginx/error.log'"
    echo ""
    exit 1
fi

