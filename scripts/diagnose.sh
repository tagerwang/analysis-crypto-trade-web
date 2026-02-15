#!/bin/bash

# 统一诊断脚本 - 整合所有诊断功能
# 用法: 
#   ./scripts/diagnose.sh all          - 完整诊断
#   ./scripts/diagnose.sh mcp          - MCP 服务诊断
#   ./scripts/diagnose.sh server       - 服务器诊断
#   ./scripts/diagnose.sh quick        - 快速诊断

set -e

# 加载环境变量
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

SERVER_IP="${SERVER_IP:-YOUR_SERVER_IP}"
SERVER_USER="${SERVER_USER:-YOUR_SERVER_USER}"
APP_PATH="${APP_PATH:-/opt/crypto-ai-analyzer}"
MCP_BINANCE_URL="${MCP_BINANCE_URL:-http://127.0.0.1:8080/mcp}"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

MODE="${1:-quick}"

echo "🔍 系统诊断工具"
echo "================================"
echo "模式: $MODE"
echo ""

# ============================================
# MCP 服务诊断
# ============================================
diagnose_mcp() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🔧 MCP 服务诊断${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  
  ssh $SERVER_USER@$SERVER_IP 'bash -s' << 'ENDSSH'
    MCP_URL="http://127.0.0.1:8080/mcp"
    
    echo "1️⃣  检查端口 8080"
    if command -v ss &>/dev/null; then
      ss -tlnp | grep :8080 || echo "❌ 端口 8080 未监听"
    else
      netstat -tlnp 2>/dev/null | grep :8080 || echo "❌ 端口 8080 未监听"
    fi
    
    echo ""
    echo "2️⃣  MCP tools/list（获取工具列表）"
    TOOLS_RESP=$(curl -s -X POST "$MCP_URL" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
      --connect-timeout 3 --max-time 10 2>/dev/null || echo '{"error":"request_failed"}')
    
    if echo "$TOOLS_RESP" | grep -q '"result"'; then
      COUNT=$(echo "$TOOLS_RESP" | grep -o '"name"' | wc -l)
      echo "✅ tools/list 成功，工具数量: $COUNT"
    else
      echo "❌ tools/list 失败"
      echo "   响应: ${TOOLS_RESP:0:200}"
    fi
    
    echo ""
    echo "3️⃣  MCP tools/call 测试"
    CALL_RESP=$(curl -s -X POST "$MCP_URL" \
      -H "Content-Type: application/json" \
      -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
          "name": "comprehensive_analysis_futures",
          "arguments": { "symbol": "BTCUSDT" }
        }
      }' \
      --connect-timeout 5 --max-time 30 2>/dev/null || echo '{"error":"request_failed"}')
    
    if echo "$CALL_RESP" | grep -q '"result"'; then
      echo "✅ tools/call 成功"
    else
      echo "❌ tools/call 失败"
    fi
ENDSSH
  
  echo ""
}

# ============================================
# 服务器诊断
# ============================================
diagnose_server() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🖥️  服务器诊断${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  
  ssh $SERVER_USER@$SERVER_IP 'bash -s' << ENDSSH
    APP_PATH="/opt/crypto-ai-analyzer"
    
    echo "1️⃣  PM2 应用状态"
    if command -v pm2 &>/dev/null; then
      pm2 list | grep crypto || echo "❌ 应用未运行"
    else
      echo "❌ PM2 未安装"
    fi
    
    echo ""
    echo "2️⃣  应用健康检查"
    HEALTH=$(curl -s http://localhost:3000/api/health 2>/dev/null || echo '{"status":"error"}')
    if echo "\$HEALTH" | grep -q '"status":"ok"'; then
      echo "✅ 应用健康"
      echo "\$HEALTH" | python3 -m json.tool 2>/dev/null || echo "\$HEALTH"
    else
      echo "❌ 应用不健康"
    fi
    
    echo ""
    echo "3️⃣  端口监听状态"
    if command -v ss &>/dev/null; then
      ss -tlnp | grep -E ":(3000|8080)" || echo "⚠️  关键端口未监听"
    else
      netstat -tlnp 2>/dev/null | grep -E ":(3000|8080)" || echo "⚠️  关键端口未监听"
    fi
    
    echo ""
    echo "4️⃣  磁盘空间"
    df -h | grep -E "(Filesystem|/$)" || df -h
    
    echo ""
    echo "5️⃣  内存使用"
    free -h
    
    echo ""
    echo "6️⃣  最近错误日志（最近10条）"
    if [ -d "\$APP_PATH" ]; then
      if command -v pm2 &>/dev/null; then
        pm2 logs crypto-ai-analyzer --nostream --lines 10 --err 2>/dev/null | tail -10 || echo "无错误日志"
      else
        echo "PM2 未安装"
      fi
    else
      echo "应用目录不存在"
    fi
ENDSSH
  
  echo ""
}

# ============================================
# 快速诊断
# ============================================
diagnose_quick() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}⚡ 快速诊断${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  
  # 本地 .env 检查
  echo "1️⃣  本地配置检查"
  if [ -f .env ]; then
    echo -e "  ${GREEN}✓${NC} .env 文件存在"
    
    # 检查必要变量
    required_vars=("SERVER_IP" "DEEPSEEK_API_KEY" "QWEN_API_KEY")
    for var in "${required_vars[@]}"; do
      if grep -q "^${var}=" .env; then
        echo -e "  ${GREEN}✓${NC} $var 已配置"
      else
        echo -e "  ${RED}✗${NC} $var 未配置"
      fi
    done
  else
    echo -e "  ${RED}✗${NC} .env 文件不存在"
  fi
  
  echo ""
  echo "2️⃣  远程服务状态"
  
  # 检查服务器连接
  if ssh -o ConnectTimeout=5 $SERVER_USER@$SERVER_IP 'exit' 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} SSH 连接正常"
    
    # 检查应用状态
    APP_STATUS=$(ssh $SERVER_USER@$SERVER_IP 'pm2 jlist 2>/dev/null | grep -o "online" | head -1' || echo "offline")
    if [ "$APP_STATUS" = "online" ]; then
      echo -e "  ${GREEN}✓${NC} 应用运行中"
    else
      echo -e "  ${RED}✗${NC} 应用未运行"
    fi
    
    # 检查健康状态
    HEALTH_STATUS=$(ssh $SERVER_USER@$SERVER_IP 'curl -s http://localhost:3000/api/health 2>/dev/null | grep -o "ok"' || echo "error")
    if [ "$HEALTH_STATUS" = "ok" ]; then
      echo -e "  ${GREEN}✓${NC} 健康检查通过"
    else
      echo -e "  ${RED}✗${NC} 健康检查失败"
    fi
  else
    echo -e "  ${RED}✗${NC} SSH 连接失败"
  fi
  
  echo ""
  echo "3️⃣  MCP 服务状态"
  
  # 检查 MCP 端口
  MCP_PORT=$(ssh $SERVER_USER@$SERVER_IP 'ss -tlnp 2>/dev/null | grep :8080 | wc -l' 2>/dev/null || echo "0")
  if [ "$MCP_PORT" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} MCP 端口 8080 监听中"
  else
    echo -e "  ${RED}✗${NC} MCP 端口 8080 未监听"
  fi
  
  echo ""
}

# ============================================
# 主逻辑
# ============================================
case "$MODE" in
  all)
    diagnose_quick
    diagnose_server
    diagnose_mcp
    ;;
  mcp)
    diagnose_mcp
    ;;
  server)
    diagnose_server
    ;;
  quick)
    diagnose_quick
    ;;
  *)
    echo "用法: $0 {all|mcp|server|quick}"
    echo ""
    echo "  all     - 完整诊断（快速+服务器+MCP）"
    echo "  mcp     - MCP 服务诊断"
    echo "  server  - 服务器诊断"
    echo "  quick   - 快速诊断（默认）"
    exit 1
    ;;
esac

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 诊断完成${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ "$MODE" = "quick" ]; then
  echo "💡 提示：运行 './scripts/diagnose.sh all' 查看完整诊断"
fi
