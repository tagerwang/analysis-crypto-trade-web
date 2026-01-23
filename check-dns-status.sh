#!/bin/bash

# DNS状态检查脚本

# 读取.env中的配置
if [ ! -f .env ]; then
  echo "❌ 错误：找不到 .env 文件"
  exit 1
fi

SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)

# 将逗号分隔的域名转换为数组
IFS=',' read -ra DOMAINS <<< "$NEW_DOMAINS"

echo "🔍 DNS解析状态检查"
echo "================================"
echo "目标IP: $SERVER_IP"
echo "检查域名: ${DOMAINS[@]}"
echo ""

check_dns() {
    local domain=$1
    local dns_server=$2
    local dns_name=$3
    
    local result=$(dig +short $domain @$dns_server 2>/dev/null | head -1)
    
    if [ -z "$result" ]; then
        echo "❌ $domain ($dns_name) → 无解析结果"
        return 1
    elif [ "$result" = "$SERVER_IP" ]; then
        echo "✅ $domain ($dns_name) → $result"
        return 0
    else
        echo "⚠️  $domain ($dns_name) → $result (期望: $SERVER_IP)"
        return 1
    fi
}

echo "📡 检查各DNS服务器的解析结果："
echo ""

# 检查DNSPod权威DNS
echo "--- DNSPod权威DNS (f1g1ns1.dnspod.net) ---"
for domain in "${DOMAINS[@]}"; do
    check_dns "$domain" "f1g1ns1.dnspod.net" "DNSPod"
done
echo ""

# 检查Google DNS
echo "--- Google DNS (8.8.8.8) ---"
ALL_OK=true
for domain in "${DOMAINS[@]}"; do
    check_dns "$domain" "8.8.8.8" "Google" || ALL_OK=false
done
echo ""

# 检查Cloudflare DNS
echo "--- Cloudflare DNS (1.1.1.1) ---"
for domain in "${DOMAINS[@]}"; do
    check_dns "$domain" "1.1.1.1" "Cloudflare" || ALL_OK=false
done
echo ""

# 检查本地DNS
echo "--- 本地DNS ---"
LOCAL_DNS=$(scutil --dns | grep 'nameserver\[0\]' | head -1 | awk '{print $3}')
for domain in "${DOMAINS[@]}"; do
    check_dns "$domain" "$LOCAL_DNS" "本地" || ALL_OK=false
done
echo ""

echo "================================"
if [ "$ALL_OK" = true ]; then
    echo "✅ DNS已完全生效！"
    echo ""
    echo "现在可以申请SSL证书："
    echo "  ./apply-ssl-cert.sh"
else
    echo "⏳ DNS还在传播中..."
    echo ""
    echo "建议："
    echo "  1. 等待5-30分钟后再次检查"
    echo "  2. 清除本地DNS缓存："
    echo "     sudo dscacheutil -flushcache"
    echo "     sudo killall -HUP mDNSResponder"
    echo "  3. 再次运行此脚本检查状态"
fi
echo ""
