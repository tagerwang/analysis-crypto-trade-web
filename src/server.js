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

// 基础路径：若部署在 /crypto-ai 下，Nginx 可能把完整路径透传，此处统一剥掉前缀以便路由匹配
const basePath = config.basePath || '';
if (basePath) {
  app.use((req, res, next) => {
    if (req.path === basePath || req.path.startsWith(basePath + '/')) {
      const rest = req.path.slice(basePath.length) || '/';
      const q = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      req.url = rest + q;
    }
    next();
  });
}

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 生成会话ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// API路由 - 流式输出
app.post('/crypto-ai-api/chat', async (req, res) => {
  try {
    const { sessionId, message, model, stream = true } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const sid = sessionId || generateSessionId();
    
    // 设置模型模式
    if (model) {
      ModelManager.setMode(model);
    }

    // 如果请求流式输出
    if (stream) {
      // 设置SSE响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // 禁用nginx缓冲

      // 发送初始事件
      res.write(`data: ${JSON.stringify({ type: 'start', sessionId: sid })}\n\n`);

      // 流式处理
      await ChatService.chatStream(sid, message, (chunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });

      // 发送结束事件
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } else {
      // 非流式输出（保持兼容）
      const result = await ChatService.chat(sid, message);
      res.json({
        success: true,
        ...result
      });
    }
  } catch (error) {
    console.error('Chat error:', error);
    if (req.body.stream) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

// 切换模型
app.post('/crypto-ai-api/model/switch', (req, res) => {
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
app.get('/crypto-ai-api/models', (req, res) => {
  res.json({
    available: ['auto', ...ModelManager.getAvailableModels()],
    stats: ModelManager.getStats()
  });
});

// 获取会话历史
app.get('/crypto-ai-api/sessions', async (req, res) => {
  try {
    const sessions = await ChatService.listSessions();
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 加载会话
app.get('/crypto-ai-api/session/:id', async (req, res) => {
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
app.delete('/crypto-ai-api/session/:id', async (req, res) => {
  try {
    const success = await ChatService.deleteSession(req.params.id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取币安交易对列表
app.get('/crypto-ai-api/binance/symbols', async (req, res) => {
  try {
    const symbols = await ChatService.fetchBinanceSymbols();
    
    if (symbols) {
      res.json({
        success: true,
        count: symbols.length,
        symbols: symbols,
        cached: ChatService.binanceSymbolsCache !== null,
        cacheTime: ChatService.binanceSymbolsCacheTime 
          ? new Date(ChatService.binanceSymbolsCacheTime).toISOString() 
          : null
      });
    } else {
      res.status(503).json({
        success: false,
        error: '币安API暂时不可用'
      });
    }
  } catch (error) {
    console.error('获取币安交易对失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取可用的 MCP 工具列表（OpenAI 格式）
app.get('/crypto-ai-api/mcp/tools', async (req, res) => {
  try {
    const tools = await MCPService.getAllToolsOpenAIFormat();
    res.json({ 
      success: true, 
      count: tools.length, 
      tools 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// MCP工具调用（可选，用于直接测试）
app.post('/crypto-ai-api/mcp/:service/:tool', async (req, res) => {
  try {
    const { service, tool } = req.params;
    const args = req.body;
    
    const result = await MCPService.callTool(service, tool, args);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ OAuth 登录代理（转发到 oauth-center）============
const OAUTH_BASE = config.oauthCenterBaseUrl;

function requireOAuthConfig(_req, res, next) {
  if (!OAUTH_BASE) {
    res.status(503).json({ success: false, message: '登录服务未配置' });
    return;
  }
  next();
}

/** 获取登录页基础 URL，供前端拼 redirect_url */
app.get('/crypto-ai-api/auth/config', (req, res) => {
  if (!OAUTH_BASE) {
    return res.status(503).json({ success: false, message: '登录服务未配置', loginPageBaseUrl: null });
  }
  res.json({ success: true, loginPageBaseUrl: OAUTH_BASE.replace(/\/$/, '') });
});

/** 用 auth_code + state 换 token */
app.post('/crypto-ai-api/auth/exchange-code', requireOAuthConfig, async (req, res) => {
  try {
    const auth_code = req.body?.auth_code || req.query?.auth_code;
    const state = req.body?.state || req.query?.state;
    if (!auth_code || !state) {
      return res.status(400).json({ success: false, message: '缺少 auth_code 或 state' });
    }
    const url = `${OAUTH_BASE.replace(/\/$/, '')}/api/auth/alipay/exchange-code`;
    const proxyRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code, state })
    });
    const data = await proxyRes.json();
    res.status(proxyRes.status).json(data);
  } catch (err) {
    console.error('Auth exchange-code proxy error:', err);
    res.status(500).json({ success: false, message: err?.message || '兑换授权码失败' });
  }
});

/** 用 token 校验并取用户信息 */
app.post('/crypto-ai-api/auth/verify-token', requireOAuthConfig, async (req, res) => {
  try {
    const token = req.body?.token;
    if (!token) {
      return res.status(400).json({ success: false, message: '缺少 token 参数' });
    }
    const url = `${OAUTH_BASE.replace(/\/$/, '')}/api/auth/verify-token`;
    const proxyRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await proxyRes.json();
    res.status(proxyRes.status).json(data);
  } catch (err) {
    console.error('Auth verify-token proxy error:', err);
    res.status(500).json({ success: false, message: err?.message || '验证 token 失败' });
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
  const mcpUrls = config.mcp && typeof config.mcp === 'object' ? Object.entries(config.mcp).map(([k, v]) => `${k}=${v}`).join(', ') : 'none';
  console.log(`🔌 MCP: ${mcpUrls}`);
});
