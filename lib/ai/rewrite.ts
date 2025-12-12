const REWRITE_PROMPT = `你是一个隆波帕默尊者佛法问答系统的智能助手。
你的任务是根据用户的输入，提取出用于检索佛法数据库的核心问题。
请去除寒暄语、无关的背景描述，将问题转化为一个清晰、独立的查询语句。
不要回答用户的问题，只输出改写后的查询语句。`;

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

export async function rewriteQuery(userQuery: string): Promise<string> {
  const fallback = (userQuery ?? "").trim();
  if (!fallback) {
    return fallback;
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.warn("[rewrite] Missing DASHSCOPE_API_KEY, skip rewrite.");
    return fallback;
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
    const rewritten = content.trim();

    return rewritten.length ? rewritten : fallback;
  } catch (error) {
    console.warn("[rewrite] Failed to rewrite query, fallback to original", error);
    return fallback;
  }
}
