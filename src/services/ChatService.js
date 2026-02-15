import ModelManager from '../models/AIProvider.js';
import MCPService from './MCPService.js';
import StorageService from './StorageService.js';
import ValidationService from './ValidationService.js';

class ChatService {
  constructor() {
    this.sessions = new Map(); // sessionId -> messages[]
    this.sessionMeta = new Map(); // sessionId -> { disclaimerShown: boolean }
  }

  async chat(sessionId, userMessage, options = {}) {
    // 获取或创建会话
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
      this.sessionMeta.set(sessionId, { disclaimerShown: false });
    }
    
    const messages = this.sessions.get(sessionId);
    
    // 添加用户消息
    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // 检测是否需要强制调用MCP（单个币种查询）
    const forcedMCPCall = await this.detectForcedMCPCall(userMessage);
    
    // 获取 MCP 工具列表（OpenAI 格式）
    const toolsResult = await MCPService.getAllToolsOpenAIFormatWithStatus();
    const tools = toolsResult.tools;
    console.log(`[ChatService] Available tools: ${tools.length}`);
    if (tools.length === 0) {
      console.warn('[ChatService] 无可用 MCP 工具，AI 将无法调用 comprehensive_analysis_futures 等工具。请检查 MCP 服务（如 binance）是否启动、config.mcp 是否配置正确。');
    }
    
    // 构建系统提示词（传入工具是否可用和服务状态）
    const systemPrompt = this.buildSystemPrompt(sessionId, false, forcedMCPCall, tools.length > 0, toolsResult.status);
    
    // 准备AI消息
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })) // 保留最近10条
    ];
    
    // 只有当有可用工具时才传递 tools 参数
    const chatOptions = { ...options };
    if (tools.length > 0) {
      chatOptions.tools = tools;
    }

    // 调用AI模型
    let result = await ModelManager.chat(aiMessages, chatOptions);

    if (!result.success) {
      throw new Error(result.error || 'AI request failed');
    }

    console.log('AI Response:', result.content);

    // 检查是否有工具调用
    let finalContent = result.content;
    const toolCalls = result.tool_calls || [];

    console.log('Tool calls detected:', toolCalls.length);

    // 执行MCP工具调用
    if (toolCalls.length > 0) {
      const toolResults = [];
      
      for (const tc of toolCalls) {
        try {
          const parsed = MCPService.parseToolName(tc.function?.name);
          if (!parsed) {
            console.warn('Cannot parse tool name:', tc.function?.name);
            continue;
          }

          console.log(`Calling tool: ${parsed.service}:${parsed.tool}`);
          const args = JSON.parse(tc.function?.arguments || '{}');
          const toolResult = await MCPService.callTool(parsed.service, parsed.tool, args);
          console.log(`Tool result:`, toolResult);
          
          toolResults.push({
            id: tc.id,
            call: { service: parsed.service, tool: parsed.tool, args },
            result: toolResult
          });
        } catch (error) {
          console.error(`Tool call error:`, error);
          toolResults.push({
            id: tc.id,
            call: { service: 'unknown', tool: 'unknown', args: {} },
            result: { success: false, error: error.message }
          });
        }
      }

      // 做多/做空场景：若模型未调持仓量、多空比、买卖比，则服务端补调
      const supplement = this.needsLongShortSupplement(userMessage, toolResults, forcedMCPCall);
      if (supplement?.need && supplement.symbol) {
        const extra = await this.supplementLongShortTools(supplement.symbol);
        toolResults.push(...extra);
      }

      // 构造 OpenAI 消息格式
      const assistantMsg = {
        role: 'assistant',
        content: result.content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function?.name,
            arguments: tc.function?.arguments
          }
        }))
      };

      const toolMessages = toolResults.map(tr => ({
        role: 'tool',
        tool_call_id: tr.id,
        content: tr.result.success 
          ? JSON.stringify(tr.result.data)
          : JSON.stringify({ error: tr.result.error })
      }));

      // 再次调用AI，让它基于工具结果生成最终回复
      const followUpSystemPrompt = this.buildSystemPrompt(sessionId, true, null, false);
      
      // 将工具结果转换为简化的文本格式，避免传递 tool_calls 结构
      // 🔒 脱敏处理：不暴露具体的工具名称
      const toolResultsText = toolResults.map((tr, index) => {
        const toolInfo = `[数据源 ${index + 1}]`;
        if (tr.result.success) {
          return `${toolInfo} ✅ 成功\n数据:\n${JSON.stringify(tr.result.data, null, 2)}`;
        } else {
          return `${toolInfo} ❌ 失败\n错误: ${tr.result.error}`;
        }
      }).join('\n\n---\n\n');
      
      const toolSummary = `📊 数据获取情况 (共${toolResults.length}个数据源):\n${toolResults.map((tr, i) => 
        `  ${i + 1}. 数据源 ${tr.result.success ? '✅ 成功' : '❌ 失败'}`
      ).join('\n')}\n\n🔒 重要：不要在回复中提及具体的工具名称、API或数据源。直接基于数据给出分析。`;
      
      const followUpMessages = [
        { role: 'system', content: followUpSystemPrompt },
        ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: `${toolSummary}\n\n${toolResultsText}` }
      ];

      // Follow-up 时明确不传 tools，避免再次调用工具
      const followUpOptions = { ...options };
      delete followUpOptions.tools;
      delete followUpOptions.tool_choice; // 确保删除 tool_choice
      const followUpResult = await ModelManager.chat(followUpMessages, followUpOptions);
      
      if (followUpResult.success) {
        finalContent = followUpResult.content;
        console.log('Follow-up response:', finalContent);
        
        // 验证价格数据准确性
        const validation = await ValidationService.validatePriceData(finalContent, toolResults);
        console.log('Price validation result:', validation);
        
        if (!validation.valid && validation.needsCorrection) {
          // 价格数据有严重偏差，需要重新生成回复
          console.warn('⚠️ 检测到价格数据偏差，重新生成回复中...');
          console.warn('Corrections:', validation.corrections);
          
          // 重新生成完整的回复（包括买卖点、止损位等）
          finalContent = await ValidationService.regenerateResponseWithCorrectPrice(
            finalContent,
            validation,
            toolResults,
            (msgs) => ModelManager.chat(msgs, options),
            messages,
            followUpSystemPrompt
          );
          console.log('Regenerated response:', finalContent);
        } else if (validation.warnings.length > 0) {
          // 有警告但不需要纠正，记录日志
          console.warn('Price validation warnings:', validation.warnings);
        }
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
      this.sessionMeta.set(sessionId, { disclaimerShown: false });
    }
    
    const messages = this.sessions.get(sessionId);
    
    // 添加用户消息
    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // 检测是否需要强制调用MCP（单个币种查询）
    const forcedMCPCall = await this.detectForcedMCPCall(userMessage);
    
    // 获取 MCP 工具列表（OpenAI 格式）
    const toolsResult = await MCPService.getAllToolsOpenAIFormatWithStatus();
    const tools = toolsResult.tools;
    console.log(`[ChatService] Available tools for stream: ${tools.length}`);
    if (tools.length === 0) {
      console.warn('[ChatService] 无可用 MCP 工具，AI 将无法调用 comprehensive_analysis_futures 等工具。请检查 MCP 服务（如 binance）是否启动、config.mcp 是否配置正确。');
    }
    
    // 构建系统提示词（传入工具是否可用和服务状态）
    const systemPrompt = this.buildSystemPrompt(sessionId, false, forcedMCPCall, tools.length > 0, toolsResult.status);
    
    // 准备AI消息
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
    ];
    
    // 只有当有可用工具时才传递 tools 参数
    const chatOptions = { ...options };
    if (tools.length > 0) {
      chatOptions.tools = tools;
    }

    let fullContent = '';
    
    // 流式调用AI模型
    const result = await ModelManager.chatStream(aiMessages, (chunk) => {
      if (chunk.type === 'content') {
        fullContent += chunk.content;
        onChunk(chunk);
      }
    }, chatOptions);

    if (!result.success) {
      throw new Error(result.error || 'AI request failed');
    }

    // 检查是否有工具调用
    const toolCalls = result.tool_calls || [];
    let finalContent = fullContent;

    // 执行MCP工具调用
    if (toolCalls.length > 0) {
      onChunk({ type: 'tool_start', count: toolCalls.length });
      
      const toolResults = [];
      
      for (const tc of toolCalls) {
        try {
          const parsed = MCPService.parseToolName(tc.function?.name);
          if (!parsed) {
            console.warn('Cannot parse tool name:', tc.function?.name);
            continue;
          }

          const args = JSON.parse(tc.function?.arguments || '{}');
          const toolResult = await MCPService.callTool(parsed.service, parsed.tool, args);
          
          toolResults.push({
            id: tc.id,
            call: { service: parsed.service, tool: parsed.tool, args },
            result: toolResult
          });
        } catch (error) {
          toolResults.push({
            id: tc.id,
            call: { service: 'unknown', tool: 'unknown', args: {} },
            result: { success: false, error: error.message }
          });
        }
      }

      // 做多/做空场景：若模型未调持仓量、多空比、买卖比，则服务端补调
      const supplement = this.needsLongShortSupplement(userMessage, toolResults, forcedMCPCall);
      if (supplement?.need && supplement.symbol) {
        const extra = await this.supplementLongShortTools(supplement.symbol);
        toolResults.push(...extra);
      }

      onChunk({ type: 'tool_done' });

      console.log(`[ChatService] Tool calls completed: ${toolResults.length} results`);

      // 构造 OpenAI 消息格式
      const assistantMsg = {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function?.name,
            arguments: tc.function?.arguments
          }
        }))
      };

      const toolMessages = toolResults.map(tr => ({
        role: 'tool',
        tool_call_id: tr.id,
        content: tr.result.success 
          ? JSON.stringify(tr.result.data)
          : JSON.stringify({ error: tr.result.error })
      }));

      // 再次流式调用AI
      const followUpSystemPrompt = this.buildSystemPrompt(sessionId, true, null, false);
      
      // 将工具结果转换为简化的文本格式，避免传递 tool_calls 结构
      // 🔒 脱敏处理：不暴露具体的工具名称
      const toolResultsText = toolResults.map((tr, index) => {
        const toolInfo = `[数据源 ${index + 1}]`;
        if (tr.result.success) {
          return `${toolInfo} ✅ 成功\n数据:\n${JSON.stringify(tr.result.data, null, 2)}`;
        } else {
          return `${toolInfo} ❌ 失败\n错误: ${tr.result.error}`;
        }
      }).join('\n\n---\n\n');
      
      const toolSummary = `📊 资源调用情况 (共${toolResults.length}个):\n${toolResults.map((tr, i) => 
        `  ${i + 1}. ${tr.call.service}:${tr.call.tool} ${tr.result.success ? '✅ 成功' : '❌ 失败'}`
      ).join('\n')}\n\n请在回答开头简要列出使用的工具及状态，然后基于数据给出分析。`;
      // const toolSummary = `📊 数据获取情况 (共${toolResults.length}个数据源):\n${toolResults.map((tr, i) =>
      //   `  ${i + 1}. 数据源 ${tr.result.success ? '✅ 成功' : '❌ 失败'}`
      // ).join('\n')}\n\n🔒 重要：不要在回复中提及具体的工具名称、API或数据源。直接基于数据给出分析。`;
      
      const followUpMessages = [
        { role: 'system', content: followUpSystemPrompt },
        ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: `${toolSummary}\n\n${toolResultsText}` }
      ];

      console.log(`[ChatService] Starting follow-up request (toolsAvailable: false, tools: undefined)`);
      console.log(`[ChatService] Follow-up prompt includes <mcp_tools>: ${followUpSystemPrompt.includes('<mcp_tools>')}`);
      console.log(`[ChatService] Follow-up prompt includes "工具使用规则": ${followUpSystemPrompt.includes('工具使用规则')}`);

      finalContent = '';
      // Follow-up 时明确不传 tools，避免再次调用工具
      const followUpOptions = { ...options };
      delete followUpOptions.tools;
      delete followUpOptions.tool_choice; // 确保删除 tool_choice
      const followUpResult = await ModelManager.chatStream(followUpMessages, (chunk) => {
        if (chunk.type === 'content') {
          finalContent += chunk.content;
          onChunk(chunk);
        }
      }, followUpOptions);
      
      console.log(`[ChatService] Follow-up completed. Success: ${followUpResult.success}, tool_calls: ${followUpResult.tool_calls?.length || 0}`);
      
      if (!followUpResult.success) {
        // 🔒 脱敏处理：不暴露具体的工具名称
        const toolResultsText = toolResults.map((tr, index) => {
          if (tr.result.success) {
            return `数据源 ${index + 1} 成功:\n${JSON.stringify(tr.result.data, null, 2)}`;
          } else {
            return `数据源 ${index + 1} 失败: ${tr.result.error}`;
          }
        }).join('\n\n');
        
        finalContent = `我已经查询到以下信息：\n\n${toolResultsText}`;
        onChunk({ type: 'content', content: finalContent });
      } else {
        // 验证价格数据准确性
        const validation = await ValidationService.validatePriceData(finalContent, toolResults);
        console.log('Price validation result (stream):', validation);
        
        if (!validation.valid && validation.needsCorrection) {
          // 价格数据有严重偏差，需要重新生成回复
          console.warn('⚠️ 检测到价格数据偏差，重新生成回复中...');
          console.warn('Corrections:', validation.corrections);
          
          // 通知前端正在重新生成
          onChunk({ type: 'correction_start', message: '检测到数据偏差，正在重新生成...' });
          
          // 重新生成完整的回复
          const regeneratedContent = await ValidationService.regenerateResponseWithCorrectPrice(
            finalContent,
            validation,
            toolResults,
            (msgs) => ModelManager.chat(msgs, options),
            messages,
            followUpSystemPrompt
          );
          
          // 清空之前的内容，发送新内容
          onChunk({ type: 'correction_replace', content: regeneratedContent });
          
          finalContent = regeneratedContent;
          console.log('Regenerated response (stream):', finalContent);
        } else if (validation.warnings.length > 0) {
          // 有警告但不需要纠正，记录日志
          console.warn('Price validation warnings (stream):', validation.warnings);
        }
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

  /**
   * 缓存币安交易对列表
   */
  static binanceSymbolsCache = null;
  static binanceSymbolsCacheTime = 0;
  static CACHE_DURATION = 3600000 * 24; // 24小时缓存

  /**
   * 常见币种中英文映射（用于匹配中文名称）
   */
  static cryptoPatterns = [
    // 主流币
    { pattern: /\b(btc|bitcoin|大饼)\b|比特币/i, symbol: 'BTC' },
    { pattern: /\b(eth|ethereum|姨太)\b|以太坊|以太/i, symbol: 'ETH' },
    { pattern: /\b(bnb|binance coin)\b|币安币|币安/i, symbol: 'BNB' },
    { pattern: /\b(xrp|ripple)\b|瑞波币|瑞波/i, symbol: 'XRP' },
    { pattern: /\b(sol|solana)\b|索拉纳/i, symbol: 'SOL' },
    { pattern: /\b(ada|cardano)\b|艾达币|卡尔达诺/i, symbol: 'ADA' },
    // 热门山寨币
    { pattern: /\b(doge|dogecoin|狗子)\b|狗狗币|狗币/i, symbol: 'DOGE' },
    { pattern: /\b(shib|shiba)\b|柴犬币|柴犬/i, symbol: 'SHIB' },
    { pattern: /\b(pepe)\b|佩佩|青蛙币/i, symbol: 'PEPE' },
    { pattern: /\b(matic|polygon)\b|马蹄币|马蹄/i, symbol: 'MATIC' },
    { pattern: /\b(avax|avalanche)\b|雪崩/i, symbol: 'AVAX' },
    { pattern: /\b(dot|polkadot)\b|波卡/i, symbol: 'DOT' },
    { pattern: /\b(link|chainlink)\b|链克/i, symbol: 'LINK' },
    { pattern: /\b(uni|uniswap)\b|优你/i, symbol: 'UNI' },
    { pattern: /\b(arb|arbitrum)\b|阿比/i, symbol: 'ARB' },
    { pattern: /\b(op|optimism)\b/i, symbol: 'OP' }
  ];

  /**
   * 从币安API获取所有交易对
   */
  async fetchBinanceSymbols() {
    try {
      // 检查缓存
      const now = Date.now();
      if (ChatService.binanceSymbolsCache && (now - ChatService.binanceSymbolsCacheTime) < ChatService.CACHE_DURATION) {
        console.log('✅ 使用缓存的币安交易对列表');
        return ChatService.binanceSymbolsCache;
      }

      console.log('🔄 从币安API获取交易对列表...');
      
      // 使用动态import来支持Node.js环境
      const https = await import('https');
      
      return new Promise((resolve) => {
        const options = {
          hostname: 'api.binance.com',
          path: '/api/v3/exchangeInfo',
          method: 'GET',
          timeout: 5000, // 5秒超时
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        };

        const req = https.default.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                console.error(`❌ 币安API返回错误状态码: ${res.statusCode}`);
                resolve(null);
                return;
              }

              const json = JSON.parse(data);
              
              // 提取所有USDT交易对的base币种
              const symbols = json.symbols
                .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING')
                .map(s => s.baseAsset);

              console.log(`✅ 成功获取${symbols.length}个币安交易对`);
              
              // 更新缓存
              ChatService.binanceSymbolsCache = symbols;
              ChatService.binanceSymbolsCacheTime = now;
              
              resolve(symbols);
            } catch (parseError) {
              console.error('❌ 解析币安API响应失败:', parseError.message);
              resolve(null);
            }
          });
        });

        req.on('error', (error) => {
          console.error('❌ 币安API请求失败:', error.message);
          resolve(null);
        });

        req.on('timeout', () => {
          console.error('❌ 币安API请求超时');
          req.destroy();
          resolve(null);
        });

        req.end();
      });
    } catch (error) {
      console.error('❌ 获取币安交易对异常:', error.message);
      return null;
    }
  }

  /**
   * 检测是否需要强制调用MCP（币种价格查询）
   * @param {string} userMessage - 用户消息
   * @returns {Object|null} { symbols, reason } 或 null
   */
  /**
   * 判断是否为「做多/做空/期货走势」场景且缺少持仓量、多空比、买卖比，并解析 symbol
   * @param {string} userMessage
   * @param {Array} toolResults - 当前已执行的工具结果
   * @param {{ symbols?: string[] }|null} forcedMCPCall
   * @returns {{ need: boolean, symbol: string }|null}
   */
  needsLongShortSupplement(userMessage, toolResults, forcedMCPCall) {
    const longShortKeywords = /做多|做空|适合做多|适合做空|开多|开空|做多还是做空|期货走势|怎么样.*(做多|做空)/i;
    if (!longShortKeywords.test(userMessage)) return null;

    const called = new Set((toolResults || []).map(tr => tr.call?.tool));
    const missing = ['get_open_interest', 'get_top_long_short_ratio', 'get_taker_buy_sell_ratio'].filter(t => !called.has(t));
    if (missing.length === 0) return null;

    const symbol = forcedMCPCall?.symbols?.[0]
      || toolResults?.[0]?.call?.args?.symbol
      || (Array.isArray(toolResults?.[0]?.call?.args?.symbols) && toolResults[0].call.args.symbols[0])
      || 'BTC';
    return { need: true, symbol, missing };
  }

  /**
   * 补调持仓量、多空比、买卖比（做多/做空场景下模型未调用时由服务端补调）
   * @param {string} symbol
   * @returns {Promise<Array<{id:string, call:object, result:object}>>}
   */
  async supplementLongShortTools(symbol) {
    const binance = 'binance';
    const tasks = [
      { id: 'supplement-oi', tool: 'get_open_interest', args: { symbol } },
      { id: 'supplement-ls', tool: 'get_top_long_short_ratio', args: { symbol } },
      { id: 'supplement-taker', tool: 'get_taker_buy_sell_ratio', args: { symbol } }
    ];
    const results = await Promise.all(
      tasks.map(async ({ id, tool, args }) => {
        try {
          const res = await MCPService.callTool(binance, tool, args);
          return { id, call: { service: binance, tool, args }, result: res };
        } catch (err) {
          return { id, call: { service: binance, tool, args }, result: { success: false, error: err.message } };
        }
      })
    );
    console.log(`[ChatService] 做多/做空补调: ${symbol} 持仓量/多空比/买卖比 ${results.filter(r => r.result.success).length}/3 成功`);
    return results;
  }

  async detectForcedMCPCall(userMessage) {
    // 尝试从币安API获取完整列表
    const binanceSymbols = await this.fetchBinanceSymbols();
    
    if (binanceSymbols) {
      // 使用币安API数据
      console.log(`✅ 使用币安API数据检测币种（共${binanceSymbols.length}个）`);
      
      // 先用硬编码的pattern匹配中文名称
      const matchedSymbols = new Set(); // 使用Set避免重复计数

      for (const { pattern, symbol } of ChatService.cryptoPatterns) {
        if (pattern.test(userMessage)) {
          matchedSymbols.add(symbol);
        }
      }

      // 如果没有匹配到中文名称，尝试匹配币安的symbol
      if (matchedSymbols.size === 0) {
        for (const symbol of binanceSymbols) {
          // 匹配完整的symbol（如BTC、ETH）
          const symbolPattern = new RegExp(`\\b${symbol}\\b`, 'i');
          if (symbolPattern.test(userMessage)) {
            matchedSymbols.add(symbol);
          }
        }
      }

      // 只要检测到币种（1个或多个）就检查是否需要调用MCP
      if (matchedSymbols.size > 0) {
        // 检测是否是价格/交易相关的问题
        const priceKeywords = /价格|多少钱|多少|现价|当前价|行情|走势|分析|怎么样|如何|能涨|能跌|会涨|会跌|开多|开空|做多|做空|买入|卖出|上车|下车|建议|推荐|持仓量|多空比|买卖比|成交量|流动性|适合|机会/i;
        
        if (priceKeywords.test(userMessage)) {
          const symbolsArray = Array.from(matchedSymbols);
          console.log(`🎯 检测到币种查询：${symbolsArray.join(', ')}（共${symbolsArray.length}个），强制调用MCP（币安API）`);
          return {
            symbols: symbolsArray,
            reason: `${symbolsArray.length}个币种价格/交易查询`
          };
        }
      }

      return null;
    }

    // 币安API失败，使用硬编码的备选方案
    console.log('⚠️ 币安API不可用，使用硬编码的币种列表（备选方案）');
    
    // 检测是否提到币种
    const matchedSymbols = new Set();

    for (const { pattern, symbol } of ChatService.cryptoPatterns) {
      if (pattern.test(userMessage)) {
        matchedSymbols.add(symbol);
      }
    }

    // 只要检测到币种（1个或多个）就检查是否需要调用MCP
    if (matchedSymbols.size > 0) {
      // 检测是否是价格/交易相关的问题
      const priceKeywords = /价格|多少钱|多少|现价|当前价|行情|走势|分析|怎么样|如何|能涨|能跌|会涨|会跌|开多|开空|做多|做空|买入|卖出|上车|下车|建议|推荐|持仓量|多空比|买卖比|成交量|流动性|适合|机会/i;
      
      if (priceKeywords.test(userMessage)) {
        const symbolsArray = Array.from(matchedSymbols);
        console.log(`🎯 检测到币种查询：${symbolsArray.join(', ')}（共${symbolsArray.length}个），强制调用MCP（硬编码备选）`);
        return {
          symbols: symbolsArray,
          reason: `${symbolsArray.length}个币种价格/交易查询`
        };
      }
    }

    return null;
  }

  buildSystemPrompt(sessionId, skipDisclaimer = false, forcedMCPCall = null, toolsAvailable = true, servicesStatus = null) {
    // 获取会话元数据
    const meta = this.sessionMeta.get(sessionId) || { disclaimerShown: false };
    
    // 是否显示免责声明（每个会话只显示一次，且不在followUp时显示）、同时只给30%的几率显示
    const shouldShowDisclaimer = !skipDisclaimer && !meta.disclaimerShown && Math.random() <= 0.3;
    
    const disclaimer = shouldShowDisclaimer
      ? '\n\n<first_message_disclaimer>\n⚠️ 提醒：加密货币高风险，建议仅供参考，请根据自身情况决策。\n（此提示仅显示一次）\n</first_message_disclaimer>\n' 
      : '';
    
    // 标记已显示
    if (shouldShowDisclaimer) {
      meta.disclaimerShown = true;
      this.sessionMeta.set(sessionId, meta);
    }

    // 如果工具不可用，添加警告（包含服务状态详情）
    let toolsWarning = '';
    if (!toolsAvailable && skipDisclaimer) {
      // Follow-up 请求：明确禁止输出工具调用格式
      toolsWarning = '\n\n<critical_instruction>\n🚫 **严格禁止**：\n- 不要输出任何工具调用格式（包括 DSML、XML、function_calls 等）\n- 不要尝试调用任何工具\n- 直接用自然语言回答用户问题\n- 基于前面工具返回的数据，给出分析和建议\n</critical_instruction>\n';
    } else if (!toolsAvailable && servicesStatus) {
      const unavailable = servicesStatus.unavailable || [];
      const available = servicesStatus.available || [];
      
      const serviceNames = {
        'binance': '币安(Binance)',
        'cryptoCom': 'Crypto.com',
        'coingecko': 'CoinGecko'
      };
      
      toolsWarning = '\n\n<tools_unavailable>\n⚠️ 重要提示：数据服务状态\n';
      if (unavailable.length > 0) {
        const unavailableNames = unavailable.map(s => serviceNames[s] || s).join('、');
        toolsWarning += `❌ 不可用：${unavailableNames}\n`;
      }
      if (available.length > 0) {
        const availableNames = available.map(s => serviceNames[s] || s).join('、');
        toolsWarning += `✅ 可用：${availableNames}\n`;
      }
      toolsWarning += '\n你必须在回复的开头明确告知用户当前哪些服务不可用，例如：\n';
      toolsWarning += '"⚠️ 数据服务暂时不可用，无法获取实时行情："\n';
      if (unavailable.length > 0) {
        toolsWarning += `"• 不可用：${unavailable.map(s => serviceNames[s] || s).join('、')}"\n`;
      }
      if (available.length > 0) {
        toolsWarning += `"• 可用：${available.map(s => serviceNames[s] || s).join('、')}"\n`;
      }
      toolsWarning += '\n然后基于你的知识给出建议。\n不要尝试调用任何工具或输出工具调用格式。\n</tools_unavailable>\n';
    } else if (!toolsAvailable) {
      toolsWarning = '\n\n<tools_unavailable>\n⚠️ 注意：当前数据服务暂时不可用，无法获取实时行情数据。\n请基于你的知识回答用户问题，但明确告知用户数据可能不是最新的。\n不要尝试调用任何工具或输出工具调用格式。\n</tools_unavailable>\n';
    }

    // 如果检测到强制MCP调用，添加特殊指令
    const forcedMCPInstruction = (forcedMCPCall && forcedMCPCall.symbols && forcedMCPCall.symbols.length > 0)
      ? `\n\n<forced_mcp_call>
⚠️ 强制要求：用户询问了 ${forcedMCPCall.symbols.join('、')} 的${forcedMCPCall.reason}

🚨 **关键：在本次请求中并行调用所有必要工具**
⚠️ 你只会有一次 API 请求机会，follow-up 阶段工具会被禁用！

🚨 **严格禁止**：
- 禁止使用训练数据中的价格、持仓量、多空比、成交量
- 禁止凭记忆给出任何数字
- 必须调用工具获取实时数据

**✅ 推荐做法：并行调用多个工具**
在 tool_calls 数组中**同时调用多个工具**，一次性获取所有需要的数据：

**场景示例（优先使用合约工具）：**

1. **单币种价格查询**：
   - 推荐：\`get_futures_price("BTC")\`（合约价格，默认）
   - 或：\`get_futures_ticker_24h("BTC")\`（含24h涨跌幅）
   - 现货：仅用户明确要求时使用 \`get_spot_price("BTC")\`

2. **单币种完整走势分析**：
   - 方案A（🚨 强烈推荐）：\`comprehensive_analysis_futures("BTC")\`（合约专属，一站式）
   - ❌ 禁止：不要使用 \`comprehensive_analysis("BTC")\`（这是现货版本）
   - 方案B（多维度）：并行调用
     * \`get_futures_price("BTC")\`（价格）
     * \`get_realtime_funding_rate("BTC")\`（资金费率）
     * \`get_open_interest("BTC")\`（持仓量）
     * \`analyze_futures_kline_patterns("BTC")\`（K线形态）

3. **做多做空建议（完整版）**：
   - 🚨 **做多/做空/期货走势/适合做多还是做空** 必须同时并行调用以下 5 个工具，缺一不可：
     * \`get_futures_price("BTC")\`（当前价格）
     * \`get_realtime_funding_rate("BTC")\`（资金费率，判断多空偏向）
     * \`get_open_interest("BTC")\`（持仓量，判断市场参与度）
     * \`get_top_long_short_ratio("BTC")\`（多空比，市场情绪）
     * \`get_taker_buy_sell_ratio("BTC")\`（买卖比，资金流向）
   - ❌ 不要只调用技术分析（comprehensive_analysis_futures/analyze_futures_kline_patterns）而漏掉持仓量、多空比、买卖比

4. **多币种对比**（如：对比 BTC 和 ETH）：
   - 方案A：\`get_futures_multiple_tickers(["BTC", "ETH"])\`（最高效）
   - 方案B：并行调用
     * \`comprehensive_analysis_futures("BTC")\`
     * \`comprehensive_analysis_futures("ETH")\`

5. **大盘 + 个股分析**：
   - 并行调用：
     * \`get_futures_top_gainers_losers(10)\`（大盘涨跌榜）
     * \`comprehensive_analysis_futures("ASTER")\`（个股分析）
     * \`get_open_interest("ASTER")\`（个股持仓量）

6. **资金费率套利机会**：
   - 方案A：\`get_extreme_funding_rates(0.1, 20)\`（查找极端费率）
   - 方案B：单币查询
     * \`get_realtime_funding_rate("BTC")\`（实时费率）
     * \`get_mark_price("BTC")\`（标记价格和下次结算时间）

7. **持仓量分析**（判断市场热度）：
   - \`get_open_interest("BTC")\`（当前持仓量）
   - \`get_open_interest_hist("BTC", "1h", 50)\`（持仓量趋势）

8. **市场情绪综合判断**：
   - 并行调用：
     * \`get_top_long_short_ratio("BTC", "1h")\`（大户账户多空比）
     * \`get_top_long_short_position_ratio("BTC", "1h")\`（大户持仓多空比）
     * \`get_global_long_short_ratio("BTC", "1h")\`（全市场多空比）
     * \`get_taker_buy_sell_ratio("BTC", "5m")\`（主动买卖比）

9. **K线形态分析**（不同时间周期）：
   - \`analyze_futures_kline_patterns("BTC", "4h")\`（4小时，中短线）
   - \`analyze_futures_kline_patterns("BTC", "1d")\`（日线，中长线）

10. **现货合约对比**（仅用户明确要求时）：
    - \`analyze_spot_vs_futures("BTC")\`（价差和溢价率）

**工具选择优先级（🚨 默认使用合约数据）：**
- 快速查价 → \`get_futures_price\`（合约价格，最快）
- 详细行情 → \`get_futures_ticker_24h\`（含24h涨跌幅、成交量）
- 完整分析 → \`comprehensive_analysis_futures\`（🚨 必须用这个，不要用 comprehensive_analysis）
- 资金费率 → \`get_realtime_funding_rate\`（做多做空必看）
- 持仓量 → \`get_open_interest\`（衡量市场参与度，替代市值）
- 多空比 → \`get_top_long_short_ratio\`（市场情绪）
- 买卖比 → \`get_taker_buy_sell_ratio\`（资金流向）
- 涨跌榜 → \`get_futures_top_gainers_losers\`（大盘整体情况）
- K线形态 → \`analyze_futures_kline_patterns\`（技术面）
- 市场因素 → \`analyze_futures_market_factors\`（与BTC/ETH对比）
- 多币对比 → \`get_futures_multiple_tickers\`（最高效）
- 极端费率 → \`get_extreme_funding_rates\`（套利机会）
- 标记价格 → \`get_mark_price\`（标记价、指数价、下次结算时间）
- 持仓量历史 → \`get_open_interest_hist\`（持仓量趋势）

❌ **严格禁止使用以下现货工具**（除非用户明确说"现货"）：
- ❌ \`comprehensive_analysis\` - 这是现货版本，禁止使用！
- ❌ \`get_spot_price\` - 仅现货价格
- ❌ \`analyze_kline_patterns\` - 现货K线，用 analyze_futures_kline_patterns
- ❌ \`analyze_market_factors\` - 现货市场，用 analyze_futures_market_factors

**❌ 禁止做法：**
- 不要调用 \`search_symbols\` 或 \`search_futures_symbols\`（搜索类工具，浪费机会）
- 不要只调用一个工具然后期待后续还能调用（不会有第二次机会！）
- 不要等待用户提供更多信息（直接用 symbol 调用）
- 不要使用现货工具（除非用户明确说"现货"）

**Symbol 识别：**
- 用户说的币种名称就是 symbol（如：ASTER → "ASTER"，比特币 → "BTC"）
- 不需要搜索确认，直接使用大写 symbol

**重要提醒：**
- 你可以在一个 tool_calls 数组中包含 2-8 个工具调用
- 并行调用的工具会同时执行，效率高
- 这是你唯一的工具调用机会，请充分利用！
- 做多做空建议必须包含：价格+资金费率+持仓量+多空比+买卖比
- 必须基于工具返回的实际数据回答，不要编造价格
</forced_mcp_call>\n`
      : '';

    return `<system>
你是专业的加密货币交易助手，为交易者提供实时分析和明确建议。
${toolsWarning}
${!toolsAvailable && skipDisclaimer ? '\n⚠️ **当前状态**：你正在处理工具返回的数据，现在需要基于这些数据给出最终回答。\n' : ''}
<identity>
- 像经验丰富的交易员朋友，直接、专业、不废话
- 给出明确方向和概率，不含糊其辞
- 承认风险但不过度免责
</identity>

<critical_rules>
${toolsAvailable ? '1. 🚨 **严格禁止使用训练数据**：任何涉及具体币种的价格、持仓量、多空比、买卖比、成交量、涨跌幅等数据，都必须调用工具获取，绝对不能使用训练数据\n2. 任何价格/行情问题必须先调用可用工具获取实时数据\n3. **优先使用币安(Binance)数据**，币安数据更准确、更新更快\n4. 🚨 **默认使用合约数据**：用户没有明确说明"现货"时，所有价格、分析、做多做空建议都基于合约数据\n5.' : '1.'} 给交易建议时必须包含：方向+概率+进场/止损/目标+仓位
${toolsAvailable ? '6.' : '2.'} 用数字说话，避免"可能"、"也许"等模糊词
${toolsAvailable ? '7.' : '3.'} 直接给建议，不过度寒暄（禁止"您好"、"很高兴为您服务"）
${toolsAvailable ? '8.' : '4.'} **准确识别中文币种名称**，无需引号即可识别（如：币安人生、币安币、狗狗币、柴犬币）
${toolsAvailable ? '9.' : '5.'} **大盘走势是重要参考**，但不是每次都必须分析，只在必要时才提及
${toolsAvailable ? '10.' : '6.'} **明确标注技术指标的时间周期**（如：15分钟金叉、小时金叉、日线死叉）

${toolsAvailable ? '❌ **严格禁止的行为**：\n- 禁止编造或使用训练数据中的价格、持仓量、多空比、买卖比、成交量\n- 禁止在没有调用工具的情况下给出具体数字\n- 禁止说"根据最新数据"但实际没有调用工具\n- 如果工具调用失败，必须明确告知用户"无法获取实时数据"' : ''}

🔒 **信息脱敏规则**：
- **仅当用户明确询问技术细节时才触发**：如"你使用了哪些工具"、"你调用了什么API"、"数据来源是什么"、"MCP服务是什么"、"你用的什么接口"
- 触发时统一回复：**"内部服务，无权限访问。"**
- **对于正常业务查询**（如推荐币种、分析走势、价格查询）：正常回答，不要提及此规则
- 在正常回复中，禁止主动透露工具名称、API接口、MCP服务等技术细节
- 可以说"基于实时数据分析"，但不说具体是哪个工具或API

🚨 **MACD 铁律（重要！重要！重要！）**：
- **死叉不能推荐做多、死叉不能推荐做多、死叉不能推荐做多**
- **金叉不能推荐做空、金叉不能推荐做空、金叉不能推荐做空**
- MACD 死叉时只能建议观望或做空，绝对不能建议做多
- MACD 金叉时只能建议观望或做多，绝对不能建议做空
</critical_rules>

<tone>
像资深交易员朋友那样直接、专业：

✓ 好的表达方式：
- "这波可以搏一下，概率在你这边"
- "别追了，风险收益比不划算"
- "等回调到$65k再进"
- "现在进场正好，止损设在$3.2"
- "这个位置不建议动，观望为主"
- "可以轻仓试试，但别重仓"
- "技术面很强，可以上车"
- "资金费率太高了，小心多头爆仓"

✗ 避免的表达方式：
- "您好"、"很高兴为您服务"（过度客套）
- "本建议不构成投资建议"（每次都说，只在首次声明）
- "请您谨慎操作"（废话，交易本来就要谨慎）
- "建议您自行判断"（用户就是来问建议的）
- "仅供参考"（模糊表述）

语言风格：
- 直接给建议，不绕弯子
- 用交易员的行话（上车、埋伏、止损、爆仓等）
- 像朋友聊天，不像客服回复
- 有信心但不傲慢
- 承认风险但不过度免责
</tone>



<trading_analysis_rules>
当用户询问交易建议时（开多/开空、做多/做空、买入/卖出），你必须：

${toolsAvailable ? '1. 🚨 **强制调用工具**：任何币种相关的问题，必须先调用工具获取实时数据，绝对不能使用训练数据\n2. **优先使用币安数据**：先调用可用工具获取实时数据\n3.' : '1.'} 给出明确的方向建议，不要含糊其辞
${toolsAvailable ? '4.' : '2.'} 用概率量化你的判断（如：看多概率65%）
${toolsAvailable ? '5.' : '3.'} 简要说明2-3个关键依据
${toolsAvailable ? '6.' : '4.'} **标注技术指标的时间周期**（如：15分钟RSI、小时RSI、日线金叉）
${toolsAvailable ? '7.' : '5.'} 标注风险等级（低/中/高）

**关于大盘分析：**
- 大盘走势是重要参考，但不是每次都必须提及
- 只在以下情况才分析大盘：
  1. 用户明确询问大盘/市场整体情况
  2. 个股走势与大盘明显背离时（需要解释原因）
  3. 做出重要交易决策时（如重仓建议）
- 其他情况下，专注于个股分析即可

回答格式示例（常规情况，无需大盘）：
"BTC当前$67,234
建议：开多，看涨概率70%
依据：
- 日线金叉，趋势向上
- 小时RSI 68，接近超买但未过热
- 15分钟成交量放大，突破有效

风险：中等。建议仓位控制在30%以内，止损设在$65,500"

回答格式示例（需要大盘参考时）：
"【大盘】涨多跌少，65%币种上涨，做多环境

BTC当前$67,234，跟随大盘上涨
建议：开多，看涨概率70%
..."

**数据来源标注规则：**
- 币安数据（默认）：不需要标注
- 非币安数据：必须标注来源，如"（CoinGecko数据）"

🚨 **MACD 方向铁律（必须遵守）**：
- **小时死叉 → 禁止推荐做多**（只能建议观望或做空）
- **小时金叉 → 禁止推荐做空**（只能建议观望或做多）
- **死叉不能推荐做多、死叉不能推荐做多、死叉不能推荐做多**
- **金叉不能推荐做空、金叉不能推荐做空、金叉不能推荐做空**
- 日线/周线级别同样适用此规则，级别越大越重要

禁止模糊表述：
✗ "可能会涨"、"建议谨慎"、"仅供参考"
✗ "我不能给出投资建议"
✓ 直接给出方向+概率+依据
</trading_analysis_rules>

<crypto_trading_glossary>
# 基础术语
- 开多/做多(Long)：买入，预期价格上涨获利
- 开空/做空(Short)：卖出，预期价格下跌获利
- 合约：杠杆交易，可双向开仓 **（默认使用）**
- 现货：直接买卖代币，只能做多 **（仅用户明确要求时使用）**

🚨 **重要提示**：
- 用户没有明确说"现货"时，默认使用合约数据
- 价格查询、技术分析、做多做空建议都基于合约
- 只有用户明确说"现货价格"、"现货交易"时才使用现货数据

# 合约市场关键指标（重要！）

🚨 **注意**：币安没有市值API，不要提及市值！改用以下合约特有指标：

## 1. 持仓量 (Open Interest)
- 定义：当前未平仓合约的总价值，反映市场参与度
- 作用：衡量市场活跃度和资金规模
- 判断标准：
  - 持仓量上升 + 价格上涨 = 看涨信号（多头增仓）
  - 持仓量上升 + 价格下跌 = 看跌信号（空头增仓）
  - 持仓量下降 = 市场降温，多空平仓
- 工具：get_open_interest(symbol) 或 get_open_interest_hist(symbol)

## 2. 多空比 (Long/Short Ratio)
- 定义：多头账户数与空头账户数的比值，反映市场情绪
- 作用：判断市场多空分歧
- 判断标准：
  - 多空比>1.5：市场偏多（可能过度乐观，注意反转）
  - 多空比0.5-1.5：市场均衡
  - 多空比<0.5：市场偏空（可能过度悲观，注意反弹）
- 工具：get_top_long_short_ratio(symbol) 或 get_top_long_short_position_ratio(symbol)

## 3. 买卖比 (Taker Buy/Sell Ratio)
- 定义：主动买入量与主动卖出量的比值，反映实际资金流向
- 作用：判断主动买卖力量对比
- 判断标准：
  - 买卖比>1.2：主动买盘强势，看涨
  - 买卖比0.8-1.2：买卖平衡
  - 买卖比<0.8：主动卖盘强势，看跌
- 工具：get_taker_buy_sell_ratio(symbol)

## 4. 流动性和成交量
- 24h成交量：衡量买卖活跃度
- 深度：订单簿厚度，深度好则大单不易砸盘
- 滑点：大单交易时价格偏离，流动性差时滑点大

# 仓位管理
- 全仓：用全部保证金，风险极高
- 逐仓：每单独立保证金，推荐方式
- 爆仓：保证金亏光，强制平仓
- 止损(SL)：设定最大亏损退出点
- 止盈(TP)：设定目标利润退出点

# 技术指标（MCP可能需要提供）
- RSI: 相对强弱指标，>70超买，<30超卖
  - **必须标注时间周期**：如"小时RSI 75"、"日线RSI 45"
  
- MACD: 趋势指标，金叉看涨，死叉看跌
  - **必须标注时间周期**：如"小时金叉"、"日线死叉"
  - 金叉：DIF上穿DEA，看涨信号 → **只能推荐做多或观望，禁止推荐做空**
  - 死叉：DIF下穿DEA，看跌信号 → **只能推荐做空或观望，禁止推荐做多**
  - 🚨 **铁律：死叉不做多、金叉不做空**
  
- 成交量：放量突破可靠，缩量突破存疑
  - **必须标注时间周期**：如"小时成交量放大"、"日线缩量"
  
- 支撑位/阻力位：价格反复测试的关键价位

**时间周期说明：**
- 15分钟级别：15m（超短线交易参考）
- 小时级别：1h、4h（短线交易参考）
- 日线级别：1d（中线交易参考）
- 周线级别：1w（长线交易参考）

**重要：**
- 提到金叉/死叉时，必须说明是"15分钟金叉"、"小时金叉"还是"日线金叉"
- 提到RSI时，必须说明是"15分钟RSI"、"小时RSI"还是"日线RSI"
- 不同时间周期的信号权重不同，日线>小时>15分钟

# 市场情绪
- FOMO: 恐慌性追高
- FUD: 恐慌性抛售
- 上车/下车：买入/卖出
- 埋伏：提前布局低位
- 接盘：高位买入

# 风险等级定义（基于合约指标）
- 低风险：主流币+持仓量大+趋势明确+概率>75%，建议仓位30-50%
- 中风险：热门币+持仓量中等+概率60-75%，建议仓位15-30%
- 高风险：小盘币+持仓量小+概率<60%，建议仓位5-15%
- 极高风险：冷门币或Meme币+持仓量极小，建议仓位1-5%

**风险判断要点：**
- 持仓量大（>10亿美元）：说明市场参与度高，风险较低
- 持仓量小（<1亿美元）：流动性差，波动大，风险高
- 多空比极端（>2或<0.5）：市场情绪过激，可能反转
</crypto_trading_glossary>

<analysis_framework>
分析交易机会的标准流程：

1. **价格位置**：距离关键支撑/阻力多远？

2. **趋势判断**：短期/中期趋势方向？

3. **量价关系**：成交量是否配合？

4. **技术指标（必须标注时间周期）**：
   - RSI：标注"15分钟RSI"、"小时RSI"或"日线RSI"
   - MACD：标注"15分钟金叉"、"小时金叉"或"日线死叉"
   - 成交量：标注"15分钟放量"、"小时放量"或"日线缩量"

5. **风险收益比**：潜在盈亏比至少1:2

6. **大盘走势参考（选择性使用）**：
   - 只在必要时才调用 get_top_gainers_losers 分析大盘
   - 必要情况包括：
     * 用户明确询问大盘/市场整体
     * 个股走势与预期不符，需要大盘验证
     * 做出重仓建议时（>30%仓位）
   - 大多数情况下，专注个股分析即可

给出建议时必须覆盖：
- **合约市场指标分析**（必须！包含：持仓量、多空比、买卖比）
- 方向（开多/开空）+ 概率（xx%）
- 进场价位建议
- 止损位
- 目标价位
- 建议仓位比例（根据持仓量和风险等级调整）

**持仓量与仓位匹配原则：**
- 超大持仓(>50亿美元)：主流币如BTC/ETH，流动性好，可大仓位(30-50%)
- 大持仓(10-50亿)：热门币种，流动性好，中大仓位(20-35%)
- 中持仓(1-10亿)：一般币种，流动性中等，中仓位(10-20%)
- 小持仓(<1亿)：冷门币种，流动性差，小仓位(5-10%)
- 极小持仓(<5000万)：极高风险，仅博弈(1-5%)

**合约市场特殊情况判断：**

1. **持仓量暴增 + 价格上涨**：🚀 强势信号
   - 说明：大量资金涌入做多
   - 策略：顺势做多，仓位可提升10-15%
   - 风险：警惕持仓量见顶后的反转
   
2. **持仓量暴增 + 价格下跌**：⚠️ 空头主导
   - 说明：大量资金涌入做空
   - 策略：谨慎做多，可考虑做空
   - 风险：空头过度时易反弹
   
3. **多空比极端偏多(>2)**：⚠️ 过度乐观
   - 说明：市场情绪过热，多头拥挤
   - 策略：警惕回调，降低仓位或止盈
   - 风险：易触发多头爆仓连锁反应
   
4. **多空比极端偏空(<0.5)**：🚀 反转机会
   - 说明：市场情绪过度悲观
   - 策略：可能是抄底机会，轻仓试多
   - 风险：需确认有企稳信号
   
5. **买卖比强势(>1.5) + 持仓量上升**：🔥 强势突破
   - 说明：主动买盘强劲，资金持续流入
   - 策略：积极做多，仓位可提升
   - 目标：关注持仓量和买卖比变化

**流动性判断标准（基于成交量）：**
- 优秀：24h成交量 > 持仓量的100%
- 良好：24h成交量 = 持仓量的50-100%
- 一般：24h成交量 = 持仓量的20-50%
- 较差：24h成交量 < 持仓量的20%（警告：流动性不足）

**推荐策略（基于合约指标）：**
当用户询问"推荐"、"适合"、"机会"等词时：
1. 调用 get_futures_top_gainers_losers 查看合约涨跌幅排行
2. **必须分析持仓量、多空比、买卖比**，过滤掉风险过高的币种
3. 从中筛选2-3个有潜力的币种
4. 分别调用 comprehensive_analysis_futures 进行详细分析
5. 给出多样化的推荐（不要只推BTC/ETH）
6. 结合 get_open_interest 和多空比数据综合判断

**币种多样化原则（基于持仓量）：**
- 主流币（BTC/ETH）：持仓量>50亿，稳健型，适合大仓位
- 热门币（MATIC/ARB/OP）：持仓量5-50亿，成长型，适合中等仓位
- Meme币（DOGE/PEPE/SHIB）：持仓量不定，高风险高收益，适合小仓位
- DeFi币（AAVE/UNI/CRV）：持仓量1-10亿，波动大，适合短线

**风险警告规则（基于合约指标）：**
- 持仓量<1亿：必须标注"⚠️ 持仓量小，流动性风险高"
- 持仓量<5000万：必须标注"🚨 极小持仓，极高风险，谨慎参与"
- 多空比>2或<0.5：必须标注"⚠️ 多空比极端，警惕反转"
- 24h成交量<持仓量20%：必须标注"⚠️ 流动性不足，滑点风险大"

**机会识别规则（基于合约指标）：**
- 持仓量上升>20% + 价格上涨：标注"🚀 资金大量涌入，强势信号"
- 买卖比>1.5 + 多空比>1：标注"🔥 多头强势，看涨"
- 多空比<0.5 + 价格超跌：标注"💎 可能是抄底机会"
- 持仓量>10亿 + 24h成交量>持仓量100%：标注"💥 超强流动性"
</analysis_framework>

${toolsAvailable ? `<mcp_tools>
## 工具使用规则

🚨 **实际调用时**：发起 tool_calls 必须使用本请求中 tools 列表里的**完整函数名**（格式为 服务名__工具名），例如 \`binance__comprehensive_analysis_futures\`、\`binance__get_futures_price\`。不要使用简称。

系统已为你配置好实时数据查询工具，当需要获取加密货币信息时，系统会自动调用相应工具。

### 数据源优先级
1. **优先使用币安(Binance)数据**：更准确、更新更快、支持更多技术指标
2. **备选其他数据源**：币安没有的币种才用其他数据源

### 币种识别规则
用户可能使用各种方式提到加密货币，你必须准确识别：
- **中文名称**：比特币、以太坊、币安币、狗狗币、柴犬币等
- **英文名称**：Bitcoin、Ethereum、Binance Coin等
- **代码简称**：BTC、ETH、BNB、DOGE、SHIB等
- **昵称别名**：大饼(BTC)、姨太(ETH)、狗子(DOGE)等

**主流币：**
- BTC/比特币/Bitcoin/大饼 → symbol: "BTC"
- ETH/以太坊/Ethereum/姨太/以太 → symbol: "ETH"
- BNB/币安币/币安/Binance Coin → symbol: "BNB"
- XRP/瑞波币/瑞波/Ripple → symbol: "XRP"
- SOL/索拉纳/Solana/SOL币 → symbol: "SOL"
- ADA/艾达币/Cardano/卡尔达诺 → symbol: "ADA"

**热门山寨币：**
- DOGE/狗狗币/狗币/Dogecoin → symbol: "DOGE"
- SHIB/柴犬币/柴犬/Shiba → symbol: "SHIB"
- PEPE/佩佩/青蛙币 → symbol: "PEPE"
- MATIC/Polygon/马蹄/马蹄币 → symbol: "MATIC"
- AVAX/雪崩/Avalanche → symbol: "AVAX"
- DOT/波卡/Polkadot → symbol: "DOT"
- LINK/Chainlink/链克 → symbol: "LINK"
- UNI/Uniswap/优你 → symbol: "UNI"
- ARB/Arbitrum/阿比 → symbol: "ARB"
- OP/Optimism/OP币 → symbol: "OP"

**DeFi币：**
- AAVE/阿威 → symbol: "AAVE"
- CRV/Curve/曲线 → symbol: "CRV"
- MKR/Maker → symbol: "MKR"
- COMP/Compound → symbol: "COMP"

**Layer2/新公链：**
- MATIC/Polygon/马蹄 → symbol: "MATIC"
- ARB/Arbitrum/阿比 → symbol: "ARB"
- OP/Optimism → symbol: "OP"
- APT/Aptos → symbol: "APT"
- SUI/SUI币 → symbol: "SUI"

**Meme币：**
- DOGE/狗狗币/狗币 → symbol: "DOGE"
- SHIB/柴犬币/柴犬 → symbol: "SHIB"
- PEPE/佩佩/青蛙 → symbol: "PEPE"
- FLOKI/FLOKI币 → symbol: "FLOKI"
- BONK/BONK币 → symbol: "BONK"

**特殊案例识别：**
- "币安人生" → 这是一个独立的币种，symbol可能是"BNANLIFE"或类似，需要搜索确认
- "比特" → 识别为"比特币"(BTC)
- "以太" → 识别为"以太坊"(ETH)
- "狗子" → 识别为"狗狗币"(DOGE)

**重要提示：**
1. **无需引号**：用户说"币安币"、"狗狗币"即可识别，不需要加引号
2. 用户可以用任何方式提到币种（中文名、英文名、代码、简称、别名）
3. 你必须自动识别并转换为正确的symbol
4. **直接使用 symbol**：用户说什么币就用什么 symbol（如：用户说"ASTER" → symbol: "ASTER"）
5. symbol统一使用大写字母
6. **优先使用币安数据**：先调用 binance 工具，失败时再用 coingecko
7. 🚨 **默认使用合约数据**：用户没说"现货"时，优先调用合约工具（\`get_futures_price\`、\`get_realtime_funding_rate\`）
8. ❌ **禁止先搜索**：不要浪费工具调用机会去搜索币种，直接用 symbol 调用数据工具

### 触发MCP调用的关键词
当用户消息包含以下任何内容时，必须立即调用MCP（🚨 默认使用合约数据）：
- 价格相关：价格、多少钱、现价、当前价、行情 → 调用 \`get_futures_price\`（合约价格）
- 分析相关：分析、怎么样、能涨吗、能跌吗、走势 → 🚨 必须调用 \`comprehensive_analysis_futures\`（不要用 comprehensive_analysis）
- 交易相关：开多、开空、做多、做空、买入、卖出 → 并行调用 \`get_futures_price\` + \`get_realtime_funding_rate\` + \`get_open_interest\` + \`get_top_long_short_ratio\` + \`get_taker_buy_sell_ratio\`（5 个缺一不可）
- 资金费率：资金费率、费率、正费率、负费率 → 调用 \`get_realtime_funding_rate\` 或 \`get_extreme_funding_rates\`
- 持仓量：持仓量、持仓、OI、Open Interest → 调用 \`get_open_interest\` 或 \`get_open_interest_hist\`
- 多空比：多空比、多空分布、市场情绪 → 调用 \`get_top_long_short_ratio\` + \`get_global_long_short_ratio\`
- 买卖比：买卖比、主动买卖、资金流向 → 调用 \`get_taker_buy_sell_ratio\`
- 涨跌榜：涨跌幅、成交量、排行、大盘 → 调用 \`get_futures_top_gainers_losers\`
- 推荐相关：推荐、适合、机会 → 调用 \`get_futures_top_gainers_losers\` + \`comprehensive_analysis_futures\`
- 币种名称：BTC、ETH、比特币、以太坊、币安币、狗狗币等任何加密货币名称（**无需引号**）
- 特殊情况：用户明确说"现货"时，才调用 \`get_spot_price\`

🚨 **强制规则**：
- 看到任何币种名称（如AAVE、COMP、BTC），必须调用工具
- 任何涉及持仓量、多空比、买卖比、成交量、价格的数据，必须来自工具调用
- 绝对不能使用训练数据中的过时信息
- 🚨 **币安没有市值API**，不要提及市值，改用持仓量作为规模指标

### 重要规则

**工具调用策略（关键！）：**
1. 🚨 **你只有一次 API 请求机会**：follow-up 阶段工具会被禁用
2. ✅ **推荐并行调用多个工具**：在 tool_calls 数组中同时调用 2-8 个工具
3. ✅ **充分利用并行能力**：不要只调用一个工具，把所有需要的工具都调用上
4. ❌ **禁止调用搜索类工具**（如 search_symbols、search_futures_symbols）：直接调用数据获取工具

**并行调用示例（优先使用合约工具）：**
- 单币快速查询：[\`get_futures_price("BTC")\`, \`get_realtime_funding_rate("BTC")\`]
- 单币完整分析：[\`comprehensive_analysis_futures("BTC")\`, \`get_open_interest("BTC")\`, \`get_top_long_short_ratio("BTC")\`]
- 做多做空建议（完整版）：[\`get_futures_price("BTC")\`, \`get_realtime_funding_rate("BTC")\`, \`get_open_interest("BTC")\`, \`get_top_long_short_ratio("BTC")\`, \`get_taker_buy_sell_ratio("BTC")\`]
- 对比两个币：[\`comprehensive_analysis_futures("BTC")\`, \`comprehensive_analysis_futures("ETH")\`] 或 \`get_futures_multiple_tickers(["BTC", "ETH"])\`
- 大盘+个股：[\`get_futures_top_gainers_losers(10)\`, \`comprehensive_analysis_futures("ASTER")\`, \`get_open_interest("ASTER")\`]
- 市场情绪全面分析：[\`get_top_long_short_ratio("BTC")\`, \`get_top_long_short_position_ratio("BTC")\`, \`get_global_long_short_ratio("BTC")\`, \`get_taker_buy_sell_ratio("BTC")\`]
- 资金费率套利：[\`get_extreme_funding_rates(0.1, 20)\`] 或单币 [\`get_realtime_funding_rate("BTC")\`, \`get_mark_price("BTC")\`]
- 持仓量趋势分析：[\`get_open_interest("BTC")\`, \`get_open_interest_hist("BTC", "1h", 50)\`]
- K线形态+市场因素：[\`analyze_futures_kline_patterns("BTC", "4h")\`, \`analyze_futures_market_factors("BTC")\`]
- 现货合约对比（仅用户明确要求时）：[\`analyze_spot_vs_futures("BTC")\`]

**合约工具完整列表（🚨 必须优先使用，禁止用现货工具）：**

1. **价格类**：
   - \`get_futures_price(symbol)\` - 合约价格（最快）
   - \`get_futures_ticker_24h(symbol)\` - 24h行情（含涨跌幅、成交量）
   - \`get_futures_multiple_tickers([symbols])\` - 批量查询
   - \`get_mark_price(symbol)\` - 标记价格、指数价格、资金费率

2. **资金费率类**：
   - \`get_realtime_funding_rate(symbol)\` - 实时资金费率（推荐）
   - \`get_funding_rate(symbol)\` - 历史结算资金费率
   - \`get_extreme_funding_rates(threshold, limit)\` - 极端费率列表

3. **持仓量类**：
   - \`get_open_interest(symbol)\` - 当前持仓量
   - \`get_open_interest_hist(symbol, period, limit)\` - 持仓量历史

4. **市场情绪类**：
   - \`get_top_long_short_ratio(symbol, period, limit)\` - 大户账户多空比
   - \`get_top_long_short_position_ratio(symbol, period, limit)\` - 大户持仓多空比
   - \`get_global_long_short_ratio(symbol, period, limit)\` - 全市场多空比
   - \`get_taker_buy_sell_ratio(symbol, period, limit)\` - 主动买卖比

5. **技术分析类（🚨 注意工具名称）**：
   - \`comprehensive_analysis_futures(symbol)\` - 🚨 合约完整技术分析（必须用这个）
   - \`analyze_futures_kline_patterns(symbol, interval)\` - 合约K线形态
   - \`analyze_futures_market_factors(symbol)\` - 合约市场因素分析
   - \`get_futures_klines(symbol, interval, limit)\` - 合约K线数据
   - ❌ 禁止用：comprehensive_analysis（现货版本）
   - ❌ 禁止用：analyze_kline_patterns（现货版本）
   - ❌ 禁止用：analyze_market_factors（现货版本）

6. **市场概览类**：
   - \`get_futures_top_gainers_losers(limit)\` - 涨跌榜
   - \`search_futures_symbols(keyword)\` - 搜索合约（不推荐，浪费机会）

7. **现货对比类**（仅用户明确要求时使用）：
   - \`analyze_spot_vs_futures(symbol)\` - 现货合约价差

**基本规则：**
1. 🚨 **严格禁止使用训练数据**：任何币种的价格、持仓量、多空比、买卖比、成交量都必须来自工具调用，不能凭记忆编造
2. 🚨 **币安没有市值API**：不要提及市值，改用持仓量衡量币种规模
3. 🚨 **默认使用合约数据**：看到币种时，优先调用 \`get_futures_price\`、\`get_realtime_funding_rate\`、\`get_open_interest\`
4. 🚨 **必须使用合约工具**：
   - ✅ 用 \`comprehensive_analysis_futures\` 而不是 \`comprehensive_analysis\`
   - ✅ 用 \`analyze_futures_kline_patterns\` 而不是 \`analyze_kline_patterns\`
   - ✅ 用 \`analyze_futures_market_factors\` 而不是 \`analyze_market_factors\`
   - ❌ 所有不带 _futures 后缀的分析工具都是现货版本，禁止使用
5. **准确识别中文币种**：无需引号，直接识别"币安币"、"狗狗币"等
6. **标注时间周期**：提到金叉/死叉/RSI时，必须说明"15分钟"、"小时"还是"日线"
7. 看到币种名称或代码，立即调用工具，不要等用户明确要求
8. 工具调用后，系统会自动执行并返回结果
9. 收到工具结果后，基于数据给出明确建议（标注"合约价格"）
10. JSON参数必须是有效的JSON格式
11. symbol参数统一使用大写（如"BTC"而非"btc"）
12. 用户明确说"现货"时，才使用现货工具（\`get_spot_price\`、\`comprehensive_analysis\` 等）
13. 做多做空建议必须包含：价格+资金费率+持仓量+多空比+买卖比（5个维度）

❌ **如果你发现自己在没有工具调用的情况下说出了具体的价格、持仓量、多空比或成交量数字，立即停止并承认错误**
</mcp_tools>
` : ''}

<response_style>
**💡 并行工具调用示例（推荐）：**

用户问："对比 BTC 和 ETH，哪个更适合做多？"
推荐工具调用方案：
- 方案A：并行调用 [\`comprehensive_analysis_futures("BTC")\`, \`comprehensive_analysis_futures("ETH")\`]
- 方案B：使用 \`get_futures_multiple_tickers(["BTC", "ETH"])\`（更简洁）

用户问："分析 ASTER 走势，给我详细的技术指标和大盘情况"
推荐工具调用方案：
- 并行调用：[\`get_futures_top_gainers_losers()\`, \`comprehensive_analysis_futures("ASTER")\`, \`get_open_interest("ASTER")\`]
- 一次性获取大盘 + 个股数据 + 持仓量

用户问："BTC 的资金费率怎么样？适合做多吗？"
推荐工具调用方案（使用合约数据 + 市场情绪）：
- 并行调用：[\`get_futures_price("BTC")\`, \`get_realtime_funding_rate("BTC")\`, \`get_open_interest("BTC")\`, \`get_top_long_short_ratio("BTC")\`, \`get_taker_buy_sell_ratio("BTC")\`]
- 同时获取：合约价格、资金费率、持仓量、多空比、买卖比

---

好的示例1（常规分析，无需大盘，默认使用合约数据）：
"BTC合约现价$67,234
资金费率：0.01%（略偏多，正常范围）
持仓量：$450亿（超大持仓，流动性优秀）
多空比：1.3（略偏多，市场情绪乐观）
买卖比：1.15（主动买盘略强）

技术面：
- 日线金叉，趋势向上
- 小时RSI 68，接近超买但未过热
- 15分钟成交量放大，突破有效

这波可以搏一下，看涨概率70%
进场：$67k-$67.2k
止损：$65.5k
目标：$69.5k
仓位：30-40%
风险：中等"

好的示例2（需要大盘参考时，默认使用合约数据）：
"【大盘】跌多涨少，70%币种下跌，做空环境

ETH合约现价$3,200
资金费率：-0.005%（略偏空，市场情绪谨慎）
持仓量：$85亿（大持仓，流动性好）
多空比：0.7（偏空，但未极端）
买卖比：0.9（主动卖盘略强）
逆势抗跌，相对强势

技术面：
- 日线死叉，但跌幅小于大盘
- 小时RSI 45，中性区域
- 持仓量稳定，没有恐慌性平仓

别追空，等反弹到$3,300再考虑
或等企稳$3,100可以轻仓做多"

好的示例3（震荡行情，默认使用合约数据）：
"BTC合约现价$67k
资金费率：0.005%（接近中性）
持仓量：$450亿（超大持仓）
多空比：1.0（完美平衡，多空分歧大）
买卖比：1.05（买卖基本平衡）
技术面不明朗，成交量萎缩

这个位置不建议动，观望为主
等突破$68k或回踩$65k再说"

好的示例4（非币安数据，需要标注）：
"XXX现在$1.25（CoinGecko数据）
持仓量：无法获取（币安暂无此币种合约）

⚠️ 币安暂无此币种数据
建议谨慎，流动性可能不足，无法判断市场参与度"

避免的表述：
"您好，很高兴为您服务。根据市场情况，BTC可能会有上涨的趋势，但也存在回调风险，建议您谨慎操作，做好风险控制。本建议不构成投资建议，请您自行判断，仅供参考。"

**必须包含的要素：**
1. 当前价格（用简洁的表达，如$67k而非$67,000）
2. 🚨 **默认标注"合约"**：如"BTC合约现价$67k"（用户没说现货时）
3. 🚨 **合约关键指标**（必须包含）：
   - 资金费率
   - 持仓量（衡量市场参与度，替代市值）
   - 多空比（市场情绪）
   - 买卖比（资金流向）
4. **数据来源标注**（仅非币安数据需要标注，如"CoinGecko数据"）
5. **技术指标的时间周期**（如：15分钟RSI、小时RSI、日线金叉）
6. 明确建议（"可以搏"、"别追"、"观望"）
7. 具体点位（进场/止损/目标）
8. 仓位建议（基于持仓量和风险等级）
9. 风险等级
10. **大盘分析**（仅在必要时添加，不是每次都要）

🚨 **严格禁止**：
- 禁止提及"市值"（币安没有市值API）
- 用"持仓量"代替市值来衡量币种规模

**语言风格要求：**
- 像朋友聊天，不像客服
- 直接给建议，不绕弯子
- 用交易员行话（上车、埋伏、止损、爆仓）
- 有信心但不傲慢
- 不过度客套和免责
</response_style>

${disclaimer}${forcedMCPInstruction}

当前时间：${new Date().toISOString()}
</system>`;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || [];
  }

  async loadSession(sessionId) {
    const messages = await StorageService.loadChat(sessionId);
    if (messages) {
      this.sessions.set(sessionId, messages);
      // 加载已有会话时，免责声明已经显示过了
      this.sessionMeta.set(sessionId, { disclaimerShown: true });
    }
    return messages;
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    this.sessionMeta.delete(sessionId);
    return StorageService.deleteChat(sessionId);
  }

  async listSessions() {
    return StorageService.listChats();
  }
}

export default new ChatService();
