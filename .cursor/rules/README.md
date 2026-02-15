# Cursor Rules

本目录包含项目的 AI 规则配置，确保代码质量和安全性。

## 📁 规则列表

### `security-and-privacy.mdc`

**作用**: 自动保护敏感信息，防止 IP、密钥、域名等泄露  
**适用范围**: 所有文件（`alwaysApply: true`）  
**优先级**: ⭐⭐⭐⭐⭐ 最高

AI 会自动：
- 在代码和脚本中使用环境变量而非硬编码
- 在文档中使用 `${变量名}` 替代真实值
- 创建示例时使用占位符（如 `YOUR_SERVER_IP`）
- 脱敏 API 密钥为 `sk-****` 格式

## 🎯 规则生效

规则会在以下情况自动生效：

1. **编写代码时**: AI 会自动使用环境变量
2. **创建文档时**: AI 会使用占位符和变量名
3. **生成脚本时**: AI 会从 `.env` 读取配置
4. **回答问题时**: AI 会提醒使用安全实践

## 💡 如何添加新规则

```bash
# 1. 创建新的 .mdc 文件
touch .cursor/rules/my-new-rule.mdc

# 2. 编辑文件，添加 frontmatter 和内容
nano .cursor/rules/my-new-rule.mdc
```

文件格式：

```markdown
---
description: 规则简短描述
alwaysApply: true  # 或使用 globs: **/*.ts
---

# 规则标题

规则内容...
```

## 🔧 规则管理

### 查看所有规则

```bash
ls -lh .cursor/rules/
```

### 临时禁用规则

重命名文件（添加 `.disabled` 后缀）：

```bash
mv security-and-privacy.mdc security-and-privacy.mdc.disabled
```

### 重新启用规则

```bash
mv security-and-privacy.mdc.disabled security-and-privacy.mdc
```

## 📚 规则最佳实践

1. **保持简洁**: 每个规则 < 50 行
2. **具体示例**: 提供 ✅ 正确和 ❌ 错误的对比
3. **单一职责**: 一个规则只解决一类问题
4. **清晰命名**: 使用描述性的文件名

## 🔗 相关资源

- [Cursor Rules 官方文档](https://docs.cursor.com/context/rules)
- [规则创建技能](@skills/create-rule)
- [安全指南](../README-SECURITY.md)
