#!/usr/bin/env node

/**
 * 简单测试币种检测逻辑（不依赖币安API）
 */

function testDetection() {
  console.log('🧪 测试币种检测逻辑\n');

  const cryptoPatterns = [
    { pattern: /\b(btc|bitcoin|大饼)\b|比特币/i, symbol: 'BTC' },
    { pattern: /\b(eth|ethereum|姨太)\b|以太坊|以太/i, symbol: 'ETH' },
    { pattern: /\b(bnb|binance coin)\b|币安币|币安/i, symbol: 'BNB' },
    { pattern: /\b(doge|dogecoin|狗子)\b|狗狗币|狗币/i, symbol: 'DOGE' },
    { pattern: /\b(sol|solana)\b|索拉纳/i, symbol: 'SOL' },
    { pattern: /\b(pepe)\b|佩佩|青蛙币/i, symbol: 'PEPE' }
  ];

  const testMessages = [
    'BTC现在多少钱？',
    '比特币价格',
    '以太坊怎么样',
    'ETH能涨吗',
    '狗狗币分析',
    'DOGE现在多少',
    'PEPE能涨吗',
    '币安币价格',
    'BNB怎么样',
    'SOL现在多少钱',
    '索拉纳价格',
    'BTC和ETH哪个好',  // 多个币种
    '今天天气怎么样',   // 无币种
    '推荐几个币种'      // 无特定币种
  ];

  const priceKeywords = /价格|多少钱|多少|现价|当前价|行情|走势|分析|怎么样|如何|能涨|能跌|会涨|会跌|开多|开空|做多|做空|买入|卖出|上车|下车|建议|推荐/i;

  for (const message of testMessages) {
    let detectedSymbol = null;
    const matchedSymbols = new Set();

    for (const { pattern, symbol } of cryptoPatterns) {
      if (pattern.test(message)) {
        detectedSymbol = symbol;
        matchedSymbols.add(symbol);
      }
    }

    const matchCount = matchedSymbols.size;
    const shouldTrigger = matchCount === 1 && priceKeywords.test(message);

    console.log(`"${message}"`);
    if (shouldTrigger) {
      console.log(`  ✅ 触发MCP: ${detectedSymbol}`);
    } else {
      console.log(`  ❌ 不触发 (匹配数: ${matchCount}, 匹配币种: ${Array.from(matchedSymbols).join(', ') || '无'})`);
    }
    console.log();
  }

  console.log('✅ 测试完成！');
}

testDetection();
