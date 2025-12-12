const REWRITE_PROMPT = `你是一个隆波帕默尊者佛法问答系统的智能助手。
请完成两个任务：
1. 判断来访问题是否与佛法、修行、人生困惑、内观实践相关，若相关则 isRelevant 为 true，否则为 false。
2. 当 isRelevant 为 true 时，将问题改写为适合检索佛法资料库的精炼查询语句；当 isRelevant 为 false 时，可直接返回原问题或空字符串。

严格输出 JSON，不要包含任何解释或多余文字，例如：
{"isRelevant":true,"query":"如何在生活中保持四念处练习"}`;

const REWRITE_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";

type DashScopeRewriteResponse = {
  output?: {
    choices?: Array<{
      message?: {
        content?: string;
      };
      text?: string;
    }>;
    text?: string;
  };
};

type RewriteQueryResult = { isRelevant: boolean; query: string };

const FALLBACK_RESULT = (query: string, isRelevant = true): RewriteQueryResult => ({
  isRelevant,
  query,
});

export async function rewriteQuery(
  userQuery: string
): Promise<RewriteQueryResult> {
  const fallback = (userQuery ?? "").trim();
  if (!fallback) {
    return { isRelevant: false, query: "" };
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.warn("[rewrite] Missing DASHSCOPE_API_KEY, skip rewrite.");
    return FALLBACK_RESULT(fallback);
  }

  try {
    const response = await fetch(REWRITE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-turbo",
        input: {
          messages: [
            { role: "system", content: REWRITE_PROMPT },
            { role: "user", content: fallback },
          ],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`DashScope rewrite failed: ${response.status}`);
    }

    const data = (await response.json()) as DashScopeRewriteResponse;
    const content =
      data.output?.choices?.[0]?.message?.content ?? data.output?.text ?? "";

    const parsed = parseRewriteResponse(content);
    const isRelevant =
      typeof parsed.isRelevant === "boolean" ? parsed.isRelevant : true;
    const queryText =
      typeof parsed.query === "string" && parsed.query.trim().length
        ? parsed.query.trim()
        : fallback;

    return { isRelevant, query: queryText };
  } catch (error) {
    console.warn(
      "[rewrite] Failed to rewrite query, fallback to original",
      error
    );
    return FALLBACK_RESULT(fallback);
  }
}

type PartialRewritePayload = {
  isRelevant?: unknown;
  query?: unknown;
};

function parseRewriteResponse(raw: string): PartialRewritePayload {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return {};
  }

  const candidate = extractJsonBlock(trimmed);
  try {
    return JSON.parse(candidate) as PartialRewritePayload;
  } catch {
    return {};
  }
}

function extractJsonBlock(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }
  return raw;
}
