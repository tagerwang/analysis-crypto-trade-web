# 部署成功！🎉

加密货币AI分析助手已成功部署到服务器，并包含最新的修复。

## 访问信息

- **生产环境**: https://BASE_DOMAIN/crypto-ai/
- **服务器**: SERVER_IP
- **端口**: 3000 (内部)
- **进程管理**: PM2

## 最新修复 (2026-01-21)

✅ **修复1: 历史记录加载**
- 现在可以正常点击左侧历史记录查看完整对话
- 支持跨日期目录查找会话文件
- 修复了 `StorageService.loadChat()` 和 `deleteChat()` 方法

✅ **修复2: MCP服务集成**
- AI模型现在可以调用MCP工具获取实时数据
- 支持19个Binance工具和4个CoinGecko工具
- 实现了完整的工具调用机制：识别→执行→返回结果

## 功能特性

✅ 实时加密货币价格查询
✅ 技术指标分析（RSI、MACD、布林带）
✅ 资金费率监控
✅ Alpha代币追踪
✅ 多AI模型支持（DeepSeek、千问）
✅ 自动模型切换
✅ 会话历史记录
✅ MCP工具调用（新增）

## 可用的MCP工具

### Binance工具
- `get_spot_price` - 现货价格
- `get_ticker_24h` - 24小时行情
- `comprehensive_analysis` - 综合技术分析
- `get_funding_rate` - 资金费率
- `analyze_spot_vs_futures` - 现货合约价差
- `get_realtime_alpha_airdrops` - Alpha空投
- `get_top_gainers_losers` - 涨跌幅排行
- 等19个工具...

### CoinGecko工具
- `get_price` - 获取价格
- `get_coin_data` - 币种详情
- `search_coins` - 搜索币种
- `get_trending` - 热门币种

## 测试示例

在界面中尝试以下问题：
- "BTC现在多少钱？"
- "分析一下ETH的技术指标"
- "查询资金费率最高的合约"
- "有哪些热门币种？"
- "BTC和ETH的现货合约价差是多少？"

## 管理命令

### 查看服务状态
```bash
ssh root@SERVER_IP 'pm2 status'
```

### 查看日志
```bash
ssh root@SERVER_IP 'pm2 logs crypto-ai-analyzer'
```

### 实时日志
```bash
ssh root@SERVER_IP 'pm2 logs crypto-ai-analyzer --lines 100'
```

### 重启服务
```bash
ssh root@SERVER_IP 'pm2 restart crypto-ai-analyzer'
```

### 停止服务
```bash
ssh root@SERVER_IP 'pm2 stop crypto-ai-analyzer'
```

### 查看内存使用
```bash
ssh root@SERVER_IP 'pm2 monit'
```

## 技术栈

- **前端**: 原生JavaScript + CSS + Marked.js
- **后端**: Node.js + Express
- **AI模型**: DeepSeek、千问（支持自动切换）
- **数据源**: Binance、CoinGecko、Crypto.com (MCP)
- **进程管理**: PM2
- **反向代理**: Nginx
- **SSL**: Let's Encrypt

## 配置文件

- 应用目录: `/opt/crypto-ai-analyzer`
- 环境变量: `/opt/crypto-ai-analyzer/.env`
- PM2配置: `/opt/crypto-ai-analyzer/ecosystem.config.cjs`
- Nginx配置: `/etc/nginx/sites-available/mcp-crypto-api`
- 存储目录: `/opt/crypto-ai-analyzer/storage/chats/`

## 监控

- 健康检查: https://BASE_DOMAIN/crypto-ai/health
- 内存限制: 500MB
- 自动重启: 启用
- 开机自启: 启用
- 日志轮转: 自动

## 性能优化

- MCP调用结果缓存1分钟
- 只保留最近10条消息作为上下文
- 历史记录保留30天自动清理
- 异步处理，不阻塞主流程

## 下次部署

运行以下命令即可更新：
```bash
./deploy-to-server.sh
```

脚本会自动：
1. 检查服务器连接
2. 上传最新代码
3. 安装依赖
4. 重启服务
5. 验证部署

## 故障排查

### 服务无法启动
```bash
ssh root@SERVER_IP 'pm2 logs crypto-ai-analyzer --err --lines 50'
```

### 检查端口占用
```bash
ssh root@SERVER_IP 'lsof -i :3000'
```

### 检查Nginx配置
```bash
ssh root@SERVER_IP 'nginx -t'
```

### 重载Nginx
```bash
ssh root@SERVER_IP 'systemctl reload nginx'
```

## 注意事项

1. 服务运行在 `/crypto-ai/` 路径下
2. 所有API请求需要加上 `/crypto-ai` 前缀
3. 历史记录保留30天
4. 日志文件位于 `/opt/crypto-ai-analyzer/logs/`
5. MCP工具调用有1分钟缓存
6. AI模型会根据延迟自动切换

## 文件变更记录

### 2026-01-21 修复部署
- ✅ `src/services/StorageService.js` - 修复历史会话加载
- ✅ `src/services/ChatService.js` - 集成MCP工具调用
- ✅ 新增 `FIXES_APPLIED.md` - 详细修复说明
- ✅ 新增 `test-fixes.sh` - 测试脚本

---

**部署时间**: 2026-01-21 00:27 UTC  
**部署状态**: ✅ 成功  
**健康检查**: ✅ 通过  
**可用模型**: DeepSeek, 千问
