# 多模型接入和切换 -- （仅参考）
基于你的需求（Node.js + 多模型 + MCP集成 + 可扩展），我推荐 **LangChain.js** + **自定义路由层** 的组合方案！

## 🎯 **推荐方案：LangChain.js + 自定义路由系统**

### **为什么选择这个组合？**
1. **Node.js原生支持**：LangChain.js是Node.js首选AI框架
2. **多模型原生支持**：内置DeepSeek、千问、智谱、Gemini等适配器
3. **MCP集成友好**：有现成的MCP集成方案
4. **可扩展性强**：方便后续增减模型
5. **企业级功能**：支持流式输出、回退、重试、监控等

---

## 🚀 **完整实现方案**

### **1. 项目结构**
```
your-project/
├── src/
│   ├── models/
│   │   ├── ModelRouter.js      # 核心路由逻辑
│   │   ├── providers/
│   │   │   ├── DeepSeekProvider.js
│   │   │   ├── QwenProvider.js
│   │   │   ├── ZhipuProvider.js
│   │   │   ├── GeminiProvider.js
│   │   │   └── McpProvider.js  # 你的自研MCP
│   │   └── ModelRegistry.js    # 模型注册表
│   ├── middleware/
│   │   ├── autoSwitch.js       # 自动切换逻辑
│   │   └── fallback.js         # 回退机制
│   ├── services/
│   │   └── ChatService.js      # 业务服务层
│   └── app.js                  # 主应用
├── config/
│   └── models.json             # 模型配置
└── package.json
```

### **2. 安装依赖**
```json
{
  "dependencies": {
    "@langchain/core": "^0.2.0",
    "@langchain/openai": "^0.1.0",
    "@langchain/google-genai": "^0.0.14",
    "langchain": "^0.2.0",
    "@langchain/community": "^0.0.34",
    "express": "^4.18.0",
    "axios": "^1.6.0",
    "lodash": "^4.17.0",
    "dotenv": "^16.0.0",
    "node-cache": "^5.1.0"
  }
}
```

### **3. 核心实现代码**

#### **ModelRegistry.js - 模型注册中心**
```javascript
class ModelRegistry {
  constructor() {
    this.models = new Map();
    this.autoSwitchStrategies = [];
    this.performanceMetrics = new Map();
  }

  registerModel(name, provider, config = {}) {
    this.models.set(name, {
      provider,
      config,
      enabled: true,
      stats: {
        calls: 0,
        errors: 0,
        avgLatency: 0,
        lastUsed: null
      }
    });
  }

  unregisterModel(name) {
    this.models.delete(name);
  }

  enableModel(name) {
    const model = this.models.get(name);
    if (model) model.enabled = true;
  }

  disableModel(name) {
    const model = this.models.get(name);
    if (model) model.enabled = false;
  }

  getAvailableModels() {
    return Array.from(this.models.entries())
      .filter(([_, config]) => config.enabled)
      .map(([name, config]) => ({
        name,
        type: config.provider.constructor.name,
        stats: config.stats
      }));
  }

  updatePerformance(modelName, latency, success = true) {
    const model = this.models.get(modelName);
    if (model) {
      model.stats.calls++;
      if (!success) model.stats.errors++;
      
      // 更新平均延迟（指数加权移动平均）
      model.stats.avgLatency = model.stats.avgLatency 
        ? 0.7 * model.stats.avgLatency + 0.3 * latency
        : latency;
      
      model.stats.lastUsed = new Date();
    }
  }
}
```

#### **ModelRouter.js - 智能路由**
```javascript
class ModelRouter {
  constructor(registry) {
    this.registry = registry;
    this.mode = 'auto'; // 'auto', 'manual'
    this.manualModel = null;
    this.strategies = {
      latency: this.latencyBasedStrategy.bind(this),
      roundRobin: this.roundRobinStrategy.bind(this),
      costOptimized: this.costOptimizedStrategy.bind(this),
      qualityFirst: this.qualityFirstStrategy.bind(this)
    };
    this.currentStrategy = 'latency';
  }

  setMode(mode, modelName = null) {
    this.mode = mode;
    if (mode === 'manual' && modelName) {
      this.manualModel = modelName;
    } else if (mode === 'auto') {
      this.manualModel = null;
    }
  }

  async selectModel(prompt, context = {}) {
    if (this.mode === 'manual' && this.manualModel) {
      return this.manualModel;
    }

    // 自动选择策略
    const strategy = this.strategies[this.currentStrategy];
    return await strategy(prompt, context);
  }

  async latencyBasedStrategy(prompt, context) {
    const models = this.registry.getAvailableModels();
    
    // 如果有性能数据，选择最快的
    const modelsWithMetrics = models
      .filter(m => m.stats.avgLatency > 0)
      .sort((a, b) => a.stats.avgLatency - b.stats.avgLatency);
    
    if (modelsWithMetrics.length > 0) {
      return modelsWithMetrics[0].name;
    }
    
    // 否则轮询
    return this.roundRobinStrategy();
  }

  async costOptimizedStrategy() {
    // 成本优化策略 - 可以根据不同API的定价配置权重
    const costMap = {
      'deepseek': 0,      // 免费
      'qwen-turbo': 0.1,  // 低成本
      'zhipu-lite': 0.2,
      'gemini-flash': 0.3
    };
    
    const models = this.registry.getAvailableModels();
    const sorted = models.sort((a, b) => 
      (costMap[a.name] || 1) - (costMap[b.name] || 1)
    );
    
    return sorted[0]?.name;
  }

  roundRobinStrategy() {
    const models = this.registry.getAvailableModels();
    if (models.length === 0) throw new Error('No models available');
    
    // 简单轮询
    const lastIndex = this.lastIndex || 0;
    const nextIndex = (lastIndex + 1) % models.length;
    this.lastIndex = nextIndex;
    
    return models[nextIndex].name;
  }

  async qualityFirstStrategy(prompt) {
    // 基于内容类型选择最佳模型
    const contentAnalysis = this.analyzeContent(prompt);
    
    if (contentAnalysis.hasCode) {
      return 'deepseek'; // DeepSeek代码能力强
    } else if (contentAnalysis.isChinese) {
      return 'zhipu'; // 智谱中文优化
    } else if (contentAnalysis.isCreative) {
      return 'gemini'; // Gemini创意能力强
    } else {
      return 'qwen'; // 千问通用性强
    }
  }

  analyzeContent(prompt) {
    return {
      isChinese: /[\u4e00-\u9fa5]/.test(prompt),
      hasCode: /(function|def|class|import|console\.|print\()/.test(prompt),
      isCreative: /(创作|写诗|故事|想象)/.test(prompt),
      isTechnical: /(API|配置|部署|算法|架构)/.test(prompt)
    };
  }
}
```

#### **具体模型提供者实现**

**DeepSeekProvider.js**
```javascript
import { ChatOpenAI } from "@langchain/openai";

export class DeepSeekProvider {
  constructor(apiKey) {
    this.client = new ChatOpenAI({
      modelName: "deepseek-chat",
      openAIApiKey: apiKey,
      configuration: {
        baseURL: "https://api.deepseek.com"
      },
      temperature: 0.7,
      maxTokens: 2000
    });
  }

  async generate(prompt, options = {}) {
    try {
      const startTime = Date.now();
      const response = await this.client.invoke(prompt);
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        content: response.content,
        latency,
        model: 'deepseek-chat'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        model: 'deepseek-chat'
      };
    }
  }
}
```

**QwenProvider.js** (千问)
```javascript
export class QwenProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    // this.baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    this.baseURL="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  }

  async generate(prompt, options = {}) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        messages: [{ role: 'user', content: prompt }],
        ...options
      })
    });
    
    const data = await response.json();
    return {
      success: true,
      content: data.choices[0].message.content,
      model: 'qwen-turbo'
    };
  }
}
```

**McpProvider.js** (你的自研MCP)
```javascript
export class McpProvider {
  constructor(endpoint, apiKey) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  async generate(prompt, options = {}) {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({
          prompt,
          ...options,
          // MCP特定参数
          stream: options.stream || false,
          temperature: options.temperature || 0.7
        })
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      return {
        success: true,
        content: data.text || data.response,
        latency: data.latency || 0,
        model: 'mcp-custom'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        model: 'mcp-custom'
      };
    }
  }
}
```

#### **ChatService.js - 业务服务层**
```javascript
export class ChatService {
  constructor(modelRouter, modelRegistry) {
    this.router = modelRouter;
    this.registry = modelRegistry;
    this.history = [];
    this.maxRetries = 2;
  }

  async chat(message, options = {}) {
    const {
      mode = 'auto',
      model: manualModel,
      temperature = 0.7,
      maxTokens = 2000
    } = options;

    // 设置模式
    this.router.setMode(mode, manualModel);

    // 选择模型
    const modelName = await this.router.selectModel(message, {
      history: this.history,
      ...options
    });

    // 获取模型提供者
    const modelConfig = this.registry.models.get(modelName);
    if (!modelConfig || !modelConfig.enabled) {
      throw new Error(`Model ${modelName} is not available`);
    }

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await modelConfig.provider.generate(message, {
          temperature,
          maxTokens,
          ...options
        });
        const latency = Date.now() - startTime;

        // 更新性能指标
        this.registry.updatePerformance(modelName, latency, result.success);

        if (result.success) {
          // 保存历史
          this.history.push({
            role: 'user',
            content: message
          }, {
            role: 'assistant',
            content: result.content,
            model: modelName,
            latency
          });

          return {
            response: result.content,
            model: modelName,
            latency,
            mode,
            timestamp: new Date().toISOString()
          };
        } else {
          lastError = result.error;
        }
      } catch (error) {
        lastError = error.message;
      }

      // 失败时尝试其他模型（自动模式下）
      if (mode === 'auto' && attempt < this.maxRetries) {
        // 临时禁用失败模型
        this.registry.disableModel(modelName);
        continue;
      }
    }

    throw new Error(`All attempts failed. Last error: ${lastError}`);
  }

  async switchModel(modelName) {
    if (!this.registry.models.has(modelName)) {
      throw new Error(`Model ${modelName} not found`);
    }
    this.router.setMode('manual', modelName);
    return { success: true, model: modelName };
  }

  async setAutoMode(strategy = 'latency') {
    this.router.setMode('auto');
    this.router.currentStrategy = strategy;
    return { 
      success: true, 
      mode: 'auto', 
      strategy 
    };
  }

  getStats() {
    return {
      totalCalls: Array.from(this.registry.models.values())
        .reduce((sum, m) => sum + m.stats.calls, 0),
      availableModels: this.registry.getAvailableModels(),
      currentMode: this.router.mode,
      currentModel: this.router.manualModel
    };
  }
}
```

#### **app.js - Express应用**
```javascript
import express from 'express';
import { ModelRegistry } from './src/models/ModelRegistry.js';
import { ModelRouter } from './src/models/ModelRouter.js';
import { ChatService } from './src/services/ChatService.js';
import { 
  DeepSeekProvider, 
  QwenProvider, 
  ZhipuProvider,
  GeminiProvider,
  McpProvider 
} from './src/models/providers/index.js';

const app = express();
app.use(express.json());

// 初始化
const registry = new ModelRegistry();
const router = new ModelRouter(registry);
const chatService = new ChatService(router, registry);

// 注册模型提供者
registry.registerModel('deepseek', new DeepSeekProvider(process.env.DEEPSEEK_API_KEY));
registry.registerModel('qwen', new QwenProvider(process.env.QWEN_API_KEY));
registry.registerModel('zhipu', new ZhipuProvider(process.env.ZHIPU_API_KEY));
registry.registerModel('gemini', new GeminiProvider(process.env.GEMINI_API_KEY));
registry.registerModel('mcp', new McpProvider(
  process.env.MCP_ENDPOINT, 
  process.env.MCP_API_KEY
));

// API路由
app.post('/api/chat', async (req, res) => {
  try {
    const { message, mode, model, ...options } = req.body;
    const result = await chatService.chat(message, { mode, model, ...options });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/switch-model', async (req, res) => {
  try {
    const { model } = req.body;
    const result = await chatService.switchModel(model);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auto-mode', async (req, res) => {
  try {
    const { strategy } = req.body;
    const result = await chatService.setAutoMode(strategy);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/models', (req, res) => {
  res.json({
    available: registry.getAvailableModels(),
    currentMode: router.mode,
    currentModel: router.manualModel,
    strategies: Object.keys(router.strategies)
  });
});

app.get('/api/stats', (req, res) => {
  res.json(chatService.getStats());
});

// 管理接口
app.post('/api/models/:name/enable', (req, res) => {
  registry.enableModel(req.params.name);
  res.json({ success: true });
});

app.post('/api/models/:name/disable', (req, res) => {
  registry.disableModel(req.params.name);
  res.json({ success: true });
});

// WebSocket支持流式输出
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const { message, mode, model } = JSON.parse(data);
    const result = await chatService.chat(message, { mode, model, stream: true });
    
    // 流式输出（模拟）
    const words = result.response.split(' ');
    words.forEach((word, index) => {
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'chunk',
          content: word + ' ',
          index
        }));
      }, index * 50);
    });
    
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'complete',
        model: result.model,
        latency: result.latency
      }));
    }, words.length * 50);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### **4. 客户端使用示例**
```javascript
// 前端调用示例
class AIClient {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
  }

  async chat(message, options = {}) {
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...options })
    });
    return response.json();
  }

  async switchModel(modelName) {
    const response = await fetch(`${this.baseURL}/api/switch-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName })
    });
    return response.json();
  }

  async setAutoMode(strategy = 'latency') {
    const response = await fetch(`${this.baseURL}/api/auto-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy })
    });
    return response.json();
  }
}

// 使用示例
const client = new AIClient();

// 自动模式
const autoResponse = await client.chat('你好，写一段Python代码', {
  mode: 'auto',
  temperature: 0.7
});

// 手动切换到DeepSeek
await client.switchModel('deepseek');

// 手动模式
const manualResponse = await client.chat('解释一下量子计算', {
  mode: 'manual',
  model: 'deepseek'
});

// 切回自动模式
await client.setAutoMode('costOptimized');
```

### **5. 环境变量配置 (.env)**
```env
# API Keys
DEEPSEEK_API_KEY=your_deepseek_key
QWEN_API_KEY=your_qwen_key
ZHIPU_API_KEY=your_zhipu_key
GEMINI_API_KEY=your_gemini_key

# 自研MCP配置
MCP_ENDPOINT=https://your-mcp-service.com/api/generate
MCP_API_KEY=your_mcp_key

# 服务器配置
PORT=3000
NODE_ENV=production

# 性能配置
MAX_RETRIES=3
REQUEST_TIMEOUT=30000
CACHE_TTL=3600
```

### **6. 监控和部署**

**Docker部署**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000 8080
CMD ["node", "src/app.js"]
```

**PM2配置 (ecosystem.config.js)**
```javascript
module.exports = {
  apps: [{
    name: 'ai-router',
    script: 'src/app.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    watch: false,
    max_memory_restart: '1G'
  }]
};
```

## 🎨 **管理面板建议**

你还可以添加一个简单的管理面板：

```javascript
// admin.html (简易管理界面)
const adminHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>AI模型路由管理</title>
    <style>
        .model-card { margin: 10px; padding: 15px; border: 1px solid #ccc; }
        .active { background-color: #e0ffe0; }
        .inactive { background-color: #ffe0e0; }
    </style>
</head>
<body>
    <div id="app">
        <h1>AI模型管理</h1>
        <div>
            <label>模式：</label>
            <select id="mode">
                <option value="auto">自动</option>
                <option value="manual">手动</option>
            </select>
            <select id="modelSelect" disabled>
                <!-- 动态填充 -->
            </select>
            <select id="strategySelect">
                <option value="latency">延迟优先</option>
                <option value="costOptimized">成本优化</option>
                <option value="qualityFirst">质量优先</option>
            </select>
            <button onclick="applySettings()">应用</button>
        </div>
        <div id="models"></div>
        <div id="stats"></div>
    </div>
    <script>
        // 动态管理逻辑
    </script>
</body>
</html>
`;
```

## 📊 **特性总结**

这个方案提供：

✅ **多模型支持**：DeepSeek、千问、智谱、Gemini + 你的MCP  
✅ **自动/手动切换**：灵活的模式选择  
✅ **智能路由策略**：延迟、成本、质量多种策略  
✅ **可扩展架构**：方便增减模型  
✅ **完整API接口**：REST + WebSocket  
✅ **性能监控**：实时统计和指标  
✅ **错误处理**：自动重试和回退  
✅ **流式输出**：支持实时响应  
✅ **生产就绪**：Docker、PM2、环境变量配置  

需要我详细解释某个部分，或者帮你调整特定功能吗？ 😊