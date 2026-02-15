#!/bin/bash

# 文档敏感信息脱敏工具
# 用法: ./scripts/sanitize-docs.sh [file_pattern]
# 示例: ./scripts/sanitize-docs.sh "*.md"

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔒 文档敏感信息脱敏工具"
echo "================================"
echo ""

# 加载 .env 获取需要脱敏的值
if [ ! -f .env ]; then
  echo -e "${RED}❌ 找不到 .env 文件${NC}"
  exit 1
fi

# 读取敏感信息
source .env

# 定义替换映射
declare -A replacements=(
  ["$SERVER_IP"]="\${SERVER_IP}"
  ["$SERVER_USER"]="\${SERVER_USER}"
  ["$BASE_DOMAIN"]="\${BASE_DOMAIN}"
  ["trade-your.com"]="\${BASE_DOMAIN}"
  ["www.trade-your.com"]="www.\${BASE_DOMAIN}"
  ["ai.trade-your.com"]="ai.\${BASE_DOMAIN}"
  ["tager.duckdns.org"]="\${BASE_DOMAIN}"
)

# API 密钥脱敏（只保留前缀）
if [ -n "$DEEPSEEK_API_KEY" ]; then
  replacements["$DEEPSEEK_API_KEY"]="sk-********************************"
fi

if [ -n "$QWEN_API_KEY" ]; then
  replacements["$QWEN_API_KEY"]="sk-********************************"
fi

# 获取要处理的文件
FILE_PATTERN="${1:-*.md}"
FILES=$(find . -name "$FILE_PATTERN" -type f \
  ! -path "*/node_modules/*" \
  ! -path "*/.git/*" \
  ! -path "*/storage/*")

if [ -z "$FILES" ]; then
  echo -e "${YELLOW}⚠️  没有找到匹配的文件: $FILE_PATTERN${NC}"
  exit 0
fi

echo "📁 找到以下文件："
echo "$FILES" | sed 's/^/  • /'
echo ""

# 询问确认
read -p "是否继续脱敏这些文件？[y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ 已取消"
  exit 0
fi

echo ""
echo "🔄 开始脱敏..."
echo ""

processed=0
changed=0

# 处理每个文件
while IFS= read -r file; do
  changed_this_file=0
  
  # 创建备份
  cp "$file" "$file.bak"
  
  # 应用所有替换
  for original in "${!replacements[@]}"; do
    replacement="${replacements[$original]}"
    
    # 跳过空值
    if [ -z "$original" ] || [ "$original" = "\${" ]; then
      continue
    fi
    
    # 执行替换（macOS 兼容）
    if sed -i.tmp "s|$original|$replacement|g" "$file" 2>/dev/null; then
      # 检查是否有改动
      if ! cmp -s "$file" "$file.tmp" 2>/dev/null; then
        changed_this_file=1
      fi
      rm -f "$file.tmp"
    fi
  done
  
  if [ $changed_this_file -eq 1 ]; then
    echo -e "  ${GREEN}✓${NC} $(basename "$file") - 已脱敏"
    ((changed++))
    rm -f "$file.bak"
  else
    echo -e "  ${YELLOW}○${NC} $(basename "$file") - 无需修改"
    mv "$file.bak" "$file"  # 恢复原文件
  fi
  
  ((processed++))
done <<< "$FILES"

echo ""
echo "================================"
echo -e "${GREEN}✅ 完成！${NC}"
echo "  处理文件: $processed"
echo "  修改文件: $changed"
echo ""

if [ $changed -gt 0 ]; then
  echo "💡 提示："
  echo "  • 请检查修改后的文件是否正确"
  echo "  • 使用 'git diff' 查看改动"
  echo "  • 如有问题，备份文件在 *.bak"
fi
