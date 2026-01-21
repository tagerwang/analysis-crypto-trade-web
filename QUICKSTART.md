# 快速开始指南

## 5分钟部署

### 步骤1：准备API密钥

在开始之前，你需要获取AI模型的API密钥：

#### DeepSeek（必需）
1. 访问 https://platform.deepseek.com/
2. 注册/登录账号
3. 进入API Keys页面
4. 创建新的API Key
5. 复制保存（格式：`sk-xxxxxxxx`）

#### 千问（可选）
1. 访问 https://dashscope.aliyun.com/
2. 注册/登录阿里云账号
3. 开通DashScope服务
4. 创建API Key
5. 复制保存

### 步骤2：一键部署

```bash
# 进入项目目录
cd analysis-crypto-trade-web

# 运行部署脚本
./deploy.sh
```

按照提示输入：
- DeepSeek API Key（必填）
- 千问 API Key（可选，直接回车跳过）
- 端口号（默认3000，直接回车使用默认值）
- 历史记录保留天数（默认30天）

### 步骤3：访问应用

部署完成后，在浏览器中打开：
```
http://localhost:3000
```

## 使用示例

### 基础查询

**查询价格**
```
BTC当前价格是多少？
ETH/USDT的价格
```

**查看行情**
```
BTC的24小时行情
显示ETH的涨跌幅
```

### 技术分析

**综合分析**
```
分析BTC的技术指标
ETH的技术面如何？
```

**K线形态**
```
BTC最近的K线形态
分析ETH的蜡烛图
```

### 市场数据

**热门币种**
```
当前热门币种有哪些？
最近涨幅最大的币
```

**资金费率**
```
BTC的资金费率是多少？
查看ETH的合约资金费率
```

**搜索代币**
```
搜索Solana相关信息
查询AVAX的详细数据
```

## 常见问题

### Q: 如何切换AI模型？

A: 在页面右上角的下拉菜单中选择：
- 自动切换：系统根据响应速度自动选择
- DeepSeek：使用DeepSeek模型
- 千问：使用千问模型

### Q: 历史记录保存在哪里？

A: 保存在 `storage/chats/` 目录下，按日期分类存储。

### Q: 如何清理历史记录？

A: 系统会自动清理超过保留期限的记录（默认30天）。
手动清理：删除 `storage/chats/` 下的对应日期文件夹。

### Q: 服务如何重启？

A: 使用PM2命令：
```bash
pm2 restart crypto-ai-analyzer
```

### Q: 如何查看日志？

A: 
```bash
# 实时日志
pm2 logs crypto-ai-analyzer

# 查看最近100行
pm2 logs crypto-ai-analyzer --lines 100

# 只看错误日志
pm2 logs crypto-ai-analyzer --err
```

### Q: 端口被占用怎么办？

A: 
1. 查看占用端口的进程：`lsof -i :3000`
2. 停止该进程或在部署时选择其他端口

### Q: AI响应很慢？

A: 
1. 检查网络连接
2. 尝试切换到其他AI模型
3. 查看服务器日志排查问题

### Q: MCP数据获取失败？

A: 
1. 检查网络是否能访问MCP服务URL
2. 查看 `.env` 中的MCP配置是否正确
3. 尝试直接访问MCP服务测试连通性

## 高级配置

### 修改端口

编辑 `.env` 文件：
```env
PORT=8080
```

然后重启服务：
```bash
pm2 restart crypto-ai-analyzer
```

### 调整历史记录保留时间

编辑 `.env` 文件：
```env
RETENTION_DAYS=60  # 保留60天
```

### 添加更多AI模型

编辑 `src/models/AIProvider.js`，参考现有代码添加新模型。

### 自定义系统提示词

编辑 `src/services/ChatService.js` 中的 `buildSystemPrompt()` 方法。

## 移动端使用

应用完全支持移动端访问：

1. 确保手机和服务器在同一网络
2. 在手机浏览器中访问：`http://服务器IP:3000`
3. 点击左上角菜单图标打开历史记录
4. 支持手势操作：右滑打开侧边栏，左滑关闭

## 生产环境部署

### 使用Nginx反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 配置HTTPS

使用Let's Encrypt获取免费SSL证书：
```bash
sudo certbot --nginx -d your-domain.com
```

### 设置防火墙

```bash
# 允许HTTP/HTTPS
sudo ufw allow 80
sudo ufw allow 443

# 如果直接访问应用端口
sudo ufw allow 3000
```

## 性能优化

### 调整缓存时间

编辑 `src/services/MCPService.js`：
```javascript
this.cache = new NodeCache({ stdTTL: 300 }); // 5分钟缓存
```

### 限制会话大小

编辑 `.env`：
```env
MAX_CHAT_SIZE_MB=5  # 限制为5MB
```

### 使用PM2集群模式

编辑 `ecosystem.config.cjs`：
```javascript
instances: 'max',  // 使用所有CPU核心
exec_mode: 'cluster'
```

## 故障恢复

### 服务崩溃自动重启

PM2会自动重启崩溃的服务，无需手动干预。

### 备份历史记录

```bash
# 备份
tar -czf chats-backup-$(date +%Y%m%d).tar.gz storage/chats/

# 恢复
tar -xzf chats-backup-20240120.tar.gz
```

### 重置应用

```bash
# 停止服务
pm2 stop crypto-ai-analyzer

# 清理数据
rm -rf storage/chats/*
rm -rf logs/*

# 重启服务
pm2 restart crypto-ai-analyzer
```

## 获取帮助

- 查看完整文档：`README.md`
- 查看产品需求：`产品文档.md`
- 查看AI模型参考：`ai-models.md`
- 提交Issue：GitHub Issues

---

**祝使用愉快！** 🚀
