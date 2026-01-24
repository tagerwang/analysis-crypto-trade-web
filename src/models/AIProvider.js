import config from '../config/index.js';
import fetch from 'node-fetch';

class AIProvider {
  constructor(name, apiConfig) {
    this.name = name;
    this.apiConfig = apiConfig;
    this.stats = {
      calls: 0,
      errors: 0,
      avgLatency: 0,
      lastUsed: null
    };
  }

  async generate(messages, options = {}) {
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${this.apiConfig.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: this.apiConfig.model,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 2000,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const latency = Date.now() - startTime;
      
      this.updateStats(latency, true);
      
      return {
        success: true,
        content: data.choices[0].message.content,
        model: this.name,
        latency
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateStats(latency, false);
      
      return {
        success: false,
        error: error.message,
        model: this.name,
        latency
      };
    }
  }

  async generateStream(messages, onChunk, options = {}) {
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${this.apiConfig.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: this.apiConfig.model,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 2000,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let fullContent = '';
      const reader = response.body;
      let buffer = '';

      for await (const chunk of reader) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const content = json.choices?.[0]?.delta?.content;
              
              if (content) {
                fullContent += content;
                onChunk({
                  type: 'content',
                  content,
                  model: this.name
                });
              }
            } catch (e) {
              console.error('Parse error:', e, trimmed);
            }
          }
        }
      }

      const latency = Date.now() - startTime;
      this.updateStats(latency, true);
      
      return {
        success: true,
        content: fullContent,
        model: this.name,
        latency
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateStats(latency, false);
      
      return {
        success: false,
        error: error.message,
        model: this.name,
        latency
      };
    }
  }

  updateStats(latency, success) {
    this.stats.calls++;
    if (!success) this.stats.errors++;
    
    // 指数加权移动平均
    this.stats.avgLatency = this.stats.avgLatency 
      ? 0.7 * this.stats.avgLatency + 0.3 * latency
      : latency;
    
    this.stats.lastUsed = new Date();
  }

  getStats() {
    return {
      name: this.name,
      ...this.stats,
      successRate: this.stats.calls > 0 
        ? ((this.stats.calls - this.stats.errors) / this.stats.calls * 100).toFixed(2) + '%'
        : 'N/A'
    };
  }
}

// 模型管理器
class ModelManager {
  constructor() {
    this.models = new Map();
    this.currentMode = 'auto'; // 'auto', 'deepseek', 'qwen'
    this.initModels();
  }

  initModels() {
    // 初始化DeepSeek
    if (config.ai.deepseek.apiKey) {
      this.models.set('deepseek', new AIProvider('deepseek', config.ai.deepseek));
    }
    
    // 初始化千问
    if (config.ai.qwen.apiKey) {
      this.models.set('qwen', new AIProvider('qwen', config.ai.qwen));
    }
  }

  setMode(mode) {
    if (mode === 'auto' || this.models.has(mode)) {
      this.currentMode = mode;
      return true;
    }
    return false;
  }

  selectModel(prompt) {
    if (this.currentMode !== 'auto') {
      return this.models.get(this.currentMode);
    }

    // 自动选择策略：优先使用DeepSeek（对复杂Prompt支持更好）
    const deepseek = this.models.get('deepseek');
    const qwen = this.models.get('qwen');
    
    // 如果DeepSeek可用且成功率可接受，优先使用
    if (deepseek && (deepseek.stats.calls === 0 || deepseek.stats.errors / deepseek.stats.calls < 0.3)) {
      return deepseek;
    }
    
    // 如果DeepSeek失败率高，使用千问作为备用
    if (qwen && (qwen.stats.calls === 0 || qwen.stats.errors / qwen.stats.calls < 0.5)) {
      return qwen;
    }
    
    // 都不可用时，返回第一个可用模型
    return this.models.values().next().value;
    // // 选择延迟最低的模型
    // return availableModels.reduce((best, current) => {
    //   if (current.stats.avgLatency === 0) return current;
    //   if (best.stats.avgLatency === 0) return best;
    //   return current.stats.avgLatency < best.stats.avgLatency ? current : best;
    // });
  }

  async chat(messages, options = {}) {
    const model = this.selectModel(messages[messages.length - 1]?.content || '');
    
    if (!model) {
      throw new Error('No available AI model');
    }

    const result = await model.generate(messages, options);
    
    // 如果失败且是自动模式，尝试备用模型
    if (!result.success && this.currentMode === 'auto') {
      const backupModel = Array.from(this.models.values())
        .find(m => m !== model);
      
      if (backupModel) {
        return await backupModel.generate(messages, options);
      }
    }

    return result;
  }

  async chatStream(messages, onChunk, options = {}) {
    const model = this.selectModel(messages[messages.length - 1]?.content || '');
    
    if (!model) {
      throw new Error('No available AI model');
    }

    const result = await model.generateStream(messages, onChunk, options);
    
    // 如果失败且是自动模式，尝试备用模型
    if (!result.success && this.currentMode === 'auto') {
      const backupModel = Array.from(this.models.values())
        .find(m => m !== model);
      
      if (backupModel) {
        return await backupModel.generateStream(messages, onChunk, options);
      }
    }

    return result;
  }

  getAvailableModels() {
    return Array.from(this.models.keys());
  }

  getStats() {
    return {
      currentMode: this.currentMode,
      models: Array.from(this.models.values()).map(m => m.getStats())
    };
  }
}

export default new ModelManager();
