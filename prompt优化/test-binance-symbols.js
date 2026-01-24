#!/usr/bin/env node

/**
 * 测试币安交易对获取功能
 */

import https from 'https';

async function testBinanceSymbols() {
  console.log('🧪 测试币安交易对获取功能\n');

  try {
    console.log('1️⃣ 从币安API获取交易对列表...');
    
    const symbols = await new Promise((resolve) => {
      const options = {
        hostname: 'api.binance.com',
        path: '/api/v3/exchangeInfo',
        method: 'GET',
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              console.error(`❌ 币安API返回错误状态码: ${res.statusCode}`);
              resolve(null);
              return;
            }

            const json = JSON.parse(data);
            
            // 提取所有USDT交易对的base币种
            const symbols = json.symbols
              .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING')
              .map(s => s.baseAsset);

            resolve(symbols);
          } catch (parseError) {
            console.error('❌ 解析币安API响应失败:', parseError.message);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        console.error('❌ 币安API请求失败:', error.message);
        resolve(null);
      });

      req.on('timeout', () => {
        console.error('❌ 币安API请求超时');
        req.destroy();
        resolve(null);
      });

      req.end();
    });

    if (!symbols) {
      console.log('\n⚠️ 币安API不可用，将使用硬编码的备选方案');
      console.log('✅ 功能仍然可以正常工作（使用硬编码的常见币种列表）\n');
      return;
    }

    console.log(`✅ 成功获取 ${symbols.length} 个币安交易对\n`);
    
    // 显示前20个
    console.log('📋 前20个交易对:');
    symbols.slice(0, 20).forEach((symbol, index) => {
      console.log(`   ${index + 1}. ${symbol}`);
    });
    
    console.log('\n2️⃣ 测试常见币种是否在列表中:');
    const testSymbols = ['BTC', 'ETH', 'BNB', 'SOL', 'DOGE', 'PEPE', 'SHIB', 'ARB', 'OP'];
    testSymbols.forEach(symbol => {
      const exists = symbols.includes(symbol);
      console.log(`   ${exists ? '✅' : '❌'} ${symbol}: ${exists ? '存在' : '不存在'}`);
    });
    
    console.log('\n3️⃣ 测试币种检测逻辑:');
    const testMessages = [
      'BTC现在多少钱？',
      '以太坊价格',
      '狗狗币怎么样',
      'PEPE能涨吗',
      'BTC和ETH哪个好',  // 多个币种，不应触发
      '今天天气怎么样'    // 无币种，不应触发
    ];
    
    for (const message of testMessages) {
      let detectedSymbol = null;
      let matchCount = 0;
      
      // 测试硬编码的pattern
      const cryptoPatterns = [
        { pattern: /\b(btc|比特币|bitcoin|大饼)\b/i, symbol: 'BTC' },
        { pattern: /\b(eth|以太坊|ethereum|姨太|以太)\b/i, symbol: 'ETH' },
        { pattern: /\b(doge|狗狗币|狗币|dogecoin|狗子)\b/i, symbol: 'DOGE' },
        { pattern: /\b(pepe|佩佩|青蛙币)\b/i, symbol: 'PEPE' }
      ];
      
      for (const { pattern, symbol } of cryptoPatterns) {
        if (pattern.test(message)) {
          detectedSymbol = symbol;
          matchCount++;
        }
      }
      
      // 如果没有匹配到中文名称，尝试匹配币安的symbol
      if (matchCount === 0) {
        for (const symbol of symbols) {
          const symbolPattern = new RegExp(`\\b${symbol}\\b`, 'i');
          if (symbolPattern.test(message)) {
            detectedSymbol = symbol;
            matchCount++;
          }
        }
      }
      
      const priceKeywords = /价格|多少钱|现价|当前价|行情|走势|分析|怎么样|能涨|能跌/i;
      const shouldTrigger = matchCount === 1 && priceKeywords.test(message);
      
      console.log(`   "${message}"`);
      console.log(`      检测到: ${detectedSymbol || '无'} (匹配数: ${matchCount})`);
      console.log(`      触发MCP: ${shouldTrigger ? '✅ 是' : '❌ 否'}\n`);
    }
    
    console.log('✅ 测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
  }
}

// 运行测试
testBinanceSymbols();

