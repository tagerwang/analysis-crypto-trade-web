import config from '../config/index.js';
import NodeCache from 'node-cache';
import fetch from 'node-fetch';

class MCPService {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 60 }); // 1分钟缓存
    this.toolsListCache = new NodeCache({ stdTTL: 300 }); // 5分钟缓存 tools/list
  }

  /**
   * 从 MCP 服务获取工具列表
   * @param {string} service - MCP 服务名（如 'binance', 'cryptoCom'）
   * @returns {Promise<Array>} MCP 工具列表 [{ name, description, inputSchema }, ...]
   */
  async listTools(service, timeout = 10000) {
    const cacheKey = `tools_list:${service}`;
    const cached = this.toolsListCache.get(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const serviceUrl = config.mcp[service];
    if (!serviceUrl) {
      console.warn(`[MCPService] Unknown service: ${service}`);
      return [];
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(serviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list',
          params: {}
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'MCP error');
      }

      const tools = data.result?.tools || [];
      // 只缓存非空列表，避免 MCP 曾返回空或异常时长期拿不到工具
      if (tools.length > 0) {
        this.toolsListCache.set(cacheKey, tools);
      }
      console.log(`[MCPService] ✅ ${service}: ${tools.length} tools (${serviceUrl})`);
      
      return tools;
    } catch (error) {
      const errorMsg = error.name === 'AbortError' ? 'timeout' : error.message;
      console.warn(`[MCPService] ❌ ${service}: ${errorMsg} (${serviceUrl})`);
      return [];
    }
  }

  /**
   * 将 MCP 工具列表转换为 OpenAI tools 格式
   * @param {string} service - MCP 服务名
   * @param {Array} mcpTools - MCP 工具列表
   * @returns {Array} OpenAI tools 格式 [{ type: 'function', function: {...} }, ...]
   */
  mcpToolsToOpenAI(service, mcpTools) {
    return mcpTools.map((tool) => ({
      type: 'function',
      function: {
        name: `${service}__${tool.name}`,
        description: tool.description || `MCP tool: ${tool.name}`,
        parameters: tool.inputSchema || tool.parameters || { type: 'object', properties: {} }
      }
    }));
  }

  /**
   * 聚合所有 MCP 服务的工具，返回 OpenAI 格式
   * @returns {Promise<Array>} OpenAI tools 数组
   */
  async getAllToolsOpenAIFormat() {
    const result = await this.getAllToolsOpenAIFormatWithStatus();
    return result.tools;
  }

  /**
   * 获取所有工具并返回状态信息
   * @returns {Promise<{tools: Array, status: Object}>}
   */
  async getAllToolsOpenAIFormatWithStatus() {
    const services = Object.keys(config.mcp);
    console.log(`[MCPService] Fetching tools from ${services.length} services...`);
    
    // 并发调用所有 MCP 服务，失败的不阻塞成功的
    const results = await Promise.allSettled(
      services.map(async (service) => {
        const mcpTools = await this.listTools(service);
        return { service, tools: this.mcpToolsToOpenAI(service, mcpTools) };
      })
    );
    
    // 收集成功和失败的服务
    const allTools = [];
    const available = [];
    const unavailable = [];
    
    results.forEach((result, index) => {
      const service = services[index];
      if (result.status === 'fulfilled' && result.value.tools.length > 0) {
        allTools.push(...result.value.tools);
        available.push(service);
      } else {
        unavailable.push(service);
      }
    });
    
    console.log(`[MCPService] ✅ Total: ${allTools.length} tools from [${available.join(', ')}]`);
    if (unavailable.length > 0) {
      console.log(`[MCPService] ❌ Unavailable: [${unavailable.join(', ')}]`);
    }
    
    return {
      tools: allTools,
      status: { available, unavailable }
    };
  }

  /**
   * 从 OpenAI function name 解析出 service 和 tool
   * @param {string} openAIName - 如 'binance__get_spot_price'
   * @returns {Object|null} { service: 'binance', tool: 'get_spot_price' } 或 null
   */
  parseToolName(openAIName) {
    if (!openAIName) return null;
    const idx = openAIName.indexOf('__');
    if (idx === -1) return null;
    
    return {
      service: openAIName.slice(0, idx),
      tool: openAIName.slice(idx + 2)
    };
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

    const callTimeout = 60000; // 分析类工具可能较慢，60s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), callTimeout);

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
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || 'MCP call failed');
      }

      // 提取数据，如果是 JSON 字符串则解析
      let resultData = data.result?.content?.[0]?.text || data.result;
      
      // 🔧 修复：如果返回的是 JSON 字符串，自动解析
      if (typeof resultData === 'string') {
        try {
          resultData = JSON.parse(resultData?.replace(/\n/g, ''));
        } catch (e) {
          // 如果解析失败，保持原字符串
          console.warn(`[MCPService] Failed to parse JSON response from ${service}:${toolName}:`, e.message);
        }
      }

      const result = {
        success: true,
        data: resultData,
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
    } finally {
      clearTimeout(timeoutId);
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
