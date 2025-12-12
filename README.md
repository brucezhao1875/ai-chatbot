<h1 align="center">Chat SDK</h1>

<p align="center">
  Chat SDK now ships in a strict <strong>stateless</strong> mode. The entire chat history lives in the browser and disappears on refresh, making it easy to deploy without databases, auth, or migrations.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- Single-page [Next.js](https://nextjs.org) App Router setup
- Stateless chat powered by [`useChat`](https://ai-sdk.dev/docs/react/use-chat)
- Streaming responses through the [Vercel AI SDK](https://ai-sdk.dev)
- DashScope-based RAG pipeline（query rewrite → text-embedding-v3 → Qdrant → gte-rerank → Qwen chat）
- Minimal UI built with hand-rolled CSS (no shadcn/ui or Radix dependencies)
- No databases, migrations, auth flows, or artifacts side panels to configure

## Model Providers

The app calls DashScope (通义千问) directly via the AI SDK’s OpenAI-compatible client:

- Chat model: `qwen-max`
- Embedding model: `text-embedding-v3`
- Rerank model: `gte-rerank` (REST API)

Configure the following env vars locally / on Vercel:

- `DASHSCOPE_API_KEY`: DashScope access key.
- `QDRANT_URL`: your Qdrant endpoint (e.g. `https://xxx.qdrant.tech` or `http://localhost:6333`).
- `QDRANT_API_KEY`: Qdrant key (optional for local dev).
- `QDRANT_COLLECTION`: collection storing your RAG segments.
- `QDRANT_VECTOR_NAME`: named-vector field (omit if the collection uses the default vector).

If you prefer other providers or vector stores, replace the logic in `lib/ai/dashscope.ts`, `lib/ai/rewrite.ts`, and `lib/db/qdrant.ts` accordingly.

## Running locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to start chatting. Refreshing the page clears the conversation.
