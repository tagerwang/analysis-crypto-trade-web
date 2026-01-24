# 币安API集成说明

## 功能概述

已成功将币安API集成到币种检测功能中，实现了动态获取交易对列表，并在API不可用时自动降级到硬编码的备选方案。

## 主要改进

### 1. 动态获取币安交易对

- **API端点**: `https://api.binance.com/api/v3/exchangeInfo`
- **获取内容**: 所有USDT交易对的base币种（共445个）
- **缓存机制**: 1小时缓存，避免频繁请求
- **超时设置**: 5秒超时，快速失败

### 2. 双重检测机制

#### 优先级1：硬编码的中文名称匹配
- 支持中文名称：比特币、以太坊、狗狗币等
- 支持英文名称：Bitcoin、Ethereum、Dogecoin等
- 支持简称和别名：大饼、姨太、狗子等

#### 优先级2：币安API动态匹配
- 当硬编码列表未匹配时，使用币安API的完整列表
- 支持所有币安USDT交易对（445个币种）
- 自动识别新上线的币种

### 3. 备选方案

当币安API不可用时（网络问题、被墙等），自动使用硬编码的常见币种列表：
- 主流币：BTC、ETH、BNB、XRP、SOL、ADA
- 热门山寨币：DOGE、SHIB、PEPE、MATIC、AVAX、DOT、LINK、UNI、ARB、OP

### 4. 中文正则表达式修复

**问题**: 原来的正则表达式使用`\b`（单词边界），在中文中不起作用

**解决方案**: 将中文词汇从`\b`中分离出来
```javascript
// 修复前（错误）
{ pattern: /\b(btc|比特币|bitcoin)\b/i, symbol: 'BTC' }

// 修复后（正确）
{ pattern: /\b(btc|bitcoin)\b|比特币/i, symbol: 'BTC' }
```

### 5. 去重机制

使用`Set`数据结构避免重复计数，确保只有单个币种时才触发MCP调用。

## 测试结果

### 成功案例 ✅
- "BTC现在多少钱？" → 触发MCP (BTC)
- "比特币价格" → 触发MCP (BTC)
- "以太坊怎么样" → 触发MCP (ETH)
- "狗狗币分析" → 触发MCP (DOGE)
- "DOGE现在多少" → 触发MCP (DOGE)
- "索拉纳价格" → 触发MCP (SOL)

### 正确拒绝 ❌
- "BTC和ETH哪个好" → 不触发（多个币种）
- "今天天气怎么样" → 不触发（无币种）
- "推荐几个币种" → 不触发（无特定币种）

## 技术细节

### 缓存机制
```javascript
static binanceSymbolsCache = null;
static binanceSymbolsCacheTime = 0;
static CACHE_DURATION = 3600000; // 1小时
```

### 请求实现
使用Node.js原生`https`模块，避免fetch兼容性问题：
- 5秒超时
- 错误处理
- 优雅降级

### 关键词扩展
新增关键词：多少、如何、会涨、会跌、建议、推荐

## 使用方式

功能已自动集成到`ChatService.detectForcedMCPCall()`方法中，无需额外配置。

当用户询问单个币种的价格或交易相关问题时，系统会自动：
1. 尝试从币安API获取完整币种列表
2. 使用硬编码pattern匹配中文名称
3. 如果未匹配，使用币安API列表匹配英文symbol
4. 如果币安API不可用，使用硬编码的备选列表

## 优势

1. **覆盖面广**: 支持445个币安交易对
2. **容错性强**: API失败时自动降级
3. **性能优化**: 1小时缓存减少请求
4. **用户友好**: 支持中英文、简称、别名
5. **准确性高**: 使用Set去重，避免误触发

## 文件清单

- `src/services/ChatService.js` - 主要实现
- `test-binance-symbols.js` - 币安API测试
- `test-detection-simple.js` - 检测逻辑测试
- `币安API集成说明.md` - 本文档
