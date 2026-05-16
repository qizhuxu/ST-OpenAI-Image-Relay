# ST-OpenAI-Image-Relay v1.0.0 安装与部署指南

## 📦 插件文件结构

```
ST-OpenAI-Image-Relay/
├── index.js          # 主逻辑（1400行）
├── settings.html     # 标签式配置界面（398行）
├── manifest.json     # 扩展清单
├── README.md         # 原始说明
└── LICENSE           # 开源协议
```

## 🚀 安装步骤

### 方式一：SillyTavern 扩展安装器（推荐）
1. 打开 SillyTavern
2. 点击顶部 **扩展安装器**（Extensions Installer）按钮
3. 输入仓库地址：`https://github.com/lumingya/ST-OpenAI-Image-Relay`
4. 点击安装，重启 SillyTavern

### 方式二：手动安装
1. 将 `ST-OpenAI-Image-Relay` 文件夹复制到：
   ```
   SillyTavern/public/scripts/extensions/third-party/ST-OpenAI-Image-Relay/
   ```
2. 确保文件夹内包含 `index.js`、`settings.html`、`manifest.json`
3. 重启 SillyTavern

### 方式三：Git Clone
```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/lumingya/ST-OpenAI-Image-Relay.git
```
然后重启 SillyTavern。

## ✅ 验证安装

1. 启动 SillyTavern
2. 打开左侧面板 → 找到 **「🖼️ 图片中继」** 抽屉
3. 展开后应看到 5 个标签页：📋基础 / ⚙️后端 / 🔍提取 / ✨优化 / 🎨手动

## 🔧 功能配置

### 后端配置
- **API 模式**：选择 `Chat Completions` 或 `Images API`
- 填写服务地址、API 密钥、模型名称
- Images API 模式可配置图片尺寸、数量、响应格式

### 提示词优化
- 在「✨优化」标签页启用提示词优化
- 可配置独立的优化 LLM 后端
- 开启「自动优化」后，自动流程中也会优化提示词

### NSFW 规避
- 在「✨优化」标签页开启 NSFW 规避
- 建议**始终开启**，防止生成不安全内容导致封号

### 手动生图
- 在「🎨手动」标签页输入提示词
- 先点击「✨优化提示词」查看优化效果
- 再点击「🎨生成图片」生成

### 消息生图
- 在「📋基础」标签页开启消息生图按钮
- 每条聊天消息操作栏会出现两个按钮：
  - 🖼️ 直接生图
  - ✨ 总结生图

## 🧪 测试建议

1. 先在「⚙️后端」配置好图片生成服务地址
2. 在「🎨手动」标签页输入简单提示词测试
3. 确认图片生成正常后再开启自动优化和 NSFW 规避
