## 2025-12-12

- **RAG 流程优化**：
    - 研读 shared.md 与 docs/work_spec.md，确定聊天接口需走 DashScope 改写 → Embedding → Qdrant Top-K → DashScope gte-rerank → Qwen-max 生成的完整 RAG 流程。
    - /api/chat 必须用单条 Stream（UI Message Stream）同时返回回答与 `SourceItem[]`，参考 `StreamData` 规范，遇到 rerank 异常需优雅回退为原始 Qdrant 结果并标记 score=-1。
    - 前端改回 `useChat` 管理状态，监听 data part（`data-sources`）并在 Tab2 渲染引用列表，保持 Stateless、刷新即清空历史。

- **Markdown 渲染修复**：
    - 引入 `react-markdown` 替代纯文本显示，解决 AI 回答中格式不生效的问题。
    - 使用 Tailwind CSS 的 `prose` 类优化排版。

## 2025-12-10

- 研读 shared.md，确定当前项目的 RAG 流程由 DashScope 负责聊天、embedding（text-embedding-v3）和 rerank（gte-rerank），不再依赖 Vercel AI Gateway。
- 计划在 `lib/ai/dashscope.ts` 里使用 `@ai-sdk/openai` 创建 OpenAI-compatible 客户端，封装 `qwen-max` 聊天模型与 `text-embedding-v3` embedding 模型；所有请求需要 `DASHSCOPE_API_KEY`。
- rerank 通过 DashScope REST API (`/api/v1/services/rerank/text-rerank/text-rerank`) 手写 fetch 函数，解析 `output.results`。
- `app/api/chat/route.ts` 中的 RAG 流程：用户提问 → (可选) query rewrite → embedding → 向量检索 → rerank top N → 构建系统 prompt → Qwen 生成回答，并以流式返回。
- 向量检索函数需要替换为真实的向量数据库调用（如 Qdrant/Pinecone/pgvector），示例中暂用 mock。
- **项目大幅精简**：移除 Artifacts 系统、Drizzle 数据库和 NextAuth 认证，项目转变为无状态的纯前端 + RAG 后端模式。
- **RAG 流程实现**：完整实现了基于 DashScope (通义千问) 和 Qdrant 的 RAG 管道，包括查询改写、Embedding、Qdrant 检索、Rerank。
- **意图路由功能**：在 RAG 流程前增加意图识别 (Intent Routing)，根据问题类型 (闲聊/佛法修行) 分流，优化资源使用和用户体验。
- **StreamData 集成**：更新 `/api/chat` 接口，利用 `StreamData` 在流式回答中同时返回 Rerank 后的 `SourceItem[]`，为前端 Tab2 展示引用来源提供数据。
- **UI & Persona 调整**：规划了前端界面角色称谓 (如 "善友" / "法友") 的修改，并通过 System Prompt 赋予 AI 特定佛法人设与交流习惯。