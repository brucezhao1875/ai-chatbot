import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  embed,
  streamText,
  type CoreMessage,
} from "ai";
import {
  getChatModel,
  getEmbeddingModel,
  rerankDocuments,
} from "@/lib/ai/dashscope";
import { rewriteQuery } from "@/lib/ai/rewrite";
import { searchQdrant } from "@/lib/db/qdrant";
import type { SourceItem } from "@/lib/types/rag";

const DEFAULT_TOP_K = 20;
const DEFAULT_RERANK_TOP_N = 5;
const SOURCE_TRANSCRIPT_LIMIT = 400;
const CONTEXT_SNIPPET_LIMIT = 700;
const SOURCE_DATA_CHUNK_TYPE = "data-sources";
const PERSONA_PROMPT = `你是一位精进修行的佛法道友，语气谦和、慈悲、平实。
在交流时：
- 开头少用“你好”，视情境可用“善哉”“师兄好”等。
- 结尾或赞同时可使用“随喜功德”“萨度”等表达。
- 避免机械或商业化语气，保持法味，但也不要过度堆砌术语，务必让表达清晰真诚。`;
const GENERAL_ASSISTANT_PROMPT = `${PERSONA_PROMPT}
当对话内容与佛法修行无关时，请以朴实的常识回答，仍保持修行者的谦和语气。`;

type PlainTextPart = { type: "text"; text: string };

type PreparedMessage = {
  role: "user" | "assistant" | "system";
  text: string;
  core: CoreMessage;
};

function prepareMessages(messages: any[]): PreparedMessage[] {
  const prepared: PreparedMessage[] = [];

  messages.forEach((message) => {
    const role: PreparedMessage["role"] =
      message.role === "assistant"
        ? "assistant"
        : message.role === "system"
          ? "system"
          : "user";

    const textFromParts = extractTextFromParts((message as any)?.parts);
    const text = (textFromParts || extractPlainText(message?.content)).trim();
    if (!text) {
      return;
    }

    if (role === "system") {
      prepared.push({
        role,
        text,
        core: { role: "system", content: text },
      });
      return;
    }

    const textContent: PlainTextPart[] = [{ type: "text", text }];
    prepared.push({
      role,
      text,
      core: { role, content: textContent },
    });
  });

  return prepared;
}

function extractPlainText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: { type?: string; text?: string }) =>
        part?.type === "text" ? part.text ?? "" : ""
      )
      .join("");
  }

  return "";
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part: any) => {
      if (!part) {
        return "";
      }

      if (part.type === "text") {
        return part.text ?? "";
      }

      if (part.type === "input_text") {
        return part.input_text ?? part.text ?? "";
      }

      if (typeof part.content === "string") {
        return part.content;
      }

      return "";
    })
    .join("");
}

type RetrievedDocument = Awaited<ReturnType<typeof searchQdrant>>[number];

type RankedDocument = {
  doc: RetrievedDocument;
  rerankScore: number;
};

const truncateText = (text: string, limit: number) => {
  const normalized = (text ?? "").trim();
  return normalized.length > limit
    ? `${normalized.slice(0, limit)}…`
    : normalized;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const buildSourceItem = (doc: RetrievedDocument, score: number): SourceItem => {
  const payload = doc.payload ?? {};
  const transcriptSource =
    (payload.text_readable as string | undefined) ??
    (payload.text as string | undefined) ??
    doc.content;

  const start = asNumber(payload.start_time_seconds) ?? 0;
  const end = asNumber(payload.end_time_seconds) ?? 0;

  return {
    id:
      (payload.segment_id as string | undefined) ??
      String(doc.id ?? globalThis.crypto?.randomUUID?.() ?? Math.random()),
    title:
      (payload.video_title as string | undefined) ?? "未命名视频片段",
    summary: (payload.topic_title as string | undefined) ?? "",
    url: (payload.source_url as string | undefined) ?? "",
    transcript: truncateText(transcriptSource ?? "", SOURCE_TRANSCRIPT_LIMIT),
    score,
    metadata: {
      startTime: start,
      endTime: end,
    },
  };
};

const selectTopDocuments = (
  candidates: RetrievedDocument[],
  rerankEntries: Array<{ index: number; score?: number }> | undefined,
  limit: number
): RankedDocument[] => {
  if (!candidates.length || limit <= 0) {
    return [];
  }

  if (!rerankEntries?.length) {
    return candidates.slice(0, limit).map((doc) => ({
      doc,
      rerankScore: typeof doc.score === "number" ? doc.score : -1,
    }));
  }

  const seen = new Set<number>();
  const ranked: RankedDocument[] = [];

  const ordered = [...rerankEntries].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );

  for (const entry of ordered) {
    if (
      typeof entry.index !== "number" ||
      entry.index < 0 ||
      entry.index >= candidates.length ||
      seen.has(entry.index)
    ) {
      continue;
    }

    ranked.push({
      doc: candidates[entry.index],
      rerankScore:
        typeof entry.score === "number" ? entry.score : entry.index * -0.01,
    });

    seen.add(entry.index);
    if (ranked.length === limit) {
      return ranked;
    }
  }

  for (let idx = 0; idx < candidates.length && ranked.length < limit; idx++) {
    if (seen.has(idx)) {
      continue;
    }
    ranked.push({
      doc: candidates[idx],
      rerankScore: typeof candidates[idx].score === "number" ? candidates[idx].score! : -1,
    });
  }

  return ranked;
};

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log("[chat] incoming payload", payload);
    const rawMessages = Array.isArray(payload?.messages)
      ? payload.messages
      : [];

    if (!rawMessages.length && payload?.message) {
      rawMessages.push(payload.message);
    }

    const messages = rawMessages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Messages array is required." },
        { status: 400 }
      );
    }

    const preparedMessages = prepareMessages(messages);
    if (!preparedMessages.length) {
      return Response.json(
        { error: "Messages array is required." },
        { status: 400 }
      );
    }

    const normalizedMessages = preparedMessages.map((message) => message.core);
    const lastUserMessage = [...preparedMessages]
      .reverse()
      .find((message) => message.role === "user");

    if (!lastUserMessage) {
      return Response.json(
        { error: "A user message is required." },
        { status: 400 }
      );
    }

    const userQuery = lastUserMessage.text;
    const rewriteOutcome = await rewriteQuery(userQuery);
    const normalizedQuery = (rewriteOutcome.query ?? "").trim();
    const searchQuery = normalizedQuery || userQuery;
    const displayRewrite = normalizedQuery || "";
    const shouldUseRag = rewriteOutcome.isRelevant !== false;

    if (!shouldUseRag) {
      const generalMessages: CoreMessage[] = [...normalizedMessages];
      const firstUserIndex = preparedMessages.findIndex(
        (message) => message.role === "user"
      );

      if (firstUserIndex !== -1) {
        const combined = `${GENERAL_ASSISTANT_PROMPT}\n\n用户问题：${preparedMessages[firstUserIndex].text}`;
        const content: PlainTextPart[] = [{ type: "text", text: combined }];
        generalMessages[firstUserIndex] = {
          role: "user",
          content,
        };
      } else {
        generalMessages.unshift({
          role: "user",
          content: [
            {
              type: "text",
              text: `${GENERAL_ASSISTANT_PROMPT}\n\n请回答用户的问题。`,
            },
          ],
        });
      }

      const generalResult = streamText({
        model: getChatModel(),
        messages: generalMessages,
      });

      const stream = createUIMessageStream({
        async execute({ writer }) {
          writer.write({
            type: SOURCE_DATA_CHUNK_TYPE,
            data: {
              question: userQuery,
              rewrittenQuery: displayRewrite,
              sources: [],
            },
          });
          writer.merge(generalResult.toUIMessageStream());
        },
        onError: (error) => {
          console.error("Chat stream error", error);
          return "抱歉，生成回答时出现问题。";
        },
      });

      return createUIMessageStreamResponse({ stream });
    }

    const { embedding } = await embed({
      model: getEmbeddingModel(),
      value: searchQuery,
    });

    const candidates = await searchQdrant(embedding, DEFAULT_TOP_K);
    const candidateTexts = candidates.map((doc) => doc.content ?? "");

    let rerankResults: Array<{ index: number; score?: number }> = [];
    if (candidateTexts.length > 0) {
      try {
        rerankResults = await rerankDocuments({
          query: searchQuery,
          documents: candidateTexts,
          topN: Math.min(DEFAULT_RERANK_TOP_N, candidateTexts.length),
        });
      } catch (error) {
        console.warn("[rerank] Failed to rerank documents, fallback to vector order.", error);
      }
    }

    const rankedDocuments = selectTopDocuments(
      candidates,
      rerankResults,
      DEFAULT_RERANK_TOP_N
    );

    const contextSnippets = rankedDocuments
      .map(({ doc }) => doc.content)
      .filter((snippet) => Boolean(snippet && snippet.trim()))
      .map((snippet) => truncateText(snippet, CONTEXT_SNIPPET_LIMIT));

    const contextBlock = contextSnippets.length
      ? `请参考以下资料片段：\n\n${contextSnippets
          .map((snippet, idx) => `(${idx + 1}) ${snippet}`)
          .join("\n\n")}\n\n如果资料与问题无关，请明确说明依据。`
      : "当前没有可引用的资料，请直接根据通用常识回答。";

    const baseInstruction = `${PERSONA_PROMPT}
你是一个佛法学习助手，请以平和、清晰的语气回答问题。优先引用提供的资料内容，并在不确定时坦诚告知。`;

    const guidance = `${baseInstruction}\n\n${contextBlock}`;

    const augmentedMessages: CoreMessage[] = [...normalizedMessages];
    const firstUserIndex = preparedMessages.findIndex(
      (message) => message.role === "user"
    );

    if (firstUserIndex !== -1) {
      const combined = `${guidance}\n\n用户问题：${preparedMessages[firstUserIndex].text}`;
      const content: PlainTextPart[] = [{ type: "text", text: combined }];
      augmentedMessages[firstUserIndex] = {
        role: "user",
        content,
      };
    } else {
      augmentedMessages.unshift({
        role: "user",
        content: [
          {
            type: "text",
            text: `${guidance}\n\n请回答用户的问题。`,
          },
        ],
      });
    }

    const result = streamText({
      model: getChatModel(),
      messages: augmentedMessages,
    });

    const sourceItems: SourceItem[] = rankedDocuments.map(
      ({ doc, rerankScore }) => buildSourceItem(doc, rerankScore)
    );

    const stream = createUIMessageStream({
      async execute({ writer }) {
        writer.write({
          type: SOURCE_DATA_CHUNK_TYPE,
          data: {
            question: userQuery,
            rewrittenQuery: displayRewrite,
            sources: sourceItems,
          },
        });
        writer.merge(result.toUIMessageStream());
      },
      onError: (error) => {
        console.error("Chat stream error", error);
        return "抱歉，生成回答时出现问题。";
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    console.error("Chat route error", error);
    return Response.json(
      { error: "Unable to generate a response right now." },
      { status: 500 }
    );
  }
}
