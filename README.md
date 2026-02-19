# Crypto AI Analyzer - 加密交易分析AI助手

一站式加密货币市场数据查询与AI分析工具，通过自然语言对话获取实时价格、技术分析、市场洞察。

## ✨ 核心特性

- 🤖 **多AI模型**：支持DeepSeek、千问，智能自动切换
- 📊 **多数据源**：整合Binance、CoinGecko、Crypto.com数据
- 💬 **对话式交互**：自然语言查询，无需记忆复杂命令
- 📱 **移动端适配**：响应式设计，手机平板完美支持
- 💾 **历史记录**：自动保存对话，支持按日期管理
- ⚡ **轻量高效**：原生JS实现，无框架依赖

## 🚀 快速开始

### 前置要求

- Node.js 18+
- npm 或 yarn

### 一键部署

```bash
# 1. 克隆项目
git clone <your-repo-url>
cd analysis-crypto-trade-web

# 2. 运行部署脚本
./deploy.sh

# 3. 按提示输入配置信息
# - DeepSeek API Key（必填）
# - 千问 API Key（可选）
# - 端口号（默认3000）
# - 历史记录保留天数（默认30天）

# 4. 访问应用
# http://localhost:3000
```

### 手动部署

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入API密钥

# 3. 启动服务
npm start

# 开发模式（自动重启）
npm run dev
```

## 📋 环境变量说明

```env
# 应用配置
PORT=3000                    # 服务端口
NODE_ENV=production          # 运行环境

# AI模型API密钥
DEEPSEEK_API_KEY=sk-xxx      # DeepSeek API密钥（必填）
QWEN_API_KEY=sk-xxx          # 千问API密钥（可选）

# MCP服务配置（已配置，无需修改）
MCP_BINANCE_URL=https://BASE_DOMAIN/mcp
MCP_COINGECKO_URL=https://BASE_DOMAIN/mcp-coingecko
MCP_CRYPTO_COM_URL=https://mcp.crypto.com/market-data/mcp

# 历史记录配置
RETENTION_DAYS=30            # 历史记录保留天数
MAX_CHAT_SIZE_MB=10          # 单个会话最大大小
```

## 🎯 使用示例

### 价格查询
```
用户：BTC当前价格是多少？
AI：根据Binance实时数据，BTC/USDT当前价格为 $43,250.50...
```

### 技术分析
```
用户：分析ETH的技术指标
AI：ETH技术分析：
- RSI(14): 65.2（中性偏多）
- MACD: 金叉信号
- 布林带: 价格接近上轨...
```

### 市场趋势
```
用户：当前热门币种有哪些？
AI：根据CoinGecko数据，当前热门币种：
1. Solana (SOL) - 24h涨幅 +12.5%
2. Avalanche (AVAX) - 24h涨幅 +8.3%...
```

## 🛠️ 项目结构

```
analysis-crypto-trade-web/
├── src/
│   ├── config/
│   │   └── index.js           # 配置管理
│   ├── models/
│   │   └── AIProvider.js      # AI模型管理
│   ├── services/
│   │   ├── ChatService.js     # 对话服务
│   │   ├── MCPService.js      # MCP数据服务
│   │   └── StorageService.js  # 存储服务
│   └── server.js              # Express服务器
├── public/
│   ├── index.html             # 前端页面
│   ├── styles.css             # 样式文件
│   └── app.js                 # 前端逻辑
├── storage/
│   └── chats/                 # 对话历史存储
├── .env                       # 环境变量（需创建）
├── .env.example               # 环境变量模板
├── deploy.sh                  # 一键部署脚本
├── ecosystem.config.cjs       # PM2配置（自动生成）
└── package.json               # 项目配置
```

## 🔧 API接口

### 对话接口
```bash
POST /api/chat
Content-Type: application/json

{
  "sessionId": "session_xxx",  # 可选，不传则创建新会话
  "message": "BTC价格？",
  "model": "auto"              # auto/deepseek/qwen
}
```

### 模型切换
```bash
POST /api/model/switch
Content-Type: application/json

{
  "model": "deepseek"  # auto/deepseek/qwen
}
```

### 获取会话列表
```bash
GET /api/sessions
```

### 加载会话
```bash
GET /api/session/:sessionId
```

## 📊 可用数据源

### Binance
- 现货/合约价格
- 24小时行情
- K线数据
- 技术分析
- 资金费率
- Alpha代币信息

### CoinGecko
- 代币详细信息
- 市场排名
- 热门币种
- 价格查询

### Crypto.com
- 市场行情
- K线数据

## 🔐 安全说明

- API密钥存储在`.env`文件中，不会提交到Git
- 对话历史仅存储在本地服务器
- 支持自定义历史记录保留时间
- 建议在生产环境使用HTTPS

## 🚦 运维管理

### PM2命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs crypto-ai-analyzer

# 实时日志
pm2 logs crypto-ai-analyzer --lines 100

# 重启服务
pm2 restart crypto-ai-analyzer

# 停止服务
pm2 stop crypto-ai-analyzer

# 删除服务
pm2 delete crypto-ai-analyzer

# 监控面板
pm2 monit
```

### 日志位置

- 应用日志：`logs/out.log`
- 错误日志：`logs/error.log`
- 对话历史：`storage/chats/`

**查看「补充调用」失败原因**（登录服务器后）：

```bash
# 查看最近补调失败记录（会标明是哪个 tool 未返回数据）
pm2 logs crypto-ai-analyzer --lines 200 | grep "补充调用失败"

# 示例输出：补充调用失败 tool=get_open_interest symbol=BTC error=未返回数据
```

## 🐛 故障排查

### 服务无法启动

1. 检查端口是否被占用：`lsof -i :3000`
2. 查看错误日志：`pm2 logs crypto-ai-analyzer --err`
3. 验证环境变量：`cat .env`

### AI响应失败

1. 检查API密钥是否正确
2. 验证网络连接
3. 尝试切换其他模型

### MCP数据获取失败

1. 检查MCP服务URL是否可访问
2. 查看服务器日志：`pm2 logs crypto-ai-analyzer | grep "补充调用失败"` 可看到具体是哪个工具（如 get_open_interest、get_futures_multiple_tickers）未返回数据及错误信息
3. 验证网络防火墙设置

## 📝 开发指南

### 添加新的AI模型

编辑 `src/models/AIProvider.js`：

```javascript
// 在 initModels() 中添加
this.models.set('new-model', new AIProvider('new-model', {
  apiKey: config.ai.newModel.apiKey,
  baseURL: 'https://api.example.com',
  model: 'model-name'
}));
```

### 添加新的MCP服务

编辑 `src/services/MCPService.js`：

```javascript
async getNewService(params) {
  return this.callTool('new-service', 'tool-name', params);
}
```

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📮 联系方式

如有问题或建议，请通过Issue联系。
