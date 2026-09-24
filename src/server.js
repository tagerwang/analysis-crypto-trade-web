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

// ============ Casdoor OIDC 登录 ============
// 未登录跳 Casdoor 登录页（含注册），回调带 code，后端换 token，前端存 localStorage
const CASDOOR = {
  origin: process.env.CASDOOR_ORIGIN || '',
  // 服务端内部调用走本机回环（node 在 proxychains 下 127.0.0.1 直连，公网地址会被代理）
  internalOrigin: process.env.CASDOOR_INTERNAL_ORIGIN || 'http://127.0.0.1:8000',
  clientId: process.env.CASDOOR_CLIENT_ID || '',
  clientSecret: process.env.CASDOOR_CLIENT_SECRET || ''
};

function casdoorConfigured() {
  return !!(CASDOOR.clientId && CASDOOR.clientSecret);
}

function requireOAuthConfig(_req, res, next) {
  if (!casdoorConfigured()) {
    res.status(503).json({ success: false, message: '登录服务未配置' });
    return;
  }
  next();
}

/** 前端获取 OIDC 参数（clientId 公开可下发，secret 不下发） */
app.get('/crypto-ai-api/auth/config', (req, res) => {
  if (!casdoorConfigured()) {
    return res.status(503).json({ success: false, message: '登录服务未配置', loginPageBaseUrl: null });
  }
  res.json({
    success: true,
    loginPageBaseUrl: `${CASDOOR.origin}/login/oauth/authorize`,
    clientId: CASDOOR.clientId
  });
});

/** 用 code 换 token，并拉取用户信息一并返回 */
app.post('/crypto-ai-api/auth/exchange-code', requireOAuthConfig, async (req, res) => {
  try {
    const code = req.body?.code || req.body?.auth_code;
    const redirect_uri = req.body?.redirect_uri;
    if (!code || !redirect_uri) {
      return res.status(400).json({ success: false, message: '缺少 code 或 redirect_uri' });
    }
    const tokenUrl = `${CASDOOR.internalOrigin}/api/login/oauth/access_token`;
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CASDOOR.clientId,
        client_secret: CASDOOR.clientSecret,
        code,
        redirect_uri
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(401).json({ success: false, message: tokenData.error_description || '换码失败' });
    }
    const uiRes = await fetch(`${CASDOOR.internalOrigin}/api/userinfo`, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const ui = await uiRes.json();
    if (!ui || ui.error) {
      return res.status(401).json({ success: false, message: '获取用户信息失败' });
    }
    res.json({
      success: true,
      token: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      data: {
        id: ui.sub || ui.id || ui.name,
        nickname: ui.name || ui.preferred_username || ui.sub,
        email: ui.email || '',
        avatar: ui.picture || ui.avatar || ''
      }
    });
  } catch (err) {
    console.error('Casdoor exchange-code error:', err);
    res.status(500).json({ success: false, message: err?.message || '登录失败' });
  }
});

/** 校验 token 是否仍有效（用于刷新页面时） */
app.post('/crypto-ai-api/auth/verify-token', requireOAuthConfig, async (req, res) => {
  try {
    const token = req.body?.token;
    if (!token) {
      return res.status(400).json({ success: false, message: '缺少 token 参数' });
    }
    const uiRes = await fetch(`${CASDOOR.internalOrigin}/api/userinfo`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!uiRes.ok) {
      return res.json({ success: false, message: 'token 已失效' });
    }
    const ui = await uiRes.json();
    if (!ui || ui.error) {
      return res.json({ success: false, message: 'token 已失效' });
    }
    res.json({
      success: true,
      data: {
        id: ui.sub || ui.id || ui.name,
        nickname: ui.name || ui.preferred_username || ui.sub,
        email: ui.email || '',
        avatar: ui.picture || ui.avatar || ''
      }
    });
  } catch (err) {
    console.error('Casdoor verify-token error:', err);
    res.status(500).json({ success: false, message: err?.message || '验证失败' });
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
app.listen(config.port, process.env.HOST || '127.0.0.1', () => {
  console.log(`🚀 Crypto AI Analyzer running on port ${config.port}`);
  console.log(`📊 Available models: ${ModelManager.getAvailableModels().join(', ')}`);
  console.log(`🔗 Open http://localhost:${config.port}`);
  const mcpUrls = config.mcp && typeof config.mcp === 'object' ? Object.entries(config.mcp).map(([k, v]) => `${k}=${v}`).join(', ') : 'none';
  console.log(`🔌 MCP: ${mcpUrls}`);
});
