#!/bin/bash

# 验证敏感信息保护配置
# 用法: ./scripts/verify-security.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🔍 验证敏感信息保护配置"
echo "================================"
echo ""

passed=0
failed=0
warnings=0

# 检查 1: .env.example 是否存在
echo -n "1️⃣  检查 .env.example 是否存在... "
if [ -f .env.example ]; then
  echo -e "${GREEN}✓ 通过${NC}"
  ((passed++))
else
  echo -e "${RED}✗ 失败${NC}"
  echo "   请创建 .env.example 作为配置模板"
  ((failed++))
fi

# 检查 2: .gitignore 是否包含 .env
echo -n "2️⃣  检查 .gitignore 是否忽略 .env... "
if grep -q "^\.env$" .gitignore 2>/dev/null; then
  echo -e "${GREEN}✓ 通过${NC}"
  ((passed++))
else
  echo -e "${RED}✗ 失败${NC}"
  echo "   请在 .gitignore 中添加 .env"
  ((failed++))
fi

# 检查 3: Cursor Rule 是否存在
echo -n "3️⃣  检查 Cursor 安全规则... "
if [ -f .cursor/rules/security-and-privacy.mdc ]; then
  echo -e "${GREEN}✓ 通过${NC}"
  ((passed++))
else
  echo -e "${RED}✗ 失败${NC}"
  echo "   请创建 .cursor/rules/security-and-privacy.mdc"
  ((failed++))
fi

# 检查 4: .env.example 中是否有明文敏感信息
echo -n "4️⃣  检查 .env.example 中的敏感信息... "
if [ -f .env.example ]; then
  # 检查是否有看起来像真实 IP 的内容（排除 127.0.0.1）
  if grep -E '\b([1-9][0-9]{0,2}\.){3}[0-9]{1,3}\b' .env.example | grep -v "127.0.0.1" > /dev/null; then
    echo -e "${YELLOW}⚠ 警告${NC}"
    echo "   .env.example 可能包含真实 IP 地址"
    ((warnings++))
  # 检查是否有看起来像真实 API 密钥的内容
  elif grep -E 'sk-[a-zA-Z0-9]{30,}' .env.example > /dev/null; then
    echo -e "${YELLOW}⚠ 警告${NC}"
    echo "   .env.example 可能包含真实 API 密钥"
    ((warnings++))
  else
    echo -e "${GREEN}✓ 通过${NC}"
    ((passed++))
  fi
else
  echo -e "${YELLOW}⊘ 跳过${NC}"
fi

# 检查 5: Git 暂存区是否包含 .env
echo -n "5️⃣  检查 .env 是否被 Git 跟踪... "
if git ls-files --error-unmatch .env &> /dev/null; then
  echo -e "${RED}✗ 危险！${NC}"
  echo "   .env 文件已被 Git 跟踪，请立即移除："
  echo "   git rm --cached .env"
  ((failed++))
else
  echo -e "${GREEN}✓ 通过${NC}"
  ((passed++))
fi

# 检查 6: 扫描常见文档中的敏感信息
echo -n "6️⃣  扫描文档中的潜在泄露... "

leaked_files=""

# 从 .env 读取敏感值进行检查
if [ -f .env ]; then
  source .env 2>/dev/null || true
  
  # 检查 IP 地址
  if [ -n "$SERVER_IP" ]; then
    found=$(git grep -l "$SERVER_IP" -- '*.md' '*.sh' 2>/dev/null || true)
    if [ -n "$found" ]; then
      leaked_files="$leaked_files\n  → IP地址泄露: $(echo "$found" | tr '\n' ', ' | sed 's/,$//')"
    fi
  fi
  
  # 检查域名
  if [ -n "$BASE_DOMAIN" ]; then
    found=$(git grep -l "$BASE_DOMAIN" -- '*.md' '*.sh' 2>/dev/null || true)
    if [ -n "$found" ]; then
      leaked_files="$leaked_files\n  → 域名泄露: $(echo "$found" | tr '\n' ', ' | sed 's/,$//')"
    fi
  fi
fi

if [ -n "$leaked_files" ]; then
  echo -e "${YELLOW}⚠ 发现潜在泄露${NC}"
  echo -e "$leaked_files"
  echo "   运行 ./scripts/sanitize-docs.sh 进行脱敏"
  ((warnings++))
else
  echo -e "${GREEN}✓ 通过${NC}"
  ((passed++))
fi

# 总结
echo ""
echo "================================"
echo "📊 验证结果"
echo "================================"
echo -e "${GREEN}✓ 通过: $passed${NC}"
echo -e "${RED}✗ 失败: $failed${NC}"
echo -e "${YELLOW}⚠ 警告: $warnings${NC}"
echo ""

if [ $failed -eq 0 ] && [ $warnings -eq 0 ]; then
  echo -e "${GREEN}🎉 完美！所有检查都通过了！${NC}"
  exit 0
elif [ $failed -eq 0 ]; then
  echo -e "${YELLOW}⚠️  配置基本正常，但有一些建议需要处理${NC}"
  exit 0
else
  echo -e "${RED}❌ 发现严重问题，请立即修复！${NC}"
  exit 1
fi
