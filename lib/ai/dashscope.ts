import { createOpenAI } from "@ai-sdk/openai";

const DASH_SCOPE_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

type DashScopeClient = ReturnType<typeof createOpenAI>;

let cachedClient: DashScopeClient | null = null;

function getDashScopeClient(): DashScopeClient {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing DASHSCOPE_API_KEY. Set it in your environment to call DashScope."
    );
  }

  cachedClient = createOpenAI({
    baseURL: DASH_SCOPE_BASE_URL,
    apiKey,
  });

  return cachedClient;
}

export function getChatModel() {
  return getDashScopeClient().chat("qwen-max");
}

export function getEmbeddingModel() {
  return getDashScopeClient().textEmbeddingModel("text-embedding-v3");
}

type RerankParams = {
  query: string;
  documents: string[];
  topN: number;
};

const RERANK_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank";

export async function rerankDocuments({
  query,
  documents,
  topN,
}: RerankParams) {
  if (!documents.length || !query.trim()) {
    return [];
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing DASHSCOPE_API_KEY. Set it in your environment to call DashScope rerank."
    );
  }

  const response = await fetch(RERANK_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gte-rerank",
      input: {
        query,
        documents,
      },
      top_n: Math.min(topN, documents.length),
      return_documents: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `DashScope rerank request failed with status ${response.status}: ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    output?: {
      results?: Array<{ index?: number; score?: number; relevance_score?: number }>;
    };
  };

  const items = data.output?.results ?? [];
  return items
    .map((item) => ({
      index: typeof item.index === "number" ? item.index : 0,
      score:
        typeof item.relevance_score === "number"
          ? item.relevance_score
          : typeof item.score === "number"
            ? item.score
            : 0,
    }))
    .filter((item) => item.index >= 0 && item.index < documents.length);
}
