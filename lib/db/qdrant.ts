import { QdrantClient } from "@qdrant/js-client-rest";

type SearchResult = {
  id: string | number;
  content: string;
  payload?: Record<string, unknown>;
  score?: number;
};

let cachedClient: QdrantClient | null = null;

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Please configure it in your environment.`);
  }
  return value;
}

function getQdrantClient(): QdrantClient {
  if (cachedClient) {
    return cachedClient;
  }

  const url = getEnvOrThrow("QDRANT_URL");
  const apiKey = process.env.QDRANT_API_KEY;

  cachedClient = new QdrantClient({
    url,
    apiKey,
  });

  return cachedClient;
}

export async function searchQdrant(
  vector: number[],
  topK = 20
): Promise<SearchResult[]> {
  if (!Array.isArray(vector) || vector.length === 0) {
    return [];
  }

  const collectionName = getEnvOrThrow("QDRANT_COLLECTION");
  const vectorName = process.env.QDRANT_VECTOR_NAME;

  const client = getQdrantClient();

  const result = await client.search(collectionName, {
    vector: vectorName ? { name: vectorName, vector } : vector,
    limit: topK,
    with_payload: true,
  });

  return result.map((item) => ({
    id: item.id,
    content:
      (item.payload?.text_readable as string | undefined) ??
      (item.payload?.text as string | undefined) ??
      "",
    payload: item.payload ?? undefined,
    score: typeof item.score === "number" ? item.score : undefined,
  }));
}
