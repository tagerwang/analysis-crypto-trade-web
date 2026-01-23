# MCP查询准确率优化指南

## 已完成的优化

### 1. System Prompt优化 ✅

已将完整的专业交易助手System Prompt集成到 `src/services/ChatService.js`：

**核心改进：**
- ✅ 明确的身份定位：专业交易助手，直接、不废话
- ✅ 关键规则：任何价格/行情问题必须先调用MCP
- ✅ 交易分析规则：必须包含方向+概率+进场/止损/目标+仓位
- ✅ 加密货币术语表：完整的交易术语和风险等级定义
- ✅ 分析框架：标准化的交易机会分析流程
- ✅ 币种代码识别规则：自动识别各种币种表达方式
- ✅ MCP触发关键词：明确列出必须触发MCP的关键词

### 2. 触发关键词增强 ✅

System Prompt中明确定义了触发MCP调用的关键词：

**价格相关：**
- 价格、多少钱、现价、当前价、行情

**分析相关：**
- 分析、怎么样、能涨吗、能跌吗、走势

**交易相关：**
- 开多、开空、做多、做空、买入、卖出

**数据相关：**
- 涨跌幅、成交量、资金费率、排行

**币种名称：**
- BTC、ETH、比特币、以太坊等任何加密货币名称

### 3. 币种识别规则 ✅

AI现在能自动识别并转换各种币种表达：
- BTC/比特币 → symbol: "BTC"
- ETH/以太坊 → symbol: "ETH"
- SOL/索拉纳 → symbol: "SOL"
- BNB/币安币 → symbol: "BNB"
- XRP/瑞波币 → symbol: "XRP"
- DOGE/狗狗币 → symbol: "DOGE"
- ADA/艾达币 → symbol: "ADA"

### 4. 前端快捷按钮优化 ✅

更新了欢迎页面的快捷按钮，使用更口语化的提示词：
- "BTC现在多少钱？" - 触发价格查询
- "ETH能开多吗？" - 触发分析和建议
- "SOL走势怎么样？" - 触发走势分析
- "今天涨幅最大的币有哪些？" - 触发排行查询
- "BTC的资金费率" - 触发资金费率查询
- "热门币种" - 触发热门币种查询

## 工作原理

### MCP调用流程

1. **用户输入** → 包含币种名称或关键词
2. **AI识别** → System Prompt指导AI识别触发条件
3. **生成工具调用** → 格式：`[TOOL_CALL:服务名:工具名:JSON参数]`
4. **系统执行** → ChatService检测并执行MCP调用
5. **返回结果** → AI基于实时数据生成专业建议

### 示例对话

**用户：** "BTC现在多少钱？"

**AI内部处理：**
```
识别：币种=BTC，关键词=多少钱（价格查询）
触发：[TOOL_CALL:binance:get_spot_price:{"symbol":"BTC"}]
```

**AI回复：**
```
BTC当前 $67,234
24h涨幅：+2.3%
24h成交量：$28.5B
```

**用户：** "ETH能开多吗？"

**AI内部处理：**
```
识别：币种=ETH，关键词=开多（交易建议）
触发：[TOOL_CALL:binance:comprehensive_analysis:{"symbol":"ETH"}]
```

**AI回复：**
```
ETH当前 $3,456
建议：开多，看涨概率65%
依据：
- 突破关键阻力位$3,400
- RSI 58（未超买）
- 成交量放大
风险：中等。建议仓位30-40%，止损$3,350，目标$3,650
```

## 测试方法

### 1. 使用测试脚本

```bash
# 启动服务
npm start

# 在另一个终端运行测试
./test-mcp-trigger.sh
```

### 2. 手动测试

在Web界面测试以下输入：

**基础价格查询：**
- "BTC多少钱"
- "比特币价格"
- "ETH现价"

**交易建议：**
- "BTC能开多吗"
- "ETH适合做空吗"
- "SOL现在能买吗"

**技术分析：**
- "BTC走势怎么样"
- "分析ETH"
- "SOL的技术指标"

**市场数据：**
- "今天涨幅最大的币"
- "BTC的资金费率"
- "热门币种"

## 预期效果

### 优化前
- ❌ 用户："BTC多少钱" → AI可能回答："我无法获取实时价格..."
- ❌ 用户："ETH能开多吗" → AI可能回答："建议您查看实时行情..."

### 优化后
- ✅ 用户："BTC多少钱" → AI自动调用MCP → 返回实时价格
- ✅ 用户："ETH能开多吗" → AI自动调用MCP → 返回技术分析+明确建议

## 进一步优化建议

### 1. 添加更多币种别名

在System Prompt中扩展币种识别规则：
```
- MATIC/Polygon → symbol: "MATIC"
- AVAX/雪崩 → symbol: "AVAX"
- DOT/波卡 → symbol: "DOT"
```

### 2. 优化工具选择逻辑

根据用户意图选择最合适的工具：
- 简单价格查询 → `get_spot_price`
- 详细分析 → `comprehensive_analysis`
- 交易建议 → `comprehensive_analysis` + `get_funding_rate`

### 3. 添加上下文记忆

记住用户最近关注的币种：
```javascript
// 在ChatService中添加
this.userContext = {
  recentSymbols: [],
  preferences: {}
};
```

### 4. 多币种对比

支持同时查询多个币种：
```
用户："对比BTC和ETH"
AI：调用两次MCP，返回对比表格
```

## 配置文件位置

- **System Prompt**: `src/services/ChatService.js` → `buildSystemPrompt()`
- **MCP配置**: `src/config/index.js` → `mcp`
- **前端界面**: `public/index.html` → 快捷按钮
- **前端逻辑**: `public/app.js` → 消息处理

## 故障排查

### MCP未触发

1. **检查System Prompt是否生效**
```bash
# 查看日志
tail -f logs/out-0.log
```

2. **检查AI响应**
```bash
# 应该看到 [TOOL_CALL:...] 标记
```

3. **检查MCP服务状态**
```bash
# 测试MCP服务
curl http://127.0.0.1:8080/mcp/health
```

### AI不给明确建议

1. 检查System Prompt中的 `<critical_rules>` 是否正确加载
2. 确认AI模型支持长System Prompt（DeepSeek和Qwen都支持）
3. 查看AI返回的原始内容是否包含模糊词汇

## 监控指标

建议监控以下指标：
- MCP调用成功率
- 用户问题类型分布
- AI响应时间
- 用户满意度（通过反馈收集）

## 总结

通过以上优化，AI助手现在能够：
1. ✅ 自动识别币种名称和交易意图
2. ✅ 主动调用MCP获取实时数据
3. ✅ 给出明确的交易建议（方向+概率+仓位）
4. ✅ 使用专业但不废话的语言风格
5. ✅ 避免过度免责和模糊表述

MCP查询准确率应该从之前的不确定状态提升到接近100%的触发率。
