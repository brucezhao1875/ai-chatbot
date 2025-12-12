"use client";

import ReactMarkdown from "react-markdown";
import { useChat } from "@ai-sdk/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { UIMessage } from "ai";
import type { SourceItem } from "@/lib/types/rag";

const SOURCE_PART_TYPE = "data-sources";

type TabKey = "chat" | "sources";
type SourcePart = { type: string; data?: unknown };
type SourceGroup = {
  id: string;
  question: string;
  rewrittenQuery: string;
  sources: SourceItem[];
};
type SourcePayload = {
  question?: string;
  rewrittenQuery?: string;
  sources: SourceItem[];
};

export function Chat() {
  const { messages, status, sendMessage, stop, error, clearError } = useChat({
    id: "stateless-chat",
  });

  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!messages.length) {
      setSelectedMessageId(null);
      return;
    }

    if (!selectedMessageId) {
      setSelectedMessageId(messages[messages.length - 1].id);
      return;
    }

    if (!messages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(messages[messages.length - 1].id);
    }
  }, [messages, selectedMessageId]);

  const messageSources = useMemo(() => {
    const map = new Map<string, SourcePayload>();
    messages.forEach((message) => {
      const payload = extractSourcePayload(message);
      if (payload) {
        map.set(message.id, payload);
      }
    });
    return map;
  }, [messages]);

  const lastAssistantWithSourcesId = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      const current = messages[idx];
      const payload = messageSources.get(current.id);
      if (current.role === "assistant" && payload?.sources.length) {
        return current.id;
      }
    }
    return null;
  }, [messages, messageSources]);

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId]
  );

  const resolvedSourceOwnerId = useMemo(() => {
    if (!messageSources.size) {
      return null;
    }

    if (selectedMessage) {
      if (
        selectedMessage.role === "assistant" &&
        messageSources.get(selectedMessage.id)?.sources.length
      ) {
        return selectedMessage.id;
      }

      const startIndex = messages.findIndex(
        (message) => message.id === selectedMessage.id
      );
      if (startIndex !== -1) {
        const owner = messages
          .slice(startIndex + 1)
          .find((message) => messageSources.get(message.id)?.sources.length);
        if (owner) {
          return owner.id;
        }
      }
    }

    return lastAssistantWithSourcesId;
  }, [selectedMessage, messageSources, messages, lastAssistantWithSourcesId]);

  const sourceHistory = useMemo(() => parseSourceHistory(messages), [messages]);
  const activeSourceId = resolvedSourceOwnerId;
  const sourceRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    if (!activeSourceId) {
      return;
    }
    const target = sourceRefs.current[activeSourceId];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeSourceId, activeTab, sourceHistory.length]);

  const messageList = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages]
  );

  const disabled = status === "submitted" || status === "streaming";

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    if (error) {
      clearError();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    await sendMessage({
      role: "user",
      parts: [{ type: "text", text: trimmed }],
    });
    setInput("");
    setActiveTab("chat");
  };

  const handleSelectMessage = (message: UIMessage) => {
    setSelectedMessageId(message.id);
  };

  const handleMessageKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    message: UIMessage
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelectMessage(message);
    }
  };

  const showStop = status === "streaming";
  const shouldShowForm = activeTab === "chat";

  return (
    <div className="chat-shell">
      <div className="chat-inner">
        <div className="chat-hero">
          <header>
            <p className="badge">Stateless Mode</p>
            <h1>dharma chat</h1>
            <p className="hero-subtitle">
              <span className="hero-subtitle__en">
                Conversations stay in your browser
              </span>
              <span className="hero-subtitle__divider">·</span>
              <span className="hero-subtitle__zh">无常无住，随用随散</span>
            </p>
          </header>
          <div className="chat-tabs-row">
            <div className="chat-tabs">
              <button
                type="button"
                className={`chat-tab ${activeTab === "chat" ? "is-active" : ""}`}
                onClick={() => setActiveTab("chat")}
              >
                问答
              </button>
              <button
                type="button"
                className={`chat-tab ${
                  activeTab === "sources" ? "is-active" : ""
                }`}
                onClick={() => setActiveTab("sources")}
              >
                原文
              </button>
            </div>
          </div>
        </div>

        <section className="chat-card">
          {error && (
            <div className="chat-error">
              <p>出错啦：{error.message}</p>
            </div>
          )}

          <div className="chat-panel">
            {activeTab === "chat" ? (
              <div className="message-list">
                {messageList.length === 0 ? (
                  <div className="message-list-empty">
                    Ask a question to get started.
                  </div>
                ) : (
                  messageList.map((message) => (
                    <article
                      key={message.id}
                      className={`message message--${
                        message.role === "user" ? "user" : "assistant"
                      } ${selectedMessageId === message.id ? "is-selected" : ""}`}
                      tabIndex={0}
                      onClick={() => handleSelectMessage(message)}
                      onKeyDown={(event) => handleMessageKeyDown(event, message)}
                    >
                      <p className="message-role">
                        {message.role === "user" ? "善友" : "法义助手"}
                      </p>
                      <div className="message-text prose prose-slate">
                        <ReactMarkdown>
                          {renderMessageText(message) || "(无可显示内容)"}
                        </ReactMarkdown>
                      </div>
                    </article>
                  ))
                )}
              </div>
            ) : (
              <div className="sources-panel">
                {sourceHistory.length === 0 ? (
                  <div className="message-list-empty">
                    暂无参考资料，请先选择带有引用的回答。
                  </div>
                ) : (
                  <ul className="sources-list">
                    {sourceHistory.map((group) => (
                      <li
                        key={group.id}
                        className="sources-history-item"
                        ref={(node) => {
                          if (node) {
                            sourceRefs.current[group.id] = node;
                          } else {
                            delete sourceRefs.current[group.id];
                          }
                        }}
                      >
                        <p
                          className={`sources-history-question${
                            activeSourceId === group.id ? " is-active" : ""
                          }`}
                        >
                          {group.question}
                        </p>
                        {group.rewrittenQuery && (
                          <p className="sources-history-rewrite">
                            检索语句：{group.rewrittenQuery}
                          </p>
                        )}
                        <ul className="sources-list">
                          {group.sources.map((source) => (
                            <li key={source.id} className="source-card">
                              <div className="source-card__header">
                                <div>
                                  <p className="source-card__title">
                                    {source.title}
                                    {formatTimeLabel(
                                      source.url,
                                      source.metadata.startTime,
                                      source.metadata.endTime
                                    )}
                                  </p>
                                  <p className="source-card__meta">
                                    匹配度：{source.score.toFixed(3)}
                                  </p>
                                </div>
                              </div>
                              <p className="source-card__summary">
                                {renderSummary(source.summary)}
                              </p>
                              <p className="source-card__body">
                                {source.transcript}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {shouldShowForm && (
            <form onSubmit={handleSubmit} className="chat-form">
              <fieldset disabled={disabled}>
                <textarea
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Send a message..."
                />
                <div className="chat-form-actions">
                  {showStop && (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => stop()}
                    >
                      Stop
                    </button>
                  )}
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={disabled || input.trim().length === 0}
                  >
                    {disabled ? "Sending…" : "Send"}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function renderMessageText(message: UIMessage): string {
  const parts = (message as any).parts;
  if (Array.isArray(parts) && parts.length > 0) {
    return parts
      .filter((part: any) => part?.type === "text")
      .map((part: any) => part?.text ?? "")
      .join("\n")
      .trim();
  }

  const content = (message as unknown as { content?: string }).content;
  return typeof content === "string" ? content : "";
}

const normalizeSources = (sources?: SourceItem[]): SourceItem[] =>
  Array.isArray(sources)
    ? sources.map((source) => ({
        ...source,
        title: source.title || "未命名片段",
        summary: source.summary || "",
        transcript: source.transcript || "",
        url: source.url || "",
        score: typeof source.score === "number" ? source.score : 0,
        metadata: {
          startTime: Number.isFinite(source.metadata?.startTime)
            ? source.metadata.startTime
            : 0,
          endTime: Number.isFinite(source.metadata?.endTime)
            ? source.metadata.endTime
            : 0,
        },
      }))
    : [];

function formatTimeLabel(url: string, start: number, end: number) {
  const formatted = formatSegmentLabel(start, end);
  if (!formatted) {
    return "";
  }
  const href = applyTimestampToUrl(url, start);
  if (!href) {
    return ` [${formatted}]`;
  }
  return (
    <>
      {" "}
      [
      <a
        className="source-card__link"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {formatted}
      </a>
      ]
    </>
  );
}

function formatSegmentLabel(start: number, end: number) {
  const safeStart = Math.max(0, Math.floor(start ?? 0));
  const safeEnd = Math.max(safeStart, Math.floor(end ?? 0));
  if (safeStart === 0 && safeEnd === 0) {
    return "";
  }
  if (safeEnd <= 60 && safeStart <= 60) {
    return `${safeStart}s${safeEnd > safeStart ? `-${safeEnd}s` : ""}`;
  }
  if (safeEnd < 3600) {
    return `${formatMinutesSeconds(safeStart)} - ${formatMinutesSeconds(
      safeEnd
    )}`;
  }
  return `${formatHoursMinutesSeconds(
    safeStart
  )} - ${formatHoursMinutesSeconds(safeEnd)}`;
}

function formatMinutesSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}m:${seconds.toString().padStart(2, "0")}s`;
}

function formatHoursMinutesSeconds(value: number) {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return `${hours}h:${minutes.toString().padStart(2, "0")}m:${seconds
    .toString()
    .padStart(2, "0")}s`;
}

function renderSummary(summary: string) {
  if (!summary) {
    return "【暂无总结】";
  }
  return `【${summary}】`;
}

function applyTimestampToUrl(url: string, start: number) {
  if (!url) {
    return "";
  }
  const safeStart = Math.max(0, Math.floor(start ?? 0));
  if (!Number.isFinite(safeStart) || safeStart <= 0) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}t=${safeStart}s`;
}

function parseSourceHistory(messages: UIMessage[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  let pendingQuestion = "";

  messages.forEach((message) => {
    if (message.role === "user") {
      pendingQuestion = renderMessageText(message);
      return;
    }

    if (message.role === "assistant") {
      const payload = extractSourcePayload(message);
      if (payload?.sources.length) {
        groups.push({
          id: message.id,
          question:
            payload.question ||
            pendingQuestion ||
            "（该条回答来自历史对话）",
          rewrittenQuery: payload.rewrittenQuery || "",
          sources: payload.sources,
        });
        pendingQuestion = "";
      }
    }
  });

  return groups;
}

function extractSourcePayload(message: UIMessage): SourcePayload | null {
  const parts = message.parts ?? [];
  for (const part of parts) {
    if (typeof part?.type !== "string" || part.type !== SOURCE_PART_TYPE) {
      continue;
    }

    const rawData = (part as { data?: unknown }).data;
    if (Array.isArray(rawData)) {
      const sources = normalizeSources(rawData as SourceItem[]);
      return sources.length ? { sources } : null;
    }

    if (rawData && typeof rawData === "object") {
      const candidate = rawData as {
        question?: unknown;
        rewrittenQuery?: unknown;
        sources?: unknown;
      };
      const sources = normalizeSources(candidate.sources as SourceItem[]);
      if (!sources.length) {
        return null;
      }
      return {
        question:
          typeof candidate.question === "string" ? candidate.question : undefined,
        rewrittenQuery:
          typeof candidate.rewrittenQuery === "string"
            ? candidate.rewrittenQuery
            : undefined,
        sources,
      };
    }
  }
  return null;
}
