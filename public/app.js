class CryptoAIApp {
  constructor() {
    this.currentSessionId = null;
    this.currentModel = 'auto';
    this.isLoading = false;
    
    this.initElements();
    this.bindEvents();
    this.loadSessions();
    this.loadModels();
  }

  initElements() {
    this.sidebar = document.getElementById('sidebar');
    this.menuToggle = document.getElementById('menuToggle');
    this.newChatBtn = document.getElementById('newChatBtn');
    this.sessionsList = document.getElementById('sessionsList');
    this.modelSelect = document.getElementById('modelSelect');
    this.chatContainer = document.getElementById('chatContainer');
    this.welcomeMessage = document.getElementById('welcomeMessage');
    this.messages = document.getElementById('messages');
    this.messageInput = document.getElementById('messageInput');
    this.sendBtn = document.getElementById('sendBtn');
  }

  bindEvents() {
    // 菜单切换
    this.menuToggle.addEventListener('click', () => {
      this.sidebar.classList.toggle('open');
    });

    // 新对话
    this.newChatBtn.addEventListener('click', () => {
      this.startNewChat();
    });

    // 模型切换
    this.modelSelect.addEventListener('change', (e) => {
      this.switchModel(e.target.value);
    });

    // 发送消息
    this.sendBtn.addEventListener('click', () => {
      this.sendMessage();
    });

    // 输入框自动调整高度
    this.messageInput.addEventListener('input', () => {
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
    });

    // 回车发送（Shift+Enter换行）
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // 快捷按钮
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-btn')) {
        const prompt = e.target.dataset.prompt;
        this.messageInput.value = prompt;
        this.sendMessage();
      }
    });

    // 点击外部关闭侧边栏（移动端）
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && 
          this.sidebar.classList.contains('open') &&
          !this.sidebar.contains(e.target) &&
          !this.menuToggle.contains(e.target)) {
        this.sidebar.classList.remove('open');
      }
    });
  }

  async loadModels() {
    try {
      const response = await fetch('./api/models');
      const data = await response.json();
      
      this.modelSelect.innerHTML = '';
      data.available.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = this.getModelDisplayName(model);
        this.modelSelect.appendChild(option);
      });
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  }

  getModelDisplayName(model) {
    const names = {
      'auto': '自动切换',
      'deepseek': 'DeepSeek',
      'qwen': '千问'
    };
    return names[model] || model;
  }

  async switchModel(model) {
    try {
      const response = await fetch('./api/model/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      
      const data = await response.json();
      if (data.success) {
        this.currentModel = model;
        this.showNotification(`已切换到${this.getModelDisplayName(model)}`);
      }
    } catch (error) {
      console.error('Failed to switch model:', error);
    }
  }

  async loadSessions() {
    try {
      const response = await fetch('./api/sessions');
      const data = await response.json();
      
      if (data.success) {
        this.renderSessions(data.sessions);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }

  renderSessions(sessions) {
    this.sessionsList.innerHTML = '';
    
    if (sessions.length === 0) {
      this.sessionsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">暂无历史记录</div>';
      return;
    }

    const grouped = this.groupSessionsByDate(sessions);
    
    Object.entries(grouped).forEach(([date, items]) => {
      const group = document.createElement('div');
      group.className = 'session-group';
      
      const header = document.createElement('div');
      header.className = 'session-group-header';
      header.textContent = this.formatDateGroup(date);
      header.style.cssText = 'padding: 8px 12px; font-size: 11px; color: var(--text-secondary); font-weight: 600;';
      group.appendChild(header);
      
      items.forEach(session => {
        const item = document.createElement('div');
        item.className = 'session-item';
        if (session.sessionId === this.currentSessionId) {
          item.classList.add('active');
        }
        
        item.innerHTML = `
          <div class="session-date">${new Date(session.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
          <div class="session-preview">${session.lastMessage || '新对话'}</div>
        `;
        
        item.addEventListener('click', () => {
          this.loadSession(session.sessionId);
        });
        
        group.appendChild(item);
      });
      
      this.sessionsList.appendChild(group);
    });
  }

  groupSessionsByDate(sessions) {
    const grouped = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    sessions.forEach(session => {
      const date = new Date(session.updatedAt).toDateString();
      let key;
      
      if (date === today) {
        key = 'today';
      } else if (date === yesterday) {
        key = 'yesterday';
      } else {
        key = session.date;
      }
      
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(session);
    });
    
    return grouped;
  }

  formatDateGroup(date) {
    if (date === 'today') return '今天';
    if (date === 'yesterday') return '昨天';
    return date;
  }

  async loadSession(sessionId) {
    try {
      const response = await fetch(`./api/session/${sessionId}`);
      const data = await response.json();
      
      if (data.success) {
        this.currentSessionId = sessionId;
        this.messages.innerHTML = '';
        this.welcomeMessage.style.display = 'none';
        
        data.messages.forEach(msg => {
          this.addMessage(msg.role, msg.content, msg.model);
        });
        
        this.updateActiveSession();
        this.scrollToBottom();
        
        // 移动端关闭侧边栏
        if (window.innerWidth <= 768) {
          this.sidebar.classList.remove('open');
        }
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  }

  startNewChat() {
    this.currentSessionId = null;
    this.messages.innerHTML = '';
    this.welcomeMessage.style.display = 'block';
    this.updateActiveSession();
    this.messageInput.focus();
    
    // 移动端关闭侧边栏
    if (window.innerWidth <= 768) {
      this.sidebar.classList.remove('open');
    }
  }

  updateActiveSession() {
    document.querySelectorAll('.session-item').forEach(item => {
      item.classList.remove('active');
    });
  }

  async sendMessage() {
    const message = this.messageInput.value.trim();
    if (!message || this.isLoading) return;

    // 隐藏欢迎消息
    this.welcomeMessage.style.display = 'none';

    // 添加用户消息
    this.addMessage('user', message);
    this.messageInput.value = '';
    this.messageInput.style.height = 'auto';

    // 显示加载状态
    this.showLoading();
    this.isLoading = true;
    this.sendBtn.disabled = true;

    try {
      const response = await fetch('./api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.currentSessionId,
          message,
          model: this.currentModel
        })
      });

      // 检查HTTP状态
      if (!response.ok) {
        throw new Error(`服务器错误 (${response.status})`);
      }

      // 检查响应类型
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('非JSON响应:', text.substring(0, 200));
        throw new Error('服务器返回了非JSON响应，请稍后重试');
      }

      const data = await response.json();

      if (data.success) {
        this.currentSessionId = data.sessionId;
        this.hideLoading();
        this.addMessage('assistant', data.message.content, data.model);
        this.loadSessions(); // 刷新会话列表
      } else {
        throw new Error(data.error || '未知错误');
      }
    } catch (error) {
      this.hideLoading();
      console.error('Chat error:', error);
      
      let errorMessage = error.message;
      if (error.message.includes('JSON')) {
        errorMessage = '服务器响应异常，请稍后重试';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = '网络连接失败，请检查网络';
      }
      
      this.addMessage('assistant', `❌ 错误：${errorMessage}`, 'error');
    } finally {
      this.isLoading = false;
      this.sendBtn.disabled = false;
      this.messageInput.focus();
    }
  }

  addMessage(role, content, model = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    let headerHTML = '';
    if (role === 'assistant' && model && model !== 'error') {
      headerHTML = `
        <div class="message-header">
          <span class="message-role">AI助手</span>
          <span class="message-model">${this.getModelDisplayName(model)}</span>
        </div>
      `;
    } else if (role === 'user') {
      headerHTML = `
        <div class="message-header">
          <span class="message-role">我</span>
        </div>
      `;
    }
    
    messageDiv.innerHTML = `
      ${headerHTML}
      <div class="message-content">${this.formatContent(content)}</div>
    `;
    
    this.messages.appendChild(messageDiv);
    this.scrollToBottom();
  }

  formatContent(content) {
    // 使用 marked.js 渲染 Markdown
    if (typeof marked !== 'undefined') {
      // 配置 marked
      marked.setOptions({
        breaks: true,  // 支持 GFM 换行
        gfm: true,     // 启用 GitHub Flavored Markdown
        tables: true,  // 支持表格
        sanitize: false,
        headerIds: false,
        mangle: false
      });
      
      try {
        return marked.parse(content);
      } catch (e) {
        console.error('Markdown 解析错误:', e);
        return content.replace(/\n/g, '<br>');
      }
    }
    
    // 降级方案：简单的格式化
    let formatted = content
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    
    return formatted;
  }

  showLoading() {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-indicator';
    loadingDiv.id = 'loadingIndicator';
    loadingDiv.innerHTML = `
      <div class="loading-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span>AI正在思考...</span>
    `;
    this.messages.appendChild(loadingDiv);
    this.scrollToBottom();
  }

  hideLoading() {
    const loading = document.getElementById('loadingIndicator');
    if (loading) {
      loading.remove();
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }, 100);
  }

  showNotification(message) {
    // 简单的通知实现
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      padding: 12px 20px;
      border-radius: 8px;
      border: 1px solid var(--border);
      z-index: 9999;
      animation: fadeIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  new CryptoAIApp();
});
