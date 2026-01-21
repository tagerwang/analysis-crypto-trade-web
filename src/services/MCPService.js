import config from '../config/index.js';
import NodeCache from 'node-cache';
import fetch from 'node-fetch';

class MCPService {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 60 }); // 1分钟缓存
  }

  async callTool(service, toolName, args = {}) {
    const cacheKey = `${service}:${toolName}:${JSON.stringify(args)}`;
    
    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const serviceUrl = config.mcp[service];
    if (!serviceUrl) {
      throw new Error(`Unknown MCP service: ${service}`);
    }

    try {
      const response = await fetch(serviceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || 'MCP call failed');
      }

      const result = {
        success: true,
        data: data.result?.content?.[0]?.text || data.result,
        service,
        tool: toolName
      };

      // 缓存结果
      this.cache.set(cacheKey, result);
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        service,
        tool: toolName
      };
    }
  }

  // 便捷方法
  async getBinancePrice(symbol) {
    return this.callTool('binance', 'get_spot_price', { symbol });
  }

  async getBinanceTicker(symbol) {
    return this.callTool('binance', 'get_ticker_24h', { symbol });
  }

  async getBinanceAnalysis(symbol) {
    return this.callTool('binance', 'comprehensive_analysis', { symbol });
  }

  async getCoinGeckoPrice(coinIds) {
    return this.callTool('coingecko', 'get_price', { coin_ids: coinIds });
  }

  async getCoinGeckoTrending() {
    return this.callTool('coingecko', 'get_trending', {});
  }

  async searchCoins(query) {
    return this.callTool('coingecko', 'search_coins', { query });
  }
}

export default new MCPService();
