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
  // 参考: https://api-docs.deepseek.com/quick_start/pricing-details-usd
  // DeepSeek 模型: deepseek-chat(V3.2 非思考) | deepseek-reasoner(V3.2 思考)
  // 定价(USD/1M tokens): chat 输入$0.07(cache hit)/$0.27(miss) 输出$1.10; reasoner 输入$0.14/$0.55 输出$2.19
  // 加密币分析推荐: deepseek-chat（性价比高、支持 Tool Calls）
  ai: {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    },
    // 千问(国际 Singapore): https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
    // 商用: qwen3-max,qwen-max* | qwen3.5-plus,qwen-plus* | qwen-flash* | qwen-turbo* | qwen3-coder-*
    // 定价(USD/1M): turbo $0.05/$0.2~$0.5 | flash ~$0.05/$0.4 | plus 约$0.4/$1.2 | max $1.6/$6.4
    // 加密币分析推荐: qwen-turbo(最省) / qwen-flash(快且省) / qwen3.5-plus(推理更强，当前默认)
    qwen: {
      apiKey: process.env.QWEN_API_KEY,
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.5-plus' // 可选: qwen-turbo(最省) | qwen-flash(快且省) | qwen-plus(平衡)
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
