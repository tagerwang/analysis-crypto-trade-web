# 域名与SSL证书配置指南

## 概述

本文档记录了为 example.com 及其子域名配置SSL证书的完整过程，包括遇到的问题和解决方案。

## 配置的域名

域名配置在 `.env` 文件的 `NEW_DOMAINS` 变量中（逗号分隔）。

示例：
- example.com (根域名)
- www.example.com (www子域名)
- ai.example.com (ai子域名)

## 最终访问地址

根据 `NEW_DOMAINS` 配置，访问地址为：
- https://{第一个域名}/crypto-ai/
- https://{第二个域名}/crypto-ai/
- https://{第三个域名}/crypto-ai/

---

## 配置步骤

### 1. DNS配置

在DNSPod添加A记录，将域名指向服务器IP（从 `.env` 文件中的 `SERVER_IP` 获取）：

| 主机记录 | 记录类型 | 记录值 | TTL |
|---------|---------|--------|-----|
| @ | A | ${SERVER_IP} | 600 |
| www | A | ${SERVER_IP} | 600 |
| ai | A | ${SERVER_IP} | 600 |

**验证DNS生效：**
```bash
# 从 .env 读取 SERVER_IP
SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)

dig example.com +short
dig www.example.com +short
dig ai.example.com +short
# 应该都返回: ${SERVER_IP}
```

### 2. Nginx配置

配置Nginx虚拟主机（HTTP，SSL证书申请前）：

```bash
./configure-domains.sh
```

这会创建基础的Nginx配置，监听80端口，代理到应用端口3000。

### 3. 申请SSL证书

使用Let's Encrypt的certbot申请免费SSL证书：

```bash
# 从 .env 读取配置
SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)

# 将逗号分隔的域名转换为 certbot 参数格式
CERTBOT_DOMAINS=$(echo $NEW_DOMAINS | sed 's/,/ -d /g')

ssh $SERVER_USER@$SERVER_IP
certbot --nginx \
    -d $CERTBOT_DOMAINS \
    --email your-email@example.com \
    --agree-tos \
    --no-eff-email \
    --redirect \
    --non-interactive
```

或使用提供的脚本：
```bash
./setup-ssl.sh
```

### 4. 验证配置

```bash
# 从 .env 读取配置
SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)

# 检查证书
ssh $SERVER_USER@$SERVER_IP 'certbot certificates'

# 测试HTTPS访问（遍历所有域名）
IFS=',' read -ra DOMAINS <<< "$NEW_DOMAINS"
for domain in "${DOMAINS[@]}"; do
    echo "Testing $domain..."
    curl -I https://$domain/crypto-ai/
done
```

---

## 遇到的问题与解决方案

### 问题1: DNS解析到错误的IP

**现象：**
- 域名解析到错误的IP（如 91.195.240.123 - Sedo域名停放服务）
- 而不是服务器IP（配置在 `.env` 的 `SERVER_IP`）
- 访问域名返回403 Forbidden

**原因：**
- 域名的Nameserver指向 dnsowl.com（Namesilo默认DNS）
- 在DNSPod配置的A记录没有生效
- 旧的DNS记录还在缓存中

**解决方案：**
1. 确认域名的Nameserver设置
   ```bash
   dig example.com NS +short
   ```

2. 两种选择：
   - **方案A（推荐）**: 直接在Namesilo管理DNS记录，不使用DNSPod
   - **方案B**: 在Namesilo修改Nameserver为DNSPod的服务器（f1g1ns1.dnspod.net, f1g1ns2.dnspod.net）

3. 等待DNS传播（5-30分钟）

### 问题2: Let's Encrypt验证失败

**现象：**
```
Certbot failed to authenticate some domains
Type: unauthorized
Detail: 91.195.240.123: Invalid response from http://...
```

**原因：**
- Let's Encrypt的DNS服务器还缓存着旧的DNS记录
- 验证请求被发送到错误的IP地址

**解决方案：**
1. 等待DNS完全传播到全球DNS服务器
2. 使用多个DNS服务器验证：
   ```bash
   dig @8.8.8.8 example.com +short      # Google DNS
   dig @1.1.1.1 example.com +short      # Cloudflare DNS
   dig @208.67.222.222 example.com +short  # OpenDNS
   ```
3. 当所有DNS服务器都返回正确IP后，再申请证书

### 问题3: certbot覆盖了Nginx配置

**现象：**
- SSL证书申请成功
- 但 `/crypto-ai/` 路径返回404
- 根路径 `/` 正常

**原因：**
- certbot在配置SSL时修改了Nginx配置文件
- `/crypto-ai/` 的location配置被删除

**解决方案：**
1. 备份完整的Nginx配置（包含所有location）
2. 重新上传配置文件：
   ```bash
   # 从 .env 读取配置
   SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
   SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)
   NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)
   PRIMARY_DOMAIN=$(echo $NEW_DOMAINS | cut -d ',' -f1)
   
   scp $PRIMARY_DOMAIN.nginx.conf $SERVER_USER@$SERVER_IP:/etc/nginx/sites-available/$PRIMARY_DOMAIN
   ssh $SERVER_USER@$SERVER_IP 'nginx -t && systemctl reload nginx'
   ```

### 问题4: DNS传播缓慢

**现象：**
- DNSPod配置正确
- 但部分DNS服务器仍返回旧IP

**原因：**
- DNS有TTL（生存时间）缓存机制
- 不同DNS服务器更新速度不同

**解决方案：**
1. 清除本地DNS缓存：
   ```bash
   # macOS
   sudo dscacheutil -flushcache
   sudo killall -HUP mDNSResponder
   
   # Linux
   sudo systemd-resolve --flush-caches
   
   # Windows
   ipconfig /flushdns
   ```

2. 使用权威DNS服务器查询（最准确）：
   ```bash
   dig @f1g1ns1.dnspod.net example.com +short
   ```

3. 耐心等待（通常5-30分钟，最长24-48小时）

---

## 证书管理

### 证书信息
- **颁发机构**: Let's Encrypt
- **证书类型**: 多域名证书（SAN）
- **有效期**: 90天
- **自动续期**: 已启用（certbot定时任务）

### 常用命令

**查看证书：**
```bash
# 从 .env 读取配置
SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)

ssh $SERVER_USER@$SERVER_IP 'certbot certificates'
```

**手动续期：**
```bash
ssh $SERVER_USER@$SERVER_IP 'certbot renew'
```

**测试自动续期：**
```bash
ssh $SERVER_USER@$SERVER_IP 'certbot renew --dry-run'
```

**删除证书：**
```bash
# 从 .env 读取配置
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)
PRIMARY_DOMAIN=$(echo $NEW_DOMAINS | cut -d ',' -f1)

ssh $SERVER_USER@$SERVER_IP "certbot delete --cert-name $PRIMARY_DOMAIN"
```

---

## 故障排查

### DNS问题排查

```bash
# 从 .env 读取域名配置
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)
IFS=',' read -ra DOMAINS <<< "$NEW_DOMAINS"
PRIMARY_DOMAIN="${DOMAINS[0]}"

# 检查Nameserver
dig $PRIMARY_DOMAIN NS +short

# 检查A记录（多个DNS服务器）
for domain in "${DOMAINS[@]}"; do
    echo "Checking $domain..."
    dig @8.8.8.8 $domain +short
    dig @1.1.1.1 $domain +short
    dig @f1g1ns1.dnspod.net $domain +short
done

# 使用工具脚本（自动读取 .env）
./check-dns-status.sh
```

### Nginx问题排查

```bash
# 从 .env 读取配置
SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)
PRIMARY_DOMAIN=$(echo $NEW_DOMAINS | cut -d ',' -f1)

# 测试配置
ssh $SERVER_USER@$SERVER_IP 'nginx -t'

# 查看错误日志
ssh $SERVER_USER@$SERVER_IP 'tail -50 /var/log/nginx/error.log'

# 查看访问日志
ssh $SERVER_USER@$SERVER_IP "tail -50 /var/log/nginx/$PRIMARY_DOMAIN.access.log"

# 检查Nginx状态
ssh $SERVER_USER@$SERVER_IP 'systemctl status nginx'
```

### SSL证书问题排查

```bash
# 从 .env 读取配置
SERVER_IP=$(grep "^SERVER_IP=" .env | cut -d '=' -f2)
SERVER_USER=$(grep "^SERVER_USER=" .env | cut -d '=' -f2)
NEW_DOMAINS=$(grep "^NEW_DOMAINS=" .env | cut -d '=' -f2)
IFS=',' read -ra DOMAINS <<< "$NEW_DOMAINS"
PRIMARY_DOMAIN="${DOMAINS[0]}"

# 查看certbot日志
ssh $SERVER_USER@$SERVER_IP 'tail -100 /var/log/letsencrypt/letsencrypt.log'

# 测试证书
openssl s_client -connect $PRIMARY_DOMAIN:443 -servername $PRIMARY_DOMAIN

# 检查证书有效期
echo | openssl s_client -connect $PRIMARY_DOMAIN:443 2>/dev/null | openssl x509 -noout -dates
```

---

## 配置文件

### Nginx配置文件位置
- 配置文件: `/etc/nginx/sites-available/{PRIMARY_DOMAIN}`（主域名）
- 软链接: `/etc/nginx/sites-enabled/{PRIMARY_DOMAIN}`
- 本地备份: `./{PRIMARY_DOMAIN}.nginx.conf`

### SSL证书文件位置
- 证书: `/etc/letsencrypt/live/{PRIMARY_DOMAIN}/fullchain.pem`
- 私钥: `/etc/letsencrypt/live/{PRIMARY_DOMAIN}/privkey.pem`
- 配置: `/etc/letsencrypt/options-ssl-nginx.conf`

注：`{PRIMARY_DOMAIN}` 为 `.env` 中 `NEW_DOMAINS` 的第一个域名

---

## 安全建议

1. **定期检查证书有效期**（虽然会自动续期）
2. **启用HSTS**（HTTP Strict Transport Security）
3. **配置安全响应头**（X-Frame-Options, CSP等）
4. **定期更新Nginx和certbot**
5. **监控证书续期日志**

---

## 总结

配置多域名SSL证书的关键点：

1. ✅ 确保DNS正确配置并完全生效
2. ✅ 验证Nameserver指向正确的DNS服务商
3. ✅ 等待DNS传播到全球DNS服务器
4. ✅ 使用certbot的--nginx参数自动配置
5. ✅ 备份Nginx配置，防止被覆盖
6. ✅ 验证所有域名和路径都能正常访问

**配置完成时间**: 2026-01-23

**状态**: ✅ 所有域名SSL证书配置成功
