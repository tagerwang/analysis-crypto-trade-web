# 🔒 敏感信息保护指南

本项目已配置敏感信息保护机制，AI 会自动遵守安全规范。

## 📋 快速开始

### 1. 首次使用

```bash
# 复制配置模板
cp .env.example .env

# 编辑 .env，填入真实的配置值
nano .env
```

### 2. 脱敏现有文档

如果项目中已有包含明文敏感信息的文档：

```bash
# 创建脚本目录
mkdir -p scripts

# 脱敏所有 Markdown 文件
./scripts/sanitize-docs.sh "*.md"

# 脱敏所有 Shell 脚本
./scripts/sanitize-docs.sh "*.sh"

# 脱敏特定文件
./scripts/sanitize-docs.sh "部署*.md"
```

### 3. 验证配置

```bash
# 检查是否有泄露的敏感信息
git grep -E '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' -- '*.md' '*.sh'
git grep -E 'sk-[a-zA-Z0-9]{32}' -- '*.md' '*.sh'
```

## 🎯 AI 自动保护

项目已配置 Cursor Rule (`.cursor/rules/security-and-privacy.mdc`)，AI 会自动：

✅ **在所有代码和文档中使用环境变量**  
✅ **脱敏 API 密钥和敏感配置**  
✅ **使用占位符替代真实 IP 和域名**  
✅ **创建示例文件时使用模板值**

## 📝 编写规范

### Shell 脚本

```bash
# ✅ 正确：从环境变量读取
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

SERVER_IP="${SERVER_IP:-YOUR_SERVER_IP}"
ssh $SERVER_USER@$SERVER_IP

# ❌ 错误：硬编码
ssh root@45.32.114.70
```

### 文档

```markdown
# ✅ 正确
部署地址: https://${BASE_DOMAIN}
服务器: ${SERVER_USER}@${SERVER_IP}

# ❌ 错误
部署地址: https://trade-your.com
服务器: root@45.32.114.70
```

### 代码

```javascript
// ✅ 正确
const apiKey = process.env.DEEPSEEK_API_KEY;

// ❌ 错误
const apiKey = 'sk-013f4461081b4d74a765b3cc3fa47b18';
```

## 🔍 敏感信息类型

需要保护的信息包括：

- ✋ **IP 地址**: `45.32.114.70` → `${SERVER_IP}`
- ✋ **域名**: `trade-your.com` → `${BASE_DOMAIN}`
- ✋ **API 密钥**: `sk-013f...` → `${DEEPSEEK_API_KEY}` 或 `sk-****`
- ✋ **用户名**: `root` → `${SERVER_USER}`
- ✋ **数据库密码**: 任何密码 → `${DB_PASSWORD}`
- ✋ **认证 Token**: 任何 token → `${AUTH_TOKEN}`

## 🛡️ Git 保护

`.gitignore` 已配置忽略敏感文件：

```gitignore
.env
*.log
storage/
```

## 💡 最佳实践

### 1. 提交前检查

```bash
# 查看将要提交的改动
git diff --cached

# 确保没有敏感信息
grep -r "45.32.114.70" .
grep -r "sk-[0-9a-f]" .
```

### 2. 定期审计

```bash
# 检查最近的提交
git log --patch -S "API_KEY" --source --all

# 扫描所有文档
./scripts/sanitize-docs.sh "*.md"
```

### 3. 协作提醒

在 PR 描述中添加：

```markdown
## 安全检查清单

- [ ] 已移除所有硬编码的 IP 地址
- [ ] 已脱敏所有 API 密钥
- [ ] 已使用环境变量替代明文配置
- [ ] 已运行 `./scripts/sanitize-docs.sh`
```

## 🚨 泄露应急

如果不小心提交了敏感信息：

### 1. 立即轮换凭证

```bash
# 重新生成 API 密钥
# 更改服务器密码
# 吊销暴露的 token
```

### 2. 清理 Git 历史（谨慎！）

```bash
# 使用 git-filter-repo 清理（推荐）
git-filter-repo --replace-text replacements.txt

# 或使用 BFG Repo-Cleaner
bfg --replace-text replacements.txt
```

### 3. 强制推送

```bash
git push --force-with-lease
```

### 4. 通知团队

告知所有协作者拉取最新代码并轮换凭证。

## 📚 相关文档

- `.env.example` - 配置模板
- `.cursor/rules/security-and-privacy.mdc` - AI 安全规则
- `scripts/sanitize-docs.sh` - 文档脱敏工具

## 🤝 贡献指南

提交代码前，请确保：

1. ✅ 使用 `.env.example` 而非 `.env`
2. ✅ 文档中使用环境变量占位符
3. ✅ 运行脱敏工具检查
4. ✅ 代码审查时关注敏感信息

---

**记住：安全无小事，预防胜于补救！** 🛡️
