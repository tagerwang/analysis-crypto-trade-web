import MCPService from './MCPService.js';

/**
 * 数据验证服务
 * 用于验证AI回复中的价格数据准确性
 */
class ValidationService {
  constructor() {
    // 价格偏差阈值（超过此阈值则认为数据错误）
    this.PRICE_DEVIATION_THRESHOLD = 0.05; // 5%
    this.EXTREME_DEVIATION_THRESHOLD = 0.20; // 20%（极端偏差）
  }

  /**
   * 验证AI回复中的价格数据
   * @param {string} aiResponse - AI的回复内容
   * @param {Array} toolResults - MCP工具调用结果
   * @returns {Object} { valid: boolean, warnings: [], corrections: {} }
   */
  async validatePriceData(aiResponse, toolResults) {
    const result = {
      valid: true,
      warnings: [],
      corrections: {},
      needsCorrection: false
    };

    // 提取AI回复中提到的价格
    const pricesInResponse = this.extractPricesFromResponse(aiResponse);
    
    if (pricesInResponse.length === 0) {
      return result; // 没有价格信息，无需验证
    }

    // 从工具结果中提取实际价格
    const actualPrices = this.extractActualPrices(toolResults);

    // 验证每个价格
    for (const mentioned of pricesInResponse) {
      const actual = actualPrices[mentioned.symbol];
      
      if (!actual) {
        // 没有找到对应的实际价格数据
        result.warnings.push({
          type: 'missing_data',
          symbol: mentioned.symbol,
          message: `未找到${mentioned.symbol}的实际价格数据`
        });
        continue;
      }

      // 计算偏差
      const deviation = Math.abs(mentioned.price - actual.price) / actual.price;
      
      if (deviation > this.EXTREME_DEVIATION_THRESHOLD) {
        // 极端偏差 - 必须纠正
        result.valid = false;
        result.needsCorrection = true;
        result.corrections[mentioned.symbol] = {
          mentioned: mentioned.price,
          actual: actual.price,
          deviation: (deviation * 100).toFixed(2) + '%',
          severity: 'critical'
        };
        result.warnings.push({
          type: 'critical_deviation',
          symbol: mentioned.symbol,
          mentionedPrice: mentioned.price,
          actualPrice: actual.price,
          deviation: (deviation * 100).toFixed(2) + '%',
          message: `⚠️ 严重错误：${mentioned.symbol}价格偏差${(deviation * 100).toFixed(2)}%（提到$${mentioned.price}，实际$${actual.price}）`
        });
      } else if (deviation > this.PRICE_DEVIATION_THRESHOLD) {
        // 一般偏差 - 警告
        result.warnings.push({
          type: 'price_deviation',
          symbol: mentioned.symbol,
          mentionedPrice: mentioned.price,
          actualPrice: actual.price,
          deviation: (deviation * 100).toFixed(2) + '%',
          message: `⚠️ 价格偏差：${mentioned.symbol}偏差${(deviation * 100).toFixed(2)}%（提到$${mentioned.price}，实际$${actual.price}）`
        });
      }
    }

    return result;
  }

  /**
   * 从AI回复中提取价格信息
   * @param {string} response - AI回复
   * @returns {Array} [{ symbol, price, position }]
   */
  extractPricesFromResponse(response) {
    const prices = [];
    
    // 匹配模式：BTC现在$67,234 或 BTC当前$67234 或 BTC $67k
    const patterns = [
      // 匹配 "BTC现在$67,234" 或 "BTC当前$67234"
      /([A-Z]{2,10})(?:现在|当前|价格)\$?([\d,]+(?:\.\d+)?)/gi,
      // 匹配 "BTC $67,234"
      /([A-Z]{2,10})\s*\$\s*([\d,]+(?:\.\d+)?)/gi,
      // 匹配 "$67,234 (BTC)" 或 "$67234(BTC)"
      /\$\s*([\d,]+(?:\.\d+)?)\s*\(([A-Z]{2,10})\)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(response)) !== null) {
        let symbol, priceStr;
        
        if (pattern.source.includes('\\(')) {
          // 第三种模式：价格在前，币种在后
          priceStr = match[1];
          symbol = match[2];
        } else {
          // 前两种模式：币种在前，价格在后
          symbol = match[1];
          priceStr = match[2];
        }
        
        // 清理价格字符串
        priceStr = priceStr.replace(/,/g, '');
        
        // 处理 k (千) 单位
        if (priceStr.toLowerCase().includes('k')) {
          priceStr = priceStr.toLowerCase().replace('k', '');
          priceStr = (parseFloat(priceStr) * 1000).toString();
        }
        
        const price = parseFloat(priceStr);
        
        if (!isNaN(price) && price > 0) {
          prices.push({
            symbol: symbol.toUpperCase(),
            price: price,
            position: match.index
          });
        }
      }
    }

    // 去重（同一个币种可能被提取多次）
    const uniquePrices = [];
    const seen = new Set();
    
    for (const item of prices) {
      if (!seen.has(item.symbol)) {
        seen.add(item.symbol);
        uniquePrices.push(item);
      }
    }

    return uniquePrices;
  }

  /**
   * 从工具调用结果中提取实际价格
   * @param {Array} toolResults - 工具调用结果
   * @returns {Object} { symbol: { price, source } }
   */
  extractActualPrices(toolResults) {
    const prices = {};

    if (!toolResults || toolResults.length === 0) {
      return prices;
    }

    for (const result of toolResults) {
      if (!result.result || !result.result.success) {
        continue;
      }

      const { call, result: toolResult } = result;
      const data = toolResult.data;

      // 尝试解析数据
      let parsedData;
      try {
        parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      } catch (e) {
        continue;
      }

      // 从不同的工具结果中提取价格
      if (call.tool === 'get_spot_price' || call.tool === 'get_ticker_24h') {
        // Binance 价格数据
        const symbol = call.args.symbol;
        const price = parsedData.price || parsedData.lastPrice || parsedData.last;
        
        if (price) {
          prices[symbol] = {
            price: parseFloat(price),
            source: call.service,
            tool: call.tool
          };
        }
      } else if (call.tool === 'comprehensive_analysis') {
        // 综合分析数据
        const symbol = call.args.symbol;
        const price = parsedData.currentPrice || parsedData.price;
        
        if (price) {
          prices[symbol] = {
            price: parseFloat(price),
            source: call.service,
            tool: call.tool
          };
        }
      } else if (call.tool === 'get_price') {
        // CoinGecko 价格数据
        // 数据格式：{ bitcoin: { usd: 67234 } }
        for (const [coinId, priceData] of Object.entries(parsedData)) {
          if (priceData.usd) {
            // 尝试将 coinId 转换为 symbol
            const symbol = this.coinIdToSymbol(coinId);
            prices[symbol] = {
              price: parseFloat(priceData.usd),
              source: call.service,
              tool: call.tool
            };
          }
        }
      }
    }

    return prices;
  }

  /**
   * 将 CoinGecko 的 coin_id 转换为 symbol
   * @param {string} coinId - CoinGecko的coin_id
   * @returns {string} symbol
   */
  coinIdToSymbol(coinId) {
    const mapping = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'binancecoin': 'BNB',
      'ripple': 'XRP',
      'solana': 'SOL',
      'cardano': 'ADA',
      'dogecoin': 'DOGE',
      'shiba-inu': 'SHIB',
      'pepe': 'PEPE',
      'matic-network': 'MATIC',
      'avalanche-2': 'AVAX',
      'polkadot': 'DOT',
      'chainlink': 'LINK',
      'uniswap': 'UNI',
      'arbitrum': 'ARB',
      'optimism': 'OP'
    };
    return mapping[coinId] || coinId.toUpperCase();
  }

  /**
   * 生成纠正后的回复（重新调用AI）
   * @param {string} originalResponse - 原始回复
   * @param {Object} validationResult - 验证结果
   * @param {Array} toolResults - 工具调用结果
   * @param {Function} aiChatFunction - AI聊天函数
   * @param {Array} messages - 消息历史
   * @param {string} systemPrompt - 系统提示词
   * @returns {Promise<string>} 纠正后的回复
   */
  async regenerateResponseWithCorrectPrice(originalResponse, validationResult, toolResults, aiChatFunction, messages, systemPrompt) {
    // 构建纠正提示
    const corrections = Object.entries(validationResult.corrections)
      .map(([symbol, correction]) => {
        return `${symbol}的实际价格是$${this.formatPrice(correction.actual)}（不是$${correction.mentioned}）`;
      })
      .join('、');

    const toolResultsText = toolResults.map(tr => {
      if (tr.result.success) {
        return `工具调用成功 [${tr.call.service}:${tr.call.tool}]:\n${JSON.stringify(tr.result.data, null, 2)}`;
      } else {
        return `工具调用失败 [${tr.call.service}:${tr.call.tool}]: ${tr.result.error}`;
      }
    }).join('\n\n');

    const correctionPrompt = `⚠️ 检测到价格数据错误：${corrections}

请基于以下实际数据，重新生成完整的分析和建议：

${toolResultsText}

重要提示：
1. 使用工具返回的实际价格数据
2. 重新计算所有相关数据（买卖点、止损位、目标价等）
3. 确保所有数据基于正确的价格
4. 不要提及价格纠正的过程，直接给出正确的分析`;

    // 重新调用AI
    const correctionMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
      { role: 'assistant', content: originalResponse },
      { role: 'user', content: correctionPrompt }
    ];

    const result = await aiChatFunction(correctionMessages);
    
    if (result.success) {
      return result.content;
    } else {
      // 如果重新生成失败，返回带纠正说明的原始回复
      return this.generateCorrectedResponse(originalResponse, validationResult);
    }
  }

  /**
   * 生成纠正后的回复（简单替换，已废弃，仅作为备用）
   * @param {string} originalResponse - 原始回复
   * @param {Object} validationResult - 验证结果
   * @returns {string} 纠正后的回复
   */
  generateCorrectedResponse(originalResponse, validationResult) {
    let correctedResponse = originalResponse;

    // 替换错误的价格
    for (const [symbol, correction] of Object.entries(validationResult.corrections)) {
      // 构建正则表达式来匹配价格
      const patterns = [
        new RegExp(`${symbol}(?:现在|当前|价格)\\$?([\\d,]+(?:\\.\\d+)?)`, 'gi'),
        new RegExp(`${symbol}\\s*\\$\\s*([\\d,]+(?:\\.\\d+)?)`, 'gi')
      ];

      for (const pattern of patterns) {
        correctedResponse = correctedResponse.replace(pattern, (match) => {
          // 格式化实际价格
          const formattedPrice = this.formatPrice(correction.actual);
          return match.replace(/[\d,]+(?:\.\d+)?/, formattedPrice);
        });
      }
    }

    // 添加纠正说明
    if (validationResult.needsCorrection) {
      const correctionNote = '\n\n⚠️ 价格已自动纠正（检测到数据偏差）';
      correctedResponse += correctionNote;
    }

    return correctedResponse;
  }

  /**
   * 格式化价格显示
   * @param {number} price - 价格
   * @returns {string} 格式化后的价格
   */
  formatPrice(price) {
    if (price >= 1000) {
      return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
    } else if (price >= 1) {
      return price.toFixed(4);
    } else {
      return price.toFixed(6);
    }
  }
}

export default new ValidationService();
