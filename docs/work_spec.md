# 项目工作说明书 (Work Specification)

本文档定义了 Chatbot Web 项目后端 API 的实现规范。核心目标是利用 Vercel AI SDK 的 `StreamData` 功能，在单次请求中同时返回流式回答和结构化的引用来源数据，并具备智能的意图路由能力。

## 1. 核心架构策略
*   **混合模式**：
    *   Chat/Embedding/Rewrite: 使用 Vercel AI SDK (`@ai-sdk/openai`) 连接 DashScope。
    *   Rerank: 使用原生 Fetch 调用 DashScope API。
*   **单接口多数据**：
    *   仅维护 `/api/chat` 一个接口。
    *   使用 `StreamData` 协议，将 RAG 检索到的来源数据（Source Items）与 LLM 的流式文本一同返回。
*   **意图路由 (Router)**:
    *   后端通过 LLM 识别用户意图，自动在“闲聊模式”和“RAG 检索模式”之间切换。

## 2. 环境变量配置 (依赖契约)

必须在 `.env.local` 中配置：

| 变量名 | 说明 |
| :--- | :--- |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API Key |
| `QDRANT_URL` | Qdrant 实例地址 |
| `QDRANT_API_KEY` | Qdrant 访问密钥 (可选) |
| `QDRANT_COLLECTION` | 向量集合名称 |
| `QDRANT_VECTOR_NAME` | 向量字段名称 (可选) |

## 3. 数据契约：来源对象 (`SourceItem`)

这是后端通过 `StreamData` 返回给前端的数据结构。

```typescript
interface SourceItem {
  id: string;            // 唯一标识 (Qdrant segment_id)
  title: string;         // 视频标题 (video_title)
  url: string;           // 来源链接 (source_url)
  transcript: string;    // 字幕文本 (text_readable), 建议截断前 200 字
  score: number;         // Rerank 相似度分数
  metadata: {
    startTime: number;   // start_time_seconds
    endTime: number;     // end_time_seconds
  };
}
```

## 4. 接口规范 (`POST /api/chat`)

### 4.1 处理流程 (Router Flow)

1.  **初始化**: 创建 `StreamData` 实例。
2.  **意图识别与改写 (Rewrite & Classify)**:
    *   调用 `rewriteQuery`，判断 `isRelevant` (是否与佛法/修行相关) 并生成优化后的 Query。
3.  **分支处理**:
    *   **分支 A (闲聊模式 `isRelevant === false`)**:
        *   **跳过** RAG 检索。
        *   向流中注入空来源：`data.append({ type: 'sources', payload: [] })`。
        *   **Prompt**: 使用“通用助手”人设，语气谦和。
    *   **分支 B (检索模式 `isRelevant === true`)**:
        *   **Embed**: 生成 Query 向量。
        *   **Search**: Qdrant Top-K 检索。
        *   **Rerank**: DashScope GTE Rerank (Top-N)。
        *   **注入**: 将 Top-N 文档映射为 `SourceItem[]` 并注入流。
        *   **Prompt**: 使用“佛法助手”人设，包含引用上下文。
4.  **生成回答**:
    *   调用 `streamText`。
    *   **人设要求**: 语气需具备“法味”，多用“善友”、“随喜功德”等词汇，减少机械寒暄。
5.  **返回**:
    *   使用 `result.toDataStreamResponse({ data })` 返回混合流。

## 5. 前端消费规范

前端 (Tab2 组件):
1.  **状态同步**: 监听 `data` 变化。
2.  **UI 渲染**:
    *   若收到 `payload: []` (空数组)，Tab2 显示“暂无参考资料”或隐藏。
    *   若收到有效数组，渲染引用卡片列表。
3.  **称呼显示**:
    *   User -> "善友" (或根据配置)
    *   AI -> "法友" (或根据配置)

## 6. 鲁棒性要求

1.  **Rerank 失败**: 降级使用 Qdrant 检索结果，确保 Tab2 不空白。
2.  **Rewrite 失败**: 默认视为 `isRelevant = true` 并使用原始查询，避免漏掉潜在的修行问题。