import { embed, streamText, type CoreMessage } from "ai";
import {
  getChatModel,
  getEmbeddingModel,
  rerankDocuments,
} from "@/lib/ai/dashscope";
import { rewriteQuery } from "@/lib/ai/rewrite";
import { searchQdrant } from "@/lib/db/qdrant";

const DEFAULT_TOP_K = 20;
const DEFAULT_RERANK_TOP_N = 5;

function normalizeMessages(messages: any[]): CoreMessage[] {
  return messages
    .map((message) => {
      const role =
        message.role === "assistant"
          ? "assistant"
          : message.role === "system"
            ? "system"
            : "user";

      const content =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .map((part) => (part?.type === "text" ? part.text ?? "" : ""))
                .join("")
            : "";

      return { role, content };
    })
    .filter((message) => message.content.trim().length > 0);
}

export async function POST(request: Request) {
  try {
    const { messages = [] } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Messages array is required." },
        { status: 400 }
      );
    }

    const normalizedMessages = normalizeMessages(messages);
    const lastUserMessage = [...normalizedMessages]
      .reverse()
      .find((message) => message.role === "user");

    if (!lastUserMessage) {
      return Response.json(
        { error: "A user message is required." },
        { status: 400 }
      );
    }

    const userQuery = lastUserMessage.content;
    const rewrittenQuery = await rewriteQuery(userQuery);
    const searchQuery = rewrittenQuery || userQuery;

    const { embedding } = await embed({
      model: getEmbeddingModel(),
      value: searchQuery,
    });

    const candidates = await searchQdrant(embedding, DEFAULT_TOP_K);
    const candidateTexts = candidates.map((doc) => doc.content);

    const rerankResults = await rerankDocuments({
      query: searchQuery,
      documents: candidateTexts,
      topN: Math.min(DEFAULT_RERANK_TOP_N, candidateTexts.length),
    });

    const orderedIndices =
      rerankResults.length > 0
        ? rerankResults.map((item) => item.index)
        : candidateTexts.map((_, index) => index);

    const contextSnippets = orderedIndices
      .slice(0, DEFAULT_RERANK_TOP_N)
      .map((index) => candidateTexts[index])
      .filter((snippet) => Boolean(snippet && snippet.trim()));

    const contextBlock = contextSnippets.length
      ? `请参考以下资料片段：\n\n${contextSnippets
          .map((snippet, idx) => `(${idx + 1}) ${snippet}`)
          .join("\n\n")}\n\n如果资料与问题无关，请明确说明依据。`
      : "当前没有可引用的资料，请直接根据通用常识回答。";

    const baseInstruction =
      "你是一个佛法学习助手，请以平和、清晰的语气回答问题。优先引用提供的资料内容，并在不确定时坦诚告知。";

    const guidance = `${baseInstruction}\n\n${contextBlock}`;

    const augmentedMessages: CoreMessage[] = [...normalizedMessages];
    const firstUserIndex = augmentedMessages.findIndex(
      (message) => message.role === "user"
    );

    if (firstUserIndex !== -1) {
      augmentedMessages[firstUserIndex] = {
        ...augmentedMessages[firstUserIndex],
        content: `${guidance}\n\n用户问题：${augmentedMessages[firstUserIndex].content}`,
      };
    } else {
      augmentedMessages.unshift({
        role: "user",
        content: `${guidance}\n\n请回答用户的问题。`,
      });
    }

    const result = streamText({
      model: getChatModel(),
      messages: augmentedMessages,
    });

    return result.toTextStreamResponse({
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Chat route error", error);
    return Response.json(
      { error: "Unable to generate a response right now." },
      { status: 500 }
    );
  }
}
