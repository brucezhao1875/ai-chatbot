## 2025-12-10

- 研读 shared.md，确定当前项目的 RAG 流程由 DashScope 负责聊天、embedding（text-embedding-v3）和 rerank（gte-rerank），不再依赖 Vercel AI Gateway。
- 计划在 `lib/ai/dashscope.ts` 里使用 `@ai-sdk/openai` 创建 OpenAI-compatible 客户端，封装 `qwen-max` 聊天模型与 `text-embedding-v3` embedding 模型；所有请求需要 `DASHSCOPE_API_KEY`。
- rerank 通过 DashScope REST API (`/api/v1/services/rerank/text-rerank/text-rerank`) 手写 fetch 函数，解析 `output.results`。
- `app/api/chat/route.ts` 中的 RAG 流程：用户提问 → (可选) query rewrite → embedding → 向量检索 → rerank top N → 构建系统 prompt → Qwen 生成回答，并以流式返回。
- 向量检索函数需要替换为真实的向量数据库调用（如 Qdrant/Pinecone/pgvector），示例中暂用 mock。
