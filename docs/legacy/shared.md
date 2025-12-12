# Vercel AI SDK RAG 集成工作说明

本说明旨在指导如何在 Next.js 项目中实现一个完整的 RAG（检索增强生成）流程，该流程基于阿里云 DashScope (通义千问) 和 Qdrant 向量数据库。

## 1. 核心业务流程

我们需要在 `app/api/chat/route.ts` 中复现以下完整逻辑（参考 `query_vector_test.py`）：

1.  **查询改写 (Query Rewrite)**:
    *   使用 DashScope (`qwen-turbo`) 对用户问题进行改写，提取核心搜索关键词，去除寒暄和无关信息。
2.  **生成向量 (Embedding)**:
    *   使用 DashScope (`text-embedding-v3`) 将改写后的查询转化为向量。
3.  **向量检索 (Vector Search)**:
    *   连接 Qdrant 数据库。
    *   在指定 Collection (如 `segments_zh`) 中搜索最相似的 Top-K (默认 20) 个段落。
    *   注意：需处理 Named Vectors 参数。
4.  **重排序 (Rerank)**:
    *   使用 DashScope GTE Rerank (`gte-rerank`) 对 Qdrant 返回的候选文档进行重排序。
    *   取 Top-N (默认 5) 作为最终上下文。
5.  **生成回答 (Generation)**:
    *   将 Top-N 文档组装成 Prompt。
    *   调用 LLM (`qwen-max`) 生成流式回答。

## 2. 环境变量配置 (必须)

请确保在 `.env.local` 和 Vercel 项目设置中配置以下变量：

| 变量名 | 说明 | 示例值 |
| :--- | :--- | :--- |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API Key | `sk-xxxxxxxx` |
| `QDRANT_URL` | Qdrant 数据库地址 | `https://xyz.qdrant.tech` 或 `http://localhost:6333` |
| `QDRANT_API_KEY` | Qdrant API Key | `th1s_1s_4_s3cr3t_k3y` |
| `QDRANT_COLLECTION` | 向量集合名称 | `segments_zh` |
| `QDRANT_VECTOR_NAME` | 向量字段名称 (如有) | `text-embedding-v3` |

## 3. 代码实现指南

### 3.1 依赖安装

```bash
npm install @ai-sdk/openai ai @qdrant/js-client-rest
```

### 3.2 模块划分

建议将功能拆分为独立的工具函数，保持 `route.ts` 清洁。

*   **`lib/ai/dashscope.ts`**:
    *   `chatModel`: `qwen-max` (用于回答)
    *   `rewriteModel`: `qwen-turbo` (用于改写)
    *   `embeddingModel`: `text-embedding-v3`
    *   `rerank(query, docs)`: 封装 GTE Rerank API 调用 (手动 fetch)

*   **`lib/db/qdrant.ts`**:
    *   初始化 `QdrantClient`。
    *   导出 `searchDocuments(vector)` 函数。

*   **`app/api/chat/route.ts`**:
    *   串联上述所有步骤。

### 3.3 详细实现逻辑 (伪代码参考)

#### A. 查询改写 (`lib/ai/rewrite.ts`)

```typescript
import { generateText } from 'ai';
import { rewriteModel } from './dashscope'; // 假设这里导出了 qwen-turbo

const REWRITE_PROMPT = `你是一个隆波帕默尊者佛法问答系统的智能助手。
你的任务是根据用户的输入，提取出用于检索佛法数据库的核心问题。
请去除寒暄语、无关的背景描述，将问题转化为一个清晰、独立的查询语句。
不要回答用户的问题，只输出改写后的查询语句。`;

export async function rewriteQuery(userQuery: string) {
  try {
    const { text } = await generateText({
      model: rewriteModel,
      system: REWRITE_PROMPT,
      prompt: userQuery,
    });
    return text.trim();
  } catch (e) {
    console.warn("Rewrite failed, using original query", e);
    return userQuery;
  }
}
```

#### B. 向量检索 (`lib/db/qdrant.ts`)

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

export async function searchQdrant(vector: number[], topK = 20) {
  const collectionName = process.env.QDRANT_COLLECTION;
  const vectorName = process.env.QDRANT_VECTOR_NAME; // 可选

  if (!collectionName) throw new Error("QDRANT_COLLECTION not set");

  const result = await client.search(collectionName, {
    vector: vectorName ? { name: vectorName, vector } : vector,
    limit: topK,
    with_payload: true,
  });
  
  return result.map(item => ({
    id: item.id,
    content: item.payload?.text_readable || item.payload?.text || "",
    // 其他 payload 字段...
  }));
}
```

#### C. 主流程 (`app/api/chat/route.ts`)

```typescript
import { streamText, embed } from 'ai';
import { chatModel, embeddingModel } from '@/lib/ai/dashscope';
import { rewriteQuery } from '@/lib/ai/rewrite';
import { searchQdrant } from '@/lib/db/qdrant';
import { rerank } from '@/lib/ai/rerank';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const lastMessage = messages[messages.length - 1];
  const originalQuery = lastMessage.content;

  // 1. Rewrite
  const searchQuery = await rewriteQuery(originalQuery);
  console.log(`[RAG] Original: "${originalQuery}" -> Rewritten: "${searchQuery}"`);

  // 2. Embed
  const { embedding } = await embed({
    model: embeddingModel,
    value: searchQuery,
  });

  // 3. Search (Top 20)
  const candidates = await searchQdrant(embedding, 20);
  const candidateTexts = candidates.map(c => c.content);

  // 4. Rerank (Top 5)
  // 注意：Rerank 使用原始查询还是改写后查询？通常改写后更精准，但也可尝试原始。
  // 这里我们使用改写后的 searchQuery。
  const rerankResults = await rerank(searchQuery, candidateTexts);
  
  const topDocs = rerankResults
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => candidates[r.index]); // 映射回原始文档对象

  // 5. Generate
  const context = topDocs.map((doc, i) => `[${i+1}] ${doc.content}`).join('\n\n');
  
  const systemPrompt = `你是一个佛法问答助手。请基于以下上下文回答问题：
  ${context}`;

  const result = await streamText({
    model: chatModel, // qwen-max
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages // 包含历史
    ],
  });

  return result.toDataStreamResponse();
}
```