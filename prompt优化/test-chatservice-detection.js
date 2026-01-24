#!/usr/bin/env node

/**
 * 测试ChatService的币种检测功能
 */

import ChatService from '../src/services/ChatService.js';

async function testDetection() {
  console.log('🧪 测试ChatService币种检测功能\n');

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
    'BTC和ETH哪个好',  // 多个币种，不应触发
    '今天天气怎么样',   // 无币种，不应触发
    '推荐几个币种'      // 无特定币种，不应触发
  ];

  console.log('测试结果：\n');
  
  for (const message of testMessages) {
    const result = await ChatService.detectForcedMCPCall(message);
    
    if (result) {
      console.log(`✅ "${message}"`);
      console.log(`   → 检测到: ${result.symbol}`);
      console.log(`   → 原因: ${result.reason}\n`);
    } else {
      console.log(`❌ "${message}"`);
      console.log(`   → 未触发MCP调用\n`);
    }
  }

  console.log('✅ 测试完成！');
}

// 运行测试
testDetection().catch(console.error);
