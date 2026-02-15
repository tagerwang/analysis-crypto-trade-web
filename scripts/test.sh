#!/bin/bash

# 统一测试脚本 - 整合所有测试功能
# 用法:
#   ./scripts/test.sh all          - 运行所有测试
#   ./scripts/test.sh production   - 生产环境测试
#   ./scripts/test.sh parallel     - 并行调用测试
#   ./scripts/test.sh tools        - 工具加载测试

set -e

# 加载环境变量
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

BASE_DOMAIN="${BASE_DOMAIN:-example.com}"
TEST_URL="${TEST_URL:-https://${BASE_DOMAIN}}"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

MODE="${1:-production}"

echo "🧪 测试工具"
echo "================================"
echo "模式: $MODE"
echo "测试地址: $TEST_URL"
echo ""

# ============================================
# 生产环境测试
# ============================================
test_production() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🌐 生产环境测试${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  
  # 1. 健康检查
  echo "1️⃣  健康检查"
  HEALTH=$(curl -s "$TEST_URL/api/health" || echo '{"status":"error"}')
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "  ${GREEN}✓${NC} 健康检查通过"
  else
    echo -e "  ${RED}✗${NC} 健康检查失败"
    echo "  响应: $HEALTH"
  fi
  
  echo ""
  echo "2️⃣  简单查询测试"
  SIMPLE_TEST=$(curl -s "$TEST_URL/api/chat" \
    -H 'content-type: application/json' \
    --data-raw '{"sessionId":null,"message":"BTC现价多少","model":"auto","stream":false}' \
    2>/dev/null || echo '{"error":"request_failed"}')
  
  if echo "$SIMPLE_TEST" | grep -q '"response"'; then
    echo -e "  ${GREEN}✓${NC} 简单查询成功"
    # 检查是否有 DSML
    if echo "$SIMPLE_TEST" | grep -q "DSML"; then
      echo -e "  ${RED}⚠${NC} 检测到 DSML 格式（异常）"
    fi
  else
    echo -e "  ${RED}✗${NC} 简单查询失败"
    echo "  响应: ${SIMPLE_TEST:0:200}"
  fi
  
  echo ""
  echo "3️⃣  批量查询测试"
  BATCH_TEST=$(curl -s "$TEST_URL/api/chat" \
    -H 'content-type: application/json' \
    --data-raw '{"sessionId":null,"message":"对比BTC和ETH的走势","model":"auto","stream":false}' \
    2>/dev/null || echo '{"error":"request_failed"}')
  
  if echo "$BATCH_TEST" | grep -q '"response"'; then
    echo -e "  ${GREEN}✓${NC} 批量查询成功"
    # 检查工具调用
    TOOL_COUNT=$(echo "$BATCH_TEST" | grep -o '"type":"tool' | wc -l)
    echo "  工具调用次数: $TOOL_COUNT"
  else
    echo -e "  ${RED}✗${NC} 批量查询失败"
  fi
  
  echo ""
}

# ============================================
# 并行调用测试
# ============================================
test_parallel() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}⚡ 并行调用测试${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  
  declare -A test_cases=(
    ["单币种走势"]="BTC走势"
    ["多币种对比"]="对比BTC和ETH"
    ["复杂分析"]="分析BTC走势，同时看下大盘情况"
  )
  
  for test_name in "${!test_cases[@]}"; do
    test_query="${test_cases[$test_name]}"
    
    echo "📋 测试: $test_name"
    echo "   查询: $test_query"
    
    response=$(curl -s "$TEST_URL/api/chat" \
      -H 'content-type: application/json' \
      --data-raw "{\"sessionId\":null,\"message\":\"$test_query\",\"model\":\"auto\",\"stream\":true}")
    
    # 统计工具调用
    tool_count=$(echo "$response" | grep -c '"type":"tool_start"' || echo "0")
    
    # 检查 DSML
    dsml_count=$(echo "$response" | grep -c "｜DSML｜" || echo "0")
    
    if [ "$dsml_count" -eq 0 ]; then
      echo -e "  ${GREEN}✓${NC} DSML检查通过"
    else
      echo -e "  ${RED}✗${NC} DSML出现: ${dsml_count}次"
    fi
    
    if [ "$tool_count" -gt 0 ]; then
      echo -e "  ${GREEN}✓${NC} 工具调用: ${tool_count}次"
    else
      echo -e "  ${YELLOW}⚠${NC} 未检测到工具调用"
    fi
    
    echo ""
    sleep 2
  done
}

# ============================================
# 工具加载测试
# ============================================
test_tools() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🔧 工具加载测试${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  
  if [ "$SERVER_USER" != "YOUR_SERVER_USER" ]; then
    echo "检查服务器日志..."
    ssh $SERVER_USER@$SERVER_IP "pm2 logs crypto-ai-analyzer --nostream --lines 50 2>/dev/null | grep -E 'Available tools|MCPService' | tail -10" || echo "无法获取日志"
  else
    echo "⚠️  未配置服务器信息，跳过日志检查"
  fi
  
  echo ""
}

# ============================================
# 完整测试套件
# ============================================
test_all() {
  test_production
  test_parallel
  test_tools
  
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}📊 测试总结${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "✅ 所有测试完成"
  echo ""
  echo "💡 如发现问题，运行诊断脚本："
  echo "   ./scripts/diagnose.sh all"
}

# ============================================
# 主逻辑
# ============================================
case "$MODE" in
  all)
    test_all
    ;;
  production)
    test_production
    ;;
  parallel)
    test_parallel
    ;;
  tools)
    test_tools
    ;;
  *)
    echo "用法: $0 {all|production|parallel|tools}"
    echo ""
    echo "  all         - 运行所有测试"
    echo "  production  - 生产环境测试（默认）"
    echo "  parallel    - 并行调用测试"
    echo "  tools       - 工具加载测试"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}✅ 测试完成${NC}"
echo ""
