class CryptoAIApp {
  constructor() {
    this.currentSessionId = null;
    this.isLoading = false;
    this.userScrolling = false; // 跟踪用户是否在手动滚动
    this.scrollTimeout = null;
    
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
    this.currentModel = 'auto';
    // this.switchModel(this.currentModel);
    // this.modelSelect.value = this.currentModel;
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
        
        // 百度统计 - 追踪快捷按钮
        if (window._hmt) {
          _hmt.push(['_trackEvent', 'quick_button', 'click', prompt]);
        }
        
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

    // 检测用户滚动行为
    let lastScrollTop = 0;
    this.chatContainer.addEventListener('scroll', () => {
      const currentScrollTop = this.chatContainer.scrollTop;
      const scrollHeight = this.chatContainer.scrollHeight;
      const clientHeight = this.chatContainer.clientHeight;
      const distanceFromBottom = scrollHeight - currentScrollTop - clientHeight;
      
      // 如果用户向上滚动（查看历史内容），标记为用户滚动
      if (currentScrollTop < lastScrollTop) {
        this.userScrolling = true;
        // 清除之前的定时器
        if (this.scrollTimeout) {
          clearTimeout(this.scrollTimeout);
          this.scrollTimeout = null;
        }
      }
      
      // 如果用户滚动到底部附近（50px内），恢复自动滚动
      if (distanceFromBottom < 50) {
        this.userScrolling = false;
        if (this.scrollTimeout) {
          clearTimeout(this.scrollTimeout);
          this.scrollTimeout = null;
        }
      }
      
      lastScrollTop = currentScrollTop;
    });
  }

  async loadModels() {
    try {
      const response = await fetch('./crypto-ai-api/models');
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
      const response = await fetch('./crypto-ai-api/model/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, sessionId: this.currentSessionId })
      });
      
      const data = await response.json();
      if (data.success) {
        this.currentModel = model;
        this.showNotification(`已切换到${this.getModelDisplayName(model)}`);
        
        // 百度统计 - 追踪模型切换
        if (window._hmt) {
          _hmt.push(['_trackEvent', 'model', 'switch', model]);
        }
      }
    } catch (error) {
      console.error('Failed to switch model:', error);
    }
  }

  async loadSessions() {
    try {
      const response = await fetch('./crypto-ai-api/sessions');
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
      const response = await fetch(`./crypto-ai-api/session/${sessionId}`);
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

    // 百度统计 - 追踪消息发送
    if (window._hmt) {
      _hmt.push(['_trackEvent', 'chat', 'send_message', this.currentModel, message.length]);
    }

    // 隐藏欢迎消息
    this.welcomeMessage.style.display = 'none';

    // 添加用户消息
    this.addMessage('user', message);
    this.messageInput.value = '';
    this.messageInput.style.height = 'auto';

    // 显示加载状态
    this.isLoading = true;
    this.sendBtn.disabled = true;

    // 创建AI消息容器
    const aiMessageDiv = this.createStreamingMessage();

    try {
      const response = await fetch('./crypto-ai-api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.currentSessionId,
          message,
          model: this.currentModel,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`服务器错误 (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let currentModel = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'start') {
              this.currentSessionId = data.sessionId;
            } else if (data.type === 'content') {
              fullContent += data.content;
              currentModel = data.model;
              this.updateStreamingMessage(aiMessageDiv, fullContent, currentModel);
            } else if (data.type === 'tool_start') {
              this.showToolIndicator(aiMessageDiv, '正在分析数据...');
            } else if (data.type === 'tool_done') {
              this.hideToolIndicator(aiMessageDiv);
            } else if (data.type === 'done') {
              this.finalizeStreamingMessage(aiMessageDiv, currentModel);
            } else if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (e) {
            console.error('Parse error:', e, line);
          }
        }
      }

      this.loadSessions(); // 刷新会话列表
    } catch (error) {
      console.error('Chat error:', error);
      
      // 百度统计 - 追踪错误
      if (window._hmt) {
        _hmt.push(['_trackEvent', 'error', 'chat_error', error.message]);
      }
      
      let errorMessage = error.message;
      let errorType = 'error';
      
      // 友好的错误提示
      if (error.message.includes('Failed to fetch')) {
        errorMessage = '网络连接失败，请检查网络';
      } else if (error.message.includes('余额不足') || error.message.includes('账户欠费')) {
        // API 余额相关错误，使用警告样式
        errorType = 'warning';
        errorMessage = error.message + '\n\n💡 建议：\n• 访问 API 控制台充值\n• 或切换到其他模型继续使用';
      }
      
      aiMessageDiv.remove();
      this.addMessage('assistant', `❌ ${errorMessage}`, errorType);
    } finally {
      this.isLoading = false;
      this.sendBtn.disabled = false;
      // 移动端不自动聚焦（避免弹出键盘）
      if (window.innerWidth > 768) {
        this.messageInput.focus();
      }
    }
  }

  createStreamingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant streaming';
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-role">AI助手</span>
        <span class="message-model"></span>
      </div>
      <div class="message-content"></div>
      <div class="tool-indicator" style="display: none;">
        <div class="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span class="tool-text"></span>
      </div>
    `;
    this.messages.appendChild(messageDiv);
    this.scrollToBottom();
    return messageDiv;
  }

  updateStreamingMessage(messageDiv, content, model) {
    const contentDiv = messageDiv.querySelector('.message-content');
    const modelSpan = messageDiv.querySelector('.message-model');
    
    contentDiv.innerHTML = this.formatContent(content);
    if (model) {
      modelSpan.textContent = this.getModelDisplayName(model);
    }
    
    // 只在用户没有手动滚动时自动滚动
    if (!this.userScrolling) {
      this.scrollToBottom();
    }
  }

  showToolIndicator(messageDiv, text) {
    const indicator = messageDiv.querySelector('.tool-indicator');
    const textSpan = messageDiv.querySelector('.tool-text');
    indicator.style.display = 'flex';
    textSpan.textContent = text;
  }

  hideToolIndicator(messageDiv) {
    const indicator = messageDiv.querySelector('.tool-indicator');
    indicator.style.display = 'none';
  }

  finalizeStreamingMessage(messageDiv, model) {
    messageDiv.classList.remove('streaming');
    // 输出完成后不自动聚焦输入框（避免弹出键盘）
    // this.messageInput.focus(); // 移除自动聚焦
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
    // 在 TOOL_CALL 后强制添加换行符（如果后面不是换行符的话）
    content = content.replace(/(\[TOOL_CALL:[^\]]+\])(?!\n)/g, '$1\n');
    // 🔒 客户端脱敏：移除所有工具调用信息，不向用户展示
    // content = content.replace(/\[TOOL_CALL:[^\]]+\]\n?/g, '');

    // 使用 marked.js 渲染 Markdown
    if (typeof marked !== 'undefined' && marked.parse) {
      try {
        // 配置 marked
        if (marked.setOptions) {
          marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false,
            mangle: false
          });
        }
        
        const html = marked.parse(content);
        return html;
      } catch (e) {
        console.error('Markdown 解析错误:', e);
        return this.fallbackFormat(content);
      }
    }
    
    console.warn('marked.js 未加载，使用降级方案');
    return this.fallbackFormat(content);
  }

  fallbackFormat(content) {
    // 降级方案：简单的格式化
    let formatted = content;
    
    // 1. 处理表格（必须在其他处理之前）
    formatted = this.formatTable(formatted);
    
    // 2. 代码块
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    
    // 3. 行内代码
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 4. 粗体
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 5. 斜体
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // 6. 标题
    formatted = formatted.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // 7. 列表
    formatted = formatted.replace(/^\- (.*$)/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>.*?<\/li>\n?)+/gs, '<ul>$&</ul>');
    
    // 8. 段落和换行
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }

  formatTable(content) {
    // 匹配 Markdown 表格
    const tableRegex = /\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g;
    
    return content.replace(tableRegex, (match, header, rows) => {
      // 处理表头
      const headers = header.split('|').map(h => h.trim()).filter(h => h);
      const headerHTML = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
      
      // 处理表格行
      const rowsArray = rows.trim().split('\n');
      const rowsHTML = rowsArray.map(row => {
        const cells = row.split('|').map(c => c.trim()).filter(c => c);
        return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
      }).join('');
      
      return `<table><thead>${headerHTML}</thead><tbody>${rowsHTML}</tbody></table>`;
    });
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
    // 使用 requestAnimationFrame 优化滚动性能
    requestAnimationFrame(() => {
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    });
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
