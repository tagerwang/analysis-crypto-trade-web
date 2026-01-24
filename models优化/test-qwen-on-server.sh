#!/bin/bash

SERVER_IP="45.32.114.70"
SERVER_USER="root"
APP_DIR="/opt/crypto-ai-analyzer"

echo "🌏 连接到新加坡服务器测试通义千问API..."
echo "服务器: $SERVER_USER@$SERVER_IP"
echo ""

# 在服务器上创建并运行测试脚本
ssh $SERVER_USER@$SERVER_IP << 'ENDSSH'
cd /opt/crypto-ai-analyzer

echo "📝 创建测试脚本..."
cat > test-qwen-api.js << 'EOF'
import dotenv from 'dotenv';
dotenv.config();

async function testQwenAPI() {
  const apiKey = process.env.QWEN_API_KEY;
  const baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  
  console.log('🧪 测试通义千问API...\n');
  console.log('API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : '未配置');
  console.log('Base URL:', baseURL);
  
  // 测试多个可能的模型名称
  const modelsToTest = [
    'qwen-turbo',
    'qwen-plus',
    'qwen-max',
    'qwen2.5-72b-instruct',
    'qwen2.5-32b-instruct',
    'qwen2.5-14b-instruct',
    'qwen2.5-7b-instruct'
  ];
  
  for (const model of modelsToTest) {
    console.log(`\n📝 测试模型: ${model}`);
    
    try {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: '你好，请用一句话介绍你自己。'
            }
          ],
          stream: false
        })
      });
      
      console.log('  📡 响应状态:', response.status, response.statusText);
      
      const data = await response.json();
      
      if (!response.ok) {
        console.error(`  ❌ ${model} 失败:`, data.error?.message || data.error?.code);
        continue;
      }
      
      console.log(`  ✅ ${model} 成功!`);
      
      if (data.choices && data.choices[0]) {
        console.log('  💬 AI回复:', data.choices[0].message.content);
      }
      
      // 找到第一个成功的就停止
      console.log('\n🎉 找到可用模型:', model);
      console.log('\n完整响应:');
      console.log(JSON.stringify(data, null, 2));
      break;
      
    } catch (error) {
      console.error(`  ❌ ${model} 请求失败:`, error.message);
    }
  }
}

testQwenAPI();
EOF

echo "🚀 运行测试..."
node test-qwen-api.js

echo ""
echo "✅ 测试完成"
ENDSSH

echo ""
echo "✅ 远程测试执行完成"
