# AI Dharma Chatbot (Minimal RAG Version)

这是一个基于 **Next.js 16** 构建的极简 AI 问答助手，专注于佛法修行相关的检索增强生成 (RAG)。

项目经过深度精简，移除了原有的 Artifacts 系统、Postgres 数据库和 NextAuth 认证，转变为 **无状态 (Stateless)** 的纯前端 + AI API 架构。

## 🚀 核心特性

- **极简架构**: 纯前端 (Next.js App Router) + 后端 API 路由，无复杂数据库依赖。
- **RAG 引擎**:
    - **向量库**: Qdrant
    - **模型服务**: 阿里云 DashScope (通义千问)
    - **流程**: Query Rewrite (qwen-turbo) -> Embedding (text-embedding-v3) -> Vector Search -> Rerank (gte-rerank) -> Generation (qwen-max)。
- **智能意图路由**: 自动识别“闲聊”与“修行”问题，分流处理，节省 Token。
- **混合流式响应**: 利用 Vercel AI SDK 的 `StreamData`，在单次流式响应中同时返回 **回答文本** 和 **引用来源 (Citations)**。
- **法味人设**: 经过优化的 AI Persona，交流风格更符合佛法修行语境。

## 🛠️ 技术栈

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4
- **AI SDK**: Vercel AI SDK (`@ai-sdk/openai`, `ai`)
- **Backend Services**:
    - **DashScope**: Chat, Embedding, Rerank
    - **Qdrant**: Vector Database

## ⚙️ 环境配置

在使用前，请确保在项目根目录创建 `.env.local` 文件，并配置以下环境变量：

```env
# 阿里云 DashScope (通义千问)
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Qdrant 向量数据库
QDRANT_URL=https://your-qdrant-instance.com
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=segments_zh
QDRANT_VECTOR_NAME=text-embedding-v3  # (可选，取决于你的 Collection 配置)
```

## 🏃‍♂️ 运行开发服务器

```bash
pnpm install
pnpm dev
```

打开浏览器访问 [http://localhost:3000](http://localhost:3000) 即可开始对话。

## 📂 项目结构

- `app/api/chat/route.ts`: 核心 RAG 逻辑与路由分发。
- `lib/ai/`: AI 相关的客户端封装 (DashScope, Rewrite, Rerank)。
- `lib/db/`: 数据库客户端 (Qdrant)。
- `components/`: UI 组件 (Chat, Message, Sources Tab)。
- `docs/`: 项目文档与开发日志。

## 📝 许可证

MIT