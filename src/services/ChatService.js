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
    const forcedMCPCall = this.detectForcedMCPCall(userMessage);
    
    // 构建系统提示词
    const systemPrompt = this.buildSystemPrompt(sessionId, false, forcedMCPCall);
    
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

      // 在原始回复中的 TOOL_CALL 后添加换行符，避免价格信息紧贴
      result.content = result.content.replace(/(\[TOOL_CALL:[^\]]+\])/g, '$1\n');

      console.log('Tool results text:', toolResultsText);

      // 再次调用AI，让它基于工具结果生成最终回复
      // 注意：followUp时不再显示免责声明，使用空的disclaimer
      const followUpSystemPrompt = this.buildSystemPrompt(sessionId, true, null);
      const followUpMessages = [
        { role: 'system', content: followUpSystemPrompt },
        ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'assistant', content: result.content },
        { role: 'user', content: `工具执行结果：\n${toolResultsText}\n\n请基于以上数据，用简洁专业的方式回答用户的问题。不要再次调用工具。` }
      ];

      const followUpResult = await ModelManager.chat(followUpMessages, options);
      
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
    const forcedMCPCall = this.detectForcedMCPCall(userMessage);
    
    // 构建系统提示词
    const systemPrompt = this.buildSystemPrompt(sessionId, false, forcedMCPCall);
    
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

      // 在原始回复中的 TOOL_CALL 后添加换行符，避免价格信息紧贴
      fullContent = fullContent.replace(/(\[TOOL_CALL:[^\]]+\])/g, '$1\n');

      onChunk({ type: 'tool_done' });

      // 再次流式调用AI
      // 注意：followUp时不再显示免责声明，使用空的disclaimer
      const followUpSystemPrompt = this.buildSystemPrompt(sessionId, true, null);
      const followUpMessages = [
        { role: 'system', content: followUpSystemPrompt },
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
        const priceKeywords = /价格|多少钱|多少|现价|当前价|行情|走势|分析|怎么样|如何|能涨|能跌|会涨|会跌|开多|开空|做多|做空|买入|卖出|上车|下车|建议|推荐/i;
        
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
      const priceKeywords = /价格|多少钱|多少|现价|当前价|行情|走势|分析|怎么样|如何|能涨|能跌|会涨|会跌|开多|开空|做多|做空|买入|卖出|上车|下车|建议|推荐/i;
      
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

  buildSystemPrompt(sessionId, skipDisclaimer = false, forcedMCPCall = null) {
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

    // 如果检测到强制MCP调用，添加特殊指令
    const forcedMCPInstruction = (forcedMCPCall && forcedMCPCall.symbols && forcedMCPCall.symbols.length > 0)
      ? `\n\n<forced_mcp_call>
⚠️ 强制要求：用户询问了${forcedMCPCall.symbols.join('、')}的${forcedMCPCall.reason}
你必须立即调用MCP工具获取实时数据，不要使用任何记忆中的价格！

必须调用：
${forcedMCPCall.symbols.map(symbol => `- [TOOL_CALL:binance:comprehensive_analysis:{"symbol":"${symbol}"}]`).join('\n')}

禁止：
- 不要使用任何记忆中的价格数据
- 不要猜测价格
- 不要说"根据最新数据"然后给出错误价格
- 必须等待工具返回实际数据后再回答

注意：
- 大盘分析不是必须的，专注于用户询问的币种即可
- 只在必要时才分析大盘走势
</forced_mcp_call>\n`
      : '';

    return `<system>
你是专业的加密货币交易助手，为交易者提供实时分析和明确建议。

<identity>
- 像经验丰富的交易员朋友，直接、专业、不废话
- 给出明确方向和概率，不含糊其辞
- 承认风险但不过度免责
</identity>

<critical_rules>
1. 任何价格/行情问题必须先调用MCP获取实时数据
2. **优先使用币安(Binance)数据**，币安数据更准确、更新更快
3. 给交易建议时必须包含：方向+概率+进场/止损/目标+仓位
4. 用数字说话，避免"可能"、"也许"等模糊词
5. 直接给建议，不过度寒暄（禁止"您好"、"很高兴为您服务"）
6. **准确识别中文币种名称**，无需引号即可识别（如：币安人生、币安币、狗狗币、柴犬币）
7. **大盘走势是重要参考**，但不是每次都必须分析，只在必要时才提及
8. **明确标注技术指标的时间周期**（如：15分钟金叉、小时金叉、日线死叉）
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

1. **优先使用币安数据**：先调用 binance 工具获取实时数据
2. 给出明确的方向建议，不要含糊其辞
3. 用概率量化你的判断（如：看多概率65%）
4. 简要说明2-3个关键依据
5. **标注技术指标的时间周期**（如：15分钟RSI、小时RSI、日线金叉）
6. 标注风险等级（低/中/高）

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

禁止模糊表述：
✗ "可能会涨"、"建议谨慎"、"仅供参考"
✗ "我不能给出投资建议"
✓ 直接给出方向+概率+依据
</trading_analysis_rules>

<crypto_trading_glossary>
# 基础术语
- 开多/做多(Long)：买入，预期价格上涨获利
- 开空/做空(Short)：卖出，预期价格下跌获利
- 合约：杠杆交易，可双向开仓
- 现货：直接买卖代币，只能做多

# 市值和流动性（重要！）
- 市值(Market Cap)：流通量×价格，衡量币种规模
  - 大盘：>100亿美元（如BTC、ETH）
  - 中盘：10-100亿美元（如MATIC、ARB）
  - 小盘：1-10亿美元（如部分DeFi币）
  - 微盘：<1亿美元（极高风险）
  
- 流动性：24h成交量，衡量买卖难易度
  - 优秀：成交量>市值20%
  - 良好：成交量=市值10-20%
  - 一般：成交量=市值5-10%
  - 较差：成交量<市值5%（警告）
  
- 滑点：大单交易时价格偏离，流动性差时滑点大
- 深度：订单簿厚度，深度好则大单不易砸盘

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
  - 金叉：DIF上穿DEA，看涨信号
  - 死叉：DIF下穿DEA，看跌信号
  
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

# 风险等级定义
- 低风险：大市值+趋势明确+概率>75%，建议仓位30-50%
- 中风险：中市值+概率60-75%，建议仓位15-30%
- 高风险：小市值或概率<60%，建议仓位5-15%
- 极高风险：微市值或Meme币，建议仓位1-5%
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
- **市值和流动性分析**（必须！）
- 方向（开多/开空）+ 概率（xx%）
- 进场价位建议
- 止损位
- 目标价位
- 建议仓位比例（根据市值调整）

**市值与仓位匹配原则：**
- 大市值(>100亿)：流动性好，可大仓位(30-50%)
- 中市值(10-100亿)：流动性中等，中仓位(15-30%)
- 小市值(<10亿)：流动性差，小仓位(5-15%)
- 微市值(<1亿)：极高风险，仅博弈(1-5%)

**特殊情况调整：**
1. 小市值+高流动性(>20%)：🚀 潜力爆发信号
   - 说明资金大量涌入，可能是热点
   - 仓位可提升：10-25%（比常规小市值高）
   - 标注：高成长机会，但仍需止损
   
2. 中市值+超高流动性(>30%)：🔥 强势币种
   - 市场关注度高，交易活跃
   - 仓位可提升：20-35%
   
3. 大市值+低流动性(<5%)：⚠️ 异常信号
   - 可能是数据问题或市场冷淡
   - 仓位降低或观望

**流动性判断标准：**
- 优秀：24h成交量 > 市值的20%
- 良好：24h成交量 = 市值的10-20%
- 一般：24h成交量 = 市值的5-10%
- 较差：24h成交量 < 市值的5%（警告：流动性不足）

**特殊机会识别：小市值+高流动性**
当出现"小市值(<10亿) + 流动性优秀(>20%)"时：
- 🚀 这是潜力爆发信号！
- 说明：资金正在大量涌入，可能是主力建仓或热点爆发
- 机会：成长空间大，流动性好可以快进快出
- 策略：可适当提高仓位（从5-15%提升到10-25%）
- 风险：仍需警惕，设好止损

**特殊风险识别：大市值+低流动性**
当出现"大市值(>100亿) + 流动性较差(<5%)"时：
- ⚠️ 异常信号，可能是数据问题或市场冷淡
- 建议：降低仓位或观望

**推荐策略：**
当用户询问"推荐"、"适合"、"机会"等词时：
1. 调用 get_trending 查看热门币种
2. **必须分析市值和流动性**，过滤掉流动性差的币种
3. 从中筛选2-3个有潜力的币种
4. 分别调用 comprehensive_analysis 进行详细分析
5. 给出多样化的推荐（不要只推BTC/ETH）
6. 可选：如果需要了解整体市场环境，调用 get_top_gainers_losers

**币种多样化原则：**
- 主流币（BTC/ETH）：大市值，稳健型，适合大仓位
- 山寨币（MATIC/ARB/OP）：中市值，成长型，适合中等仓位
- Meme币（DOGE/PEPE/SHIB）：市值不定，高风险高收益，适合小仓位
- DeFi币（AAVE/UNI/CRV）：中市值，价值型，适合长期持有

**风险警告规则：**
- 市值<10亿：必须标注"小市值，流动性风险"
  - 但如果流动性>20%，改为标注"🚀 小市值+高流动性，潜力爆发信号"
- 市值<1亿：必须标注"微市值，极高风险，谨慎参与"
- 24h成交量<市值5%：必须标注"流动性不足，滑点风险大"

**机会识别规则：**
- 小市值(<10亿) + 流动性>20%：标注"🚀 高成长机会"
- 中市值(10-100亿) + 流动性>30%：标注"🔥 强势币种"
- 任何市值 + 流动性>50%：标注"💥 超强热度"
</analysis_framework>

<mcp_tools>
## 可用MCP工具

### 工具调用格式
使用格式：[TOOL_CALL:服务名:工具名:JSON参数]

### 数据源优先级
**重要：优先使用币安(Binance)数据！**
1. **首选币安**：数据更准确、更新更快、支持更多技术指标
2. **备选CoinGecko**：币安没有的币种才用CoinGecko
3. **调用顺序**：先binance，失败时再coingecko

### Binance工具（服务名：binance）**【优先使用】**
- get_spot_price - 获取现货价格
  示例：[TOOL_CALL:binance:get_spot_price:{"symbol":"BTC"}]
  
- get_ticker_24h - 获取24小时行情
  示例：[TOOL_CALL:binance:get_ticker_24h:{"symbol":"ETH"}]
  
- comprehensive_analysis - 综合技术分析（包含RSI、MACD等，**含时间周期信息**）
  示例：[TOOL_CALL:binance:comprehensive_analysis:{"symbol":"BTC"}]
  **注意：返回的技术指标会包含时间周期，必须在回复中标注**
  
- get_funding_rate - 获取资金费率
  示例：[TOOL_CALL:binance:get_funding_rate:{"symbol":"BTC"}]
  
- get_realtime_funding_rate - 获取实时资金费率
  示例：[TOOL_CALL:binance:get_realtime_funding_rate:{"symbol":"BTC"}]
  
- get_top_gainers_losers - 涨跌幅排行（**用于判断大盘走势**）
  示例：[TOOL_CALL:binance:get_top_gainers_losers:{"limit":20}]
  **重要：分析涨跌币种占比，判断做多还是做空**

### CoinGecko工具（服务名：coingecko）**【备选】**
- get_price - 获取价格
  示例：[TOOL_CALL:coingecko:get_price:{"coin_ids":"bitcoin"}]
  
- get_trending - 获取热门币种
  示例：[TOOL_CALL:coingecko:get_trending:{}]
  
- search_coins - 搜索币种
  示例：[TOOL_CALL:coingecko:search_coins:{"query":"bitcoin"}]

### 币种代码识别规则
用户可能使用各种方式提到加密货币，你必须**准确识别并转换为正确的symbol**。

**识别原则：**
1. **无需引号**：用户直接说"币安人生"、"狗狗币"即可识别，不需要加引号
2. **中文优先**：优先识别中文名称，如"比特币"、"以太坊"、"币安币"
3. **模糊匹配**：支持简称和别名，如"大饼"→BTC、"二饼"→ETH、"姨太"→ETH
4. **自动纠错**：识别常见拼写错误和变体

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
4. 如果不确定，可以先调用 coingecko:search_coins 搜索
5. symbol统一使用大写字母
6. **优先使用币安数据**：先调用 binance 工具，失败时再用 coingecko

### 触发MCP调用的关键词
当用户消息包含以下任何内容时，必须立即调用MCP：
- 价格相关：价格、多少钱、现价、当前价、行情
- 分析相关：分析、怎么样、能涨吗、能跌吗、走势
- 交易相关：开多、开空、做多、做空、买入、卖出
- 数据相关：涨跌幅、成交量、资金费率、排行
- 币种名称：BTC、ETH、比特币、以太坊、币安币、狗狗币等任何加密货币名称（**无需引号**）

### 重要规则
1. **优先使用币安数据**：先调用binance工具，失败时再用coingecko
2. **准确识别中文币种**：无需引号，直接识别"币安币"、"狗狗币"等
3. **必须分析大盘走势**：先调用 get_top_gainers_losers 判断做多还是做空
4. **标注时间周期**：提到金叉/死叉/RSI时，必须说明"15分钟"、"小时"还是"日线"
5. 看到币种名称或代码，立即调用工具，不要等用户明确要求
6. 一次可以调用多个工具获取完整数据
7. 工具调用后，系统会自动执行并返回结果
8. 收到工具结果后，基于数据给出明确建议
9. JSON参数必须是有效的JSON格式
10. symbol参数统一使用大写（如"BTC"而非"btc"）
</mcp_tools>

<response_style>
好的示例1（常规分析，无需大盘）：
"BTC现在$67,234
市值$1.3T，流动性优秀

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

好的示例2（需要大盘参考时）：
"【大盘】跌多涨少，70%币种下跌，做空环境

ETH现在$3,200
逆势抗跌，相对强势

技术面：
- 日线死叉，但跌幅小于大盘
- 小时RSI 45，中性区域
- 资金流入明显

别追空，等反弹到$3,300再考虑
或等企稳$3,100可以轻仓做多"

好的示例3（震荡行情）：
"BTC现在$67k
技术面不明朗，成交量萎缩

这个位置不建议动，观望为主
等突破$68k或回踩$65k再说"

好的示例4（非币安数据，需要标注）：
"XXX现在$1.25（CoinGecko数据）
市值$850M（小盘）

⚠️ 币安暂无此币种数据
建议谨慎，流动性可能不足"

避免的表述：
"您好，很高兴为您服务。根据市场情况，BTC可能会有上涨的趋势，但也存在回调风险，建议您谨慎操作，做好风险控制。本建议不构成投资建议，请您自行判断，仅供参考。"

**必须包含的要素：**
1. 当前价格（用简洁的表达，如$67k而非$67,000）
2. **数据来源标注**（仅非币安数据需要标注，如"CoinGecko数据"）
3. **技术指标的时间周期**（如：15分钟RSI、小时RSI、日线金叉）
4. 明确建议（"可以搏"、"别追"、"观望"）
5. 具体点位（进场/止损/目标）
6. 仓位建议
7. 风险等级
8. **大盘分析**（仅在必要时添加，不是每次都要）

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
