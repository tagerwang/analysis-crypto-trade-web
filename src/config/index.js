import dotenv from 'dotenv';
dotenv.config();

const BASE_DOMAIN = process.env.BASE_DOMAIN;
if (!BASE_DOMAIN) {
  console.error('❌ 错误：环境变量 BASE_DOMAIN 未配置');
  console.error('请在 .env 文件中设置 BASE_DOMAIN');
  process.exit(1);
}

export default {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  baseDomain: BASE_DOMAIN,
  
  // AI模型配置
  ai: {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    },
    qwen: {
      apiKey: process.env.QWEN_API_KEY,
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-turbo'
    }
  },
  
  // MCP服务配置
  // 优先使用内网地址（同服务器），降级到外部域名
  mcp: {
    binance: process.env.MCP_BINANCE_URL || `http://127.0.0.1:8080/mcp`,
    // coingecko: process.env.MCP_COINGECKO_URL || `http://127.0.0.1:8080/mcp-coingecko`, // 已禁用
    // cryptoCom: process.env.MCP_CRYPTO_COM_URL || 'https://mcp.crypto.com/market-data/mcp'
  },
  
  // 存储配置
  storage: {
    retentionDays: parseInt(process.env.RETENTION_DAYS) || 30,
    maxChatSizeMB: parseInt(process.env.MAX_CHAT_SIZE_MB) || 10
  }
};
