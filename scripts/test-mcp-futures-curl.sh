#!/usr/bin/env bash
# 使用 curl 测试 MCP 合约相关工具，验证数据是否为币安合约
# 用法: ./scripts/test-mcp-futures-curl.sh
# 可选: MCP_URL=http://127.0.0.1:8080/mcp ./scripts/test-mcp-futures-curl.sh

set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

MCP_URL="${MCP_URL:-http://127.0.0.1:8080/mcp}"

echo "🧪 MCP 合约工具 curl 测试"
echo "   MCP_URL: $MCP_URL"
echo ""

# 1. 测试 get_futures_top_gainers_losers（涨跌榜）
echo "=========================================="
echo "1️⃣  get_futures_top_gainers_losers(limit=10)"
echo "=========================================="
RESP_GAINERS=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_futures_top_gainers_losers","arguments":{"limit":10}}}')

if echo "$RESP_GAINERS" | grep -q '"error"'; then
  echo "❌ 调用失败:"
  echo "$RESP_GAINERS" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.error?.message || JSON.stringify(d.error));" 2>/dev/null || echo "$RESP_GAINERS"
else
  echo "✅ 原始 JSON 摘要:"
  echo "$RESP_GAINERS" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const content = d.result?.content;
    if (!content) { console.log(JSON.stringify(d, null, 2)); process.exit(0); }
    const text = Array.isArray(content) ? content.find(c => c.type === 'text')?.text : content;
    if (text) {
      const parsed = JSON.parse(text);
      const gainers = parsed.gainers || [];
      const losers = parsed.losers || [];
      console.log('涨幅榜 symbols:', gainers.map(x => x.symbol || x.symbolName || x).join(', ') || '(无)');
      console.log('跌幅榜 symbols:', losers.map(x => x.symbol || x.symbolName || x).join(', ') || '(无)');
      console.log('');
      console.log('完整 result.content:', text.substring(0, 500) + (text.length > 500 ? '...' : ''));
    } else {
      console.log(JSON.stringify(d, null, 2));
    }
  " 2>/dev/null || echo "$RESP_GAINERS"
fi
echo ""

# 2. 测试 get_futures_multiple_tickers（批量行情，明确合约）
echo "=========================================="
echo "2️⃣  get_futures_multiple_tickers([\"ETH\",\"BTC\"])"
echo "=========================================="
RESP_TICKERS=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_futures_multiple_tickers","arguments":{"symbols":["ETH","BTC"]}}}')

if echo "$RESP_TICKERS" | grep -q '"error"'; then
  echo "❌ 调用失败:"
  echo "$RESP_TICKERS" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.error?.message || JSON.stringify(d.error));" 2>/dev/null || echo "$RESP_TICKERS"
else
  echo "✅ 原始 JSON 摘要:"
  echo "$RESP_TICKERS" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const content = d.result?.content;
    if (!content) { console.log(JSON.stringify(d, null, 2)); process.exit(0); }
    const text = Array.isArray(content) ? content.find(c => c.type === 'text')?.text : content;
    if (text) {
      const arr = JSON.parse(text);
      console.log('返回数量:', arr.length);
      arr.forEach((t, i) => console.log('  ', (t.symbol || t.symbolName || t), JSON.stringify(t).substring(0, 120) + '...'));
    } else {
      console.log(JSON.stringify(d, null, 2));
    }
  " 2>/dev/null || echo "$RESP_TICKERS"
fi
echo ""

# 3. 可选：用 search_futures_symbols 验证涨跌榜里某个 symbol 是否真有合约
echo "=========================================="
echo "3️⃣  search_futures_symbols(\"ALPACA\") — 验证是否在合约中存在"
echo "=========================================="
RESP_SEARCH=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"binance:search_futures_symbols","arguments":{"keyword":"ALPACA"}}}')

if echo "$RESP_SEARCH" | grep -q '"error"'; then
  echo "❌ 调用失败（若 MCP 工具名为 search_futures_symbols 可改 params.name）"
  echo "$RESP_SEARCH" | head -c 300
else
  echo "$RESP_SEARCH" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const content = d.result?.content;
    const text = Array.isArray(content) ? content.find(c => c.type === 'text')?.text : content;
    if (text) {
      const arr = JSON.parse(text);
      console.log('ALPACA 合约搜索结果数量:', arr.length);
      if (arr.length === 0) console.log('  → 无合约，说明涨跌榜若出现 ALPACA 则数据源不是币安合约');
      else console.log('  ', arr);
    } else {
      console.log(JSON.stringify(d, null, 2));
    }
  " 2>/dev/null || echo "$RESP_SEARCH"
fi

echo ""
echo "💡 若 get_futures_top_gainers_losers 返回的 symbol 在 search_futures_symbols 中查不到，则说明该工具数据源可能不是币安合约。"
