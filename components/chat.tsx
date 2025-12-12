"use client";

import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

type SimpleMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const createId = () => crypto.randomUUID?.() ?? Math.random().toString(36);

export function Chat() {
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setInput(event.target.value);
    },
    []
  );

  const disabled = useMemo(() => isLoading, [isLoading]);

  const appendAssistantChunk = useCallback(
    (id: string, chunk: string) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id
            ? {
                ...message,
                content: chunk,
              }
            : message
        )
      );
    },
    []
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmed = input.trim();
      if (!trimmed) {
        return;
      }

      const userMessage: SimpleMessage = {
        id: createId(),
        role: "user",
        content: trimmed,
      };

      const assistantMessageId = createId();
      const assistantMessage: SimpleMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
      };

      const updatedMessages = [...messages, userMessage, assistantMessage];
      setMessages(updatedMessages);
      setInput("");
      setIsLoading(true);

      const abortController = new AbortController();
      setController(abortController);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: updatedMessages.slice(0, -1) }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const fallbackText = (await response.text()).trim();
          appendAssistantChunk(
            assistantMessageId,
            fallbackText || "(Assistant未返回内容)"
          );
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            accumulated += chunk;
            appendAssistantChunk(assistantMessageId, accumulated);
          }
        }

        const finalChunk = decoder.decode();
        if (finalChunk) {
          accumulated += finalChunk;
        }

        appendAssistantChunk(
          assistantMessageId,
          accumulated.trim() || "(Assistant未返回内容)"
        );
      } catch (error: any) {
        if (error?.name === "AbortError") {
          appendAssistantChunk(assistantMessageId, "（生成已终止）");
        } else {
          console.error("Chat request failed", error);
          appendAssistantChunk(assistantMessageId, "抱歉，暂时无法生成回复。");
        }
      } finally {
        setController(null);
        setIsLoading(false);
      }
    },
    [appendAssistantChunk, input, messages]
  );

  const handleStop = useCallback(() => {
    controller?.abort();
  }, [controller]);

  return (
    <div className="chat-shell">
      <header>
        <p className="badge">Stateless Mode</p>
        <h1>AI Chat</h1>
        <p>
          Conversations live only in your browser. Refreshing clears the
          history.
        </p>
      </header>

      <section className="chat-card">
        <div className="message-list">
          {messages.length === 0 ? (
            <div className="message-list-empty">
              Ask a question to get started.
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`message message--${
                  message.role === "user" ? "user" : "assistant"
                }`}
              >
                <p className="message-role">
                  {message.role === "user" ? "You" : "Assistant"}
                </p>
                <p className="message-text">{message.content}</p>
              </article>
            ))
          )}
        </div>

        <form onSubmit={handleSubmit} className="chat-form">
          <fieldset disabled={disabled}>
            <textarea
              value={input}
              onChange={handleInputChange}
              placeholder="Send a message..."
            />
            <div className="chat-form-actions">
              {isLoading && (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleStop}
                >
                  Stop
                </button>
              )}
              <button
                type="submit"
                className="button button--primary"
                disabled={disabled || input.trim().length === 0}
              >
                Send
              </button>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
