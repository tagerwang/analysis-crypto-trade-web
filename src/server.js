import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import ChatService from './services/ChatService.js';
import MCPService from './services/MCPService.js';
import ModelManager from './models/AIProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 生成会话ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// API路由
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message, model } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const sid = sessionId || generateSessionId();
    
    // 设置模型模式
    if (model) {
      ModelManager.setMode(model);
    }

    const result = await ChatService.chat(sid, message);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 切换模型
app.post('/api/model/switch', (req, res) => {
  try {
    const { model } = req.body;
    const success = ModelManager.setMode(model);
    
    if (success) {
      res.json({ success: true, model });
    } else {
      res.status(400).json({ success: false, error: 'Invalid model' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取可用模型
app.get('/api/models', (req, res) => {
  res.json({
    available: ['auto', ...ModelManager.getAvailableModels()],
    stats: ModelManager.getStats()
  });
});

// 获取会话历史
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await ChatService.listSessions();
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 加载会话
app.get('/api/session/:id', async (req, res) => {
  try {
    const messages = await ChatService.loadSession(req.params.id);
    if (messages) {
      res.json({ success: true, messages });
    } else {
      res.status(404).json({ success: false, error: 'Session not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除会话
app.delete('/api/session/:id', async (req, res) => {
  try {
    const success = await ChatService.deleteSession(req.params.id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// MCP工具调用（可选，用于直接测试）
app.post('/api/mcp/:service/:tool', async (req, res) => {
  try {
    const { service, tool } = req.params;
    const args = req.body;
    
    const result = await MCPService.callTool(service, tool, args);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    models: ModelManager.getAvailableModels()
  });
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`🚀 Crypto AI Analyzer running on port ${config.port}`);
  console.log(`📊 Available models: ${ModelManager.getAvailableModels().join(', ')}`);
  console.log(`🔗 Open http://localhost:${config.port}`);
});
