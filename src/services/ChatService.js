import ModelManager from '../models/AIProvider.js';
import MCPService from './MCPService.js';
import StorageService from './StorageService.js';

class ChatService {
  constructor() {
    this.sessions = new Map(); // sessionId -> messages[]
  }

  async chat(sessionId, userMessage, options = {}) {
    // 获取或创建会话
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    
    const messages = this.sessions.get(sessionId);
    
    // 添加用户消息
    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // 构建系统提示词
    const systemPrompt = this.buildSystemPrompt();
    
    // 准备AI消息
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })) // 保留最近10条
    ];

    // 调用AI模型
    let result = await ModelManager.chat(aiMessages, options);

    if (!result.success) {
      throw new Error(result.error || 'AI request failed');
    }

    console.log('AI Response:', result.content);

    // 检查是否需要调用MCP工具
    let finalContent = result.content;
    const toolCallPattern = /\[TOOL_CALL:(\w+):(\w+):(.*?)\]/g;
    let match;
    const toolCalls = [];
    
    while ((match = toolCallPattern.exec(result.content)) !== null) {
      toolCalls.push({
        service: match[1],
        tool: match[2],
        args: match[3]
      });
    }

    console.log('Tool calls detected:', toolCalls.length);

    // 执行MCP工具调用
    if (toolCalls.length > 0) {
      const toolResults = [];
      
      for (const call of toolCalls) {
        try {
          console.log(`Calling tool: ${call.service}:${call.tool} with args:`, call.args);
          const args = JSON.parse(call.args);
          const toolResult = await MCPService.callTool(call.service, call.tool, args);
          console.log(`Tool result:`, toolResult);
          toolResults.push({
            call,
            result: toolResult
          });
        } catch (error) {
          console.error(`Tool call error:`, error);
          toolResults.push({
            call,
            result: { success: false, error: error.message }
          });
        }
      }

      // 将工具结果添加到上下文，让AI生成最终回复
      const toolResultsText = toolResults.map(tr => {
        if (tr.result.success) {
          return `工具调用成功 [${tr.call.service}:${tr.call.tool}]:\n${JSON.stringify(tr.result.data, null, 2)}`;
        } else {
          return `工具调用失败 [${tr.call.service}:${tr.call.tool}]: ${tr.result.error}`;
        }
      }).join('\n\n');

      console.log('Tool results text:', toolResultsText);

      // 再次调用AI，让它基于工具结果生成最终回复
      const followUpMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'assistant', content: result.content },
        { role: 'user', content: `工具执行结果：\n${toolResultsText}\n\n请基于以上数据，用简洁专业的方式回答用户的问题。不要再次调用工具。` }
      ];

      const followUpResult = await ModelManager.chat(followUpMessages, options);
      
      if (followUpResult.success) {
        finalContent = followUpResult.content;
        console.log('Follow-up response:', finalContent);
      } else {
        console.error('Follow-up failed:', followUpResult.error);
        // 如果第二次调用失败，至少返回工具结果
        finalContent = `我已经查询到以下信息：\n\n${toolResultsText}`;
      }
    }

    // 添加AI回复
    const assistantMessage = {
      role: 'assistant',
      content: finalContent,
      model: result.model,
      latency: result.latency,
      timestamp: new Date().toISOString()
    };
    
    messages.push(assistantMessage);

    // 保存会话
    await StorageService.saveChat(sessionId, messages);

    return {
      message: assistantMessage,
      sessionId,
      model: result.model,
      latency: result.latency
    };
  }

  async chatStream(sessionId, userMessage, onChunk, options = {}) {
    // 获取或创建会话
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    
    const messages = this.sessions.get(sessionId);
    
    // 添加用户消息
    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // 构建系统提示词
    const systemPrompt = this.buildSystemPrompt();
    
    // 准备AI消息
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
    ];

    let fullContent = '';
    
    // 流式调用AI模型
    const result = await ModelManager.chatStream(aiMessages, (chunk) => {
      if (chunk.type === 'content') {
        fullContent += chunk.content;
        onChunk(chunk);
      }
    }, options);

    if (!result.success) {
      throw new Error(result.error || 'AI request failed');
    }

    // 检查是否需要调用MCP工具
    const toolCallPattern = /\[TOOL_CALL:(\w+):(\w+):(.*?)\]/g;
    let match;
    const toolCalls = [];
    
    while ((match = toolCallPattern.exec(fullContent)) !== null) {
      toolCalls.push({
        service: match[1],
        tool: match[2],
        args: match[3]
      });
    }

    let finalContent = fullContent;

    // 执行MCP工具调用
    if (toolCalls.length > 0) {
      onChunk({ type: 'tool_start', count: toolCalls.length });
      
      const toolResults = [];
      
      for (const call of toolCalls) {
        try {
          const args = JSON.parse(call.args);
          const toolResult = await MCPService.callTool(call.service, call.tool, args);
          toolResults.push({
            call,
            result: toolResult
          });
        } catch (error) {
          toolResults.push({
            call,
            result: { success: false, error: error.message }
          });
        }
      }

      const toolResultsText = toolResults.map(tr => {
        if (tr.result.success) {
          return `工具调用成功 [${tr.call.service}:${tr.call.tool}]:\n${JSON.stringify(tr.result.data, null, 2)}`;
        } else {
          return `工具调用失败 [${tr.call.service}:${tr.call.tool}]: ${tr.result.error}`;
        }
      }).join('\n\n');

      onChunk({ type: 'tool_done' });

      // 再次流式调用AI
      const followUpMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'assistant', content: fullContent },
        { role: 'user', content: `工具执行结果：\n${toolResultsText}\n\n请基于以上数据，用简洁专业的方式回答用户的问题。不要再次调用工具。` }
      ];

      finalContent = '';
      const followUpResult = await ModelManager.chatStream(followUpMessages, (chunk) => {
        if (chunk.type === 'content') {
          finalContent += chunk.content;
          onChunk(chunk);
        }
      }, options);
      
      if (!followUpResult.success) {
        finalContent = `我已经查询到以下信息：\n\n${toolResultsText}`;
        onChunk({ type: 'content', content: finalContent });
      }
    }

    // 添加AI回复
    const assistantMessage = {
      role: 'assistant',
      content: finalContent,
      model: result.model,
      latency: result.latency,
      timestamp: new Date().toISOString()
    };
    
    messages.push(assistantMessage);

    // 保存会话
    await StorageService.saveChat(sessionId, messages);

    return {
      sessionId,
      model: result.model,
      latency: result.latency
    };
  }

  buildSystemPrompt() {
    const mcpTools = `
## 可用工具

当用户询问价格、行情、分析等实时数据时，你必须使用以下工具获取数据。

### 工具调用格式
使用格式：[TOOL_CALL:服务名:工具名:JSON参数]

### Binance工具（服务名：binance）
- get_spot_price - 获取现货价格
  示例：[TOOL_CALL:binance:get_spot_price:{"symbol":"BTC"}]
  
- get_ticker_24h - 获取24小时行情
  示例：[TOOL_CALL:binance:get_ticker_24h:{"symbol":"ETH"}]
  
- comprehensive_analysis - 综合技术分析
  示例：[TOOL_CALL:binance:comprehensive_analysis:{"symbol":"BTC"}]
  
- get_funding_rate - 获取资金费率
  示例：[TOOL_CALL:binance:get_funding_rate:{"symbol":"BTC"}]
  
- get_realtime_funding_rate - 获取实时资金费率
  示例：[TOOL_CALL:binance:get_realtime_funding_rate:{"symbol":"BTC"}]
  
- get_top_gainers_losers - 涨跌幅排行
  示例：[TOOL_CALL:binance:get_top_gainers_losers:{"limit":10}]

### CoinGecko工具（服务名：coingecko）
- get_price - 获取价格
  示例：[TOOL_CALL:coingecko:get_price:{"coin_ids":"bitcoin"}]
  
- get_trending - 获取热门币种
  示例：[TOOL_CALL:coingecko:get_trending:{}]
  
- search_coins - 搜索币种
  示例：[TOOL_CALL:coingecko:search_coins:{"query":"bitcoin"}]

### 重要规则
1. 当用户询问实时数据时，必须先调用工具
2. 一次回复中可以调用多个工具
3. 工具调用后，系统会自动执行并返回结果
4. 收到工具结果后，基于数据回答用户问题
5. JSON参数必须是有效的JSON格式
`;

    return `你是一个专业的加密货币交易分析助手。

${mcpTools}

回答要求：
- 用户询问实时数据时，必须使用工具获取
- 简洁专业，突出关键数据
- 使用表格或列表展示数据
- 提供可操作的建议

当前时间：${new Date().toISOString()}`;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || [];
  }

  async loadSession(sessionId) {
    const messages = await StorageService.loadChat(sessionId);
    if (messages) {
      this.sessions.set(sessionId, messages);
    }
    return messages;
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    return StorageService.deleteChat(sessionId);
  }

  async listSessions() {
    return StorageService.listChats();
  }
}

export default new ChatService();
