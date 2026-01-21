# 项目总览

## 📁 项目结构

```
analysis-crypto-trade-web/
│
├── 📄 配置文件
│   ├── package.json              # 项目依赖和脚本
│   ├── .env.example              # 环境变量模板
│   ├── .gitignore                # Git忽略规则
│   └── ecosystem.config.cjs      # PM2配置（部署后生成）
│
├── 📜 文档
│   ├── README.md                 # 完整项目文档
│   ├── QUICKSTART.md             # 快速开始指南
│   ├── PROJECT_OVERVIEW.md       # 本文件
│   ├── 产品文档.md               # 产品需求文档
│   └── ai-models.md              # AI模型接入参考
│
├── 🚀 部署脚本
│   ├── deploy.sh                 # 一键部署脚本
│   └── test-setup.sh             # 配置检查脚本
│
├── 🖥️ 后端代码 (src/)
│   ├── server.js                 # Express服务器入口
│   │
│   ├── config/
│   │   └── index.js              # 配置管理（环境变量、API配置）
│   │
│   ├── models/
│   │   └── AIProvider.js         # AI模型管理（DeepSeek、千问、自动切换）
│   │
│   └── services/
│       ├── ChatService.js        # 对话服务（会话管理、消息处理）
│       ├── MCPService.js         # MCP数据服务（Binance、CoinGecko等）
│       └── StorageService.js     # 存储服务（历史记录、自动清理）
│
├── 🎨 前端代码 (public/)
│   ├── index.html                # 主页面结构
│   ├── styles.css                # 样式文件（暗色主题、响应式）
│   └── app.js                    # 前端逻辑（对话交互、会话管理）
│
└── 💾 数据存储 (运行时生成)
    ├── storage/chats/            # 对话历史（按日期分类）
    └── logs/                     # 应用日志
```

## 🏗️ 架构设计

### 技术栈

**后端**
- Node.js 18+
- Express.js（Web框架）
- node-cache（内存缓存）
- dotenv（环境变量管理）

**前端**
- 原生HTML/CSS/JavaScript（无框架）
- 响应式设计（移动端适配）
- 暗色主题

**部署**
- PM2（进程管理）
- Nginx（可选，反向代理）

### 数据流

```
用户输入
    ↓
前端 (app.js)
    ↓
API接口 (/api/chat)
    ↓
ChatService（会话管理）
    ↓
ModelManager（选择AI模型）
    ↓
AI模型API（DeepSeek/千问）
    ↓
返回AI回复
    ↓
StorageService（保存历史）
    ↓
前端展示
```

### MCP数据集成

```
AI需要数据
    ↓
MCPService.callTool()
    ↓
HTTP请求到MCP服务
    ├── Binance MCP
    ├── CoinGecko MCP
    └── Crypto.com MCP
    ↓
返回数据（带缓存）
    ↓
AI分析整合
    ↓
返回给用户
```

## 🔑 核心功能模块

### 1. AI模型管理 (AIProvider.js)

**功能**
- 多模型支持（DeepSeek、千问）
- 自动模型选择（基于延迟和成功率）
- 性能统计和监控
- 失败自动重试和切换

**关键方法**
```javascript
ModelManager.chat(messages, options)     // 发送对话
ModelManager.setMode(mode)               // 切换模式
ModelManager.selectModel(prompt)         // 自动选择模型
```

### 2. 对话服务 (ChatService.js)

**功能**
- 会话管理（创建、加载、删除）
- 消息历史维护
- 系统提示词构建
- 上下文管理（保留最近10条）

**关键方法**
```javascript
ChatService.chat(sessionId, message)     // 发送消息
ChatService.loadSession(sessionId)       // 加载会话
ChatService.listSessions()               // 获取会话列表
```

### 3. MCP数据服务 (MCPService.js)

**功能**
- 统一的MCP调用接口
- 自动缓存（1分钟TTL）
- 错误处理和重试
- 便捷方法封装

**关键方法**
```javascript
MCPService.callTool(service, tool, args) // 通用调用
MCPService.getBinancePrice(symbol)       // 获取价格
MCPService.getCoinGeckoTrending()        // 热门币种
```

### 4. 存储服务 (StorageService.js)

**功能**
- 按日期分类存储
- 自动清理过期记录
- 会话列表管理
- 文件大小控制

**关键方法**
```javascript
StorageService.saveChat(sessionId, msgs) // 保存会话
StorageService.loadChat(sessionId)       // 加载会话
StorageService.cleanup()                 // 清理过期数据
```

## 🔌 API接口

### 对话相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 发送消息 |
| `/api/sessions` | GET | 获取会话列表 |
| `/api/session/:id` | GET | 加载指定会话 |
| `/api/session/:id` | DELETE | 删除会话 |

### 模型管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/models` | GET | 获取可用模型 |
| `/api/model/switch` | POST | 切换模型 |

### 工具接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/mcp/:service/:tool` | POST | 直接调用MCP工具 |
| `/health` | GET | 健康检查 |

## 🎯 设计原则

### 1. 精简高效
- 无框架依赖，原生实现
- 代码层次清晰，易于维护
- 最小化文件数量

### 2. 可扩展性
- 模块化设计，职责分离
- 易于添加新的AI模型
- 易于集成新的数据源

### 3. 用户体验
- 响应式设计，移动端友好
- 暗色主题，护眼舒适
- 实时反馈，加载状态明确

### 4. 生产就绪
- PM2进程管理
- 自动重启和日志
- 错误处理和降级
- 数据持久化

## 📊 性能优化

### 缓存策略
- MCP数据：1分钟内存缓存
- 会话数据：文件系统持久化
- 静态资源：浏览器缓存

### 资源控制
- 单会话最大10MB
- 上下文保留最近10条消息
- 自动清理过期数据

### 并发处理
- 支持PM2集群模式
- 异步非阻塞I/O
- 请求超时控制

## 🔒 安全考虑

### 数据安全
- API密钥存储在.env（不提交Git）
- 会话数据本地存储
- 支持HTTPS部署

### 输入验证
- 消息长度限制
- 参数类型检查
- SQL注入防护（无数据库）

### 错误处理
- 友好的错误提示
- 详细的日志记录
- 自动降级策略

## 🚀 部署流程

### 开发环境
```bash
npm install
cp .env.example .env
# 编辑.env填入API密钥
npm run dev
```

### 生产环境
```bash
./deploy.sh
# 按提示输入配置
# 自动安装依赖、配置PM2、启动服务
```

### Docker部署（可选）
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

## 📈 监控和维护

### 日志管理
- 应用日志：`logs/out.log`
- 错误日志：`logs/error.log`
- PM2日志：`~/.pm2/logs/`

### 性能监控
```bash
pm2 monit                    # 实时监控
pm2 status                   # 查看状态
pm2 logs --lines 100         # 查看日志
```

### 数据维护
- 自动清理：每天凌晨2点
- 手动清理：删除`storage/chats/`下的旧文件
- 备份：定期备份`storage/`目录

## 🔄 版本更新

### 更新代码
```bash
git pull origin main
npm install
pm2 restart crypto-ai-analyzer
```

### 数据迁移
- 会话数据格式兼容
- 配置文件向后兼容
- 平滑升级，无需停机

## 🤝 贡献指南

### 代码规范
- 使用ES6+语法
- 遵循现有代码风格
- 添加必要的注释
- 保持函数简洁

### 提交流程
1. Fork项目
2. 创建功能分支
3. 提交代码
4. 发起Pull Request

### 测试要求
- 确保现有功能正常
- 添加新功能的测试
- 验证移动端兼容性

## 📞 支持

- 文档：查看README.md和QUICKSTART.md
- 问题：提交GitHub Issue
- 讨论：GitHub Discussions

---

**项目状态**: ✅ 生产就绪  
**最后更新**: 2024-01-20  
**维护者**: [Your Name]
