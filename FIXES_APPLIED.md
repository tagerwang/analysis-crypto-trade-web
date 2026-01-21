# 修复说明

## 修复的问题

### 1. ✅ 历史记录点击无法加载会话

**问题原因：**
- `StorageService.loadChat()` 方法只在当天的目录下查找会话文件
- 历史会话存储在不同日期的目录中（如 `storage/chats/2026-01-20/`）
- 导致点击历史记录时找不到对应的会话文件

**修复方案：**
修改了 `src/services/StorageService.js` 中的两个方法：

1. **loadChat(sessionId)** - 加载会话
   - 先尝试在当天目录查找
   - 如果找不到，遍历所有日期目录查找
   - 确保能加载任意日期的历史会话

2. **deleteChat(sessionId)** - 删除会话
   - 同样的逻辑，支持删除任意日期的会话

### 2. ✅ AI模型未接入MCP服务

**问题原因：**
- `ChatService` 虽然导入了 `MCPService`，但没有实际调用
- AI无法获取实时的加密货币数据
- 用户询问价格、行情等信息时，AI只能基于训练数据回答

**修复方案：**

#### 2.1 增强系统提示词
在 `ChatService.buildSystemPrompt()` 中添加了详细的MCP工具说明：
- 列出所有可用的Binance和CoinGecko工具
- 说明工具的使用方法和参数
- 提供调用示例

#### 2.2 实现工具调用机制
在 `ChatService.chat()` 方法中添加了工具调用处理：

```javascript
// 1. AI识别用户需求，在回复中使用特殊格式
[TOOL_CALL:binance:get_spot_price:{"symbol":"BTC"}]

// 2. 系统解析工具调用请求
const toolCallPattern = /\[TOOL_CALL:(\w+):(\w+):(.*?)\]/g;

// 3. 执行MCP工具调用
const toolResult = await MCPService.callTool(service, tool, args);

// 4. 将结果返回给AI，生成最终回复
```

## 工作流程

### 用户查询价格的完整流程：

1. **用户输入：** "BTC现在多少钱？"

2. **AI识别需求：** 
   - 系统提示词告诉AI可以使用 `get_spot_price` 工具
   - AI回复包含工具调用标记

3. **系统执行工具：**
   ```javascript
   MCPService.callTool('binance', 'get_spot_price', {symbol: 'BTC'})
   ```

4. **获取实时数据：**
   - 调用 Binance MCP 服务器
   - 返回实时价格数据

5. **AI生成最终回复：**
   - 基于工具返回的数据
   - 生成专业、简洁的回答

## 可用的MCP工具

### Binance工具（19个）
- `get_spot_price` - 现货价格
- `get_ticker_24h` - 24小时行情
- `comprehensive_analysis` - 综合技术分析
- `get_funding_rate` - 资金费率
- `analyze_spot_vs_futures` - 现货合约价差
- 等等...

### CoinGecko工具（4个）
- `get_price` - 获取价格
- `get_coin_data` - 币种详情
- `search_coins` - 搜索币种
- `get_trending` - 热门币种

## 测试方法

### 1. 测试历史记录加载
```bash
# 启动服务器
npm start

# 在浏览器中：
# 1. 点击左侧历史记录
# 2. 应该能看到完整的对话内容
```

### 2. 测试MCP工具调用
```bash
# 运行测试脚本
./test-fixes.sh

# 或手动测试：
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "BTC现在多少钱？", "model": "auto"}'
```

### 3. 在界面中测试
打开 http://localhost:3000，尝试以下问题：
- "BTC现在多少钱？"
- "分析一下ETH的技术指标"
- "查询资金费率最高的合约"
- "有哪些热门币种？"

## 技术细节

### 文件修改清单
1. ✅ `src/services/StorageService.js` - 修复历史会话加载
2. ✅ `src/services/ChatService.js` - 集成MCP工具调用

### 兼容性
- 向后兼容，不影响现有功能
- 支持多日期目录的会话管理
- 工具调用失败时有降级处理

### 性能优化
- MCP调用结果有1分钟缓存（在MCPService中）
- 只保留最近10条消息作为上下文
- 异步处理，不阻塞主流程

## 注意事项

1. **MCP服务器连接**
   - 确保 MCP 服务器正常运行
   - 检查 `src/config/index.js` 中的 MCP URL 配置

2. **AI模型配置**
   - 需要配置 DeepSeek 或千问的 API Key
   - 在 `.env` 文件中设置

3. **工具调用格式**
   - AI需要严格按照格式输出工具调用
   - 如果AI不按格式输出，可能需要调整提示词

## 下一步优化建议

1. **函数调用（Function Calling）**
   - 如果AI模型支持原生函数调用，可以改用标准格式
   - 更可靠，不依赖文本解析

2. **工具调用可视化**
   - 在界面上显示工具调用过程
   - 让用户知道AI正在查询数据

3. **批量工具调用**
   - 支持一次调用多个工具
   - 提高效率

4. **错误处理增强**
   - 更友好的错误提示
   - 工具调用失败时的重试机制
