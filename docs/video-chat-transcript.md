# Video Chat Transcript - 后端服务集成指南

本文档旨在为前端项目（Chat Web）提供 `video-chat-transcript` 后端服务的集成说明、API 协议定义及数据结构参考。

## 1. 项目概览

**Video Chat Transcript** 是一个基于视频字幕数据的 RAG（检索增强生成）问答系统。核心目标是允许用户针对大量的视频内容（如解脱园、Luang Por Pramote 等）进行提问，系统检索相关字幕片段并生成回答。

### 核心能力
- **视频字幕检索**：基于语义搜索查找相关视频片段。
- **智能问答**：利用 LLM 结合检索到的上下文回答用户问题。
- **流式响应**：支持打字机效果的实时回答。
- **多语言支持**：处理中文、英文、泰文等多种字幕格式。

## 2. 后端服务架构 (Context)

前端开发者需要了解以下后端结构，以便理解数据的来源和处理方式：

- **入口文件**: `backend/main.py` (FastAPI 服务入口)
- **核心服务**: `backend/services/`
    - `retrieval.py`: 负责从向量库或数据库中检索相关字幕。
    - `answering.py`: 负责构建 Prompt 并调用 LLM 生成回答。
    - `workflows/workflow.py`: 编排整个“查询 -> 检索 -> 回答”的流程。
- **数据源**:
    - SQLite: `data/video_transcript.db` (存储结构化的字幕数据、视频元数据)。
    - CSV/Raw: `data/merged_articles/` (合并后的文本文件)。

## 3. API 接口定义

后端提供标准的 Chat 接口，兼容 OpenAI API 格式，但在内部实现了 RAG 逻辑。

### 3.1 聊天接口 (Chat API)

*   **Endpoint**: `/chat` (假设基于 standard FastAPI 路由，需在 `backend/main.py` 确认具体前缀)
*   **Method**: `POST`
*   **Content-Type**: `application/json`

#### 请求参数 (Request)

```json
{
  "messages": [
    {
      "role": "user",
      "content": "如何保持正念？"
    }
  ],
  "stream": true,            // 推荐开启流式传输
  "temperature": 0.7,
  "model": "models/lpm",     // 后端默认模型标识
  "enable_l0_retrieval": true, // (可选) 开启 L0 级检索
  "enable_l1_retrieval": true  // (可选) 开启 L1 级检索
}
```

#### 响应格式 (Response - Streaming)

后端使用 SSE (Server-Sent Events) 返回数据块。根据代码分析 (`ChatService`)，支持两种格式，前端建议优先适配 **OpenAI 兼容格式**。

**数据流示例 (OpenAI Format):**

```json
data: {"id": "uuid...", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": "保持"}, "finish_reason": null}]}
data: {"id": "uuid...", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": "正念"}, "finish_reason": null}]}
data: {"id": "uuid...", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
```

> **注意**: 后端日志显示可能存在自定义的 `chat_response` 类型块，前端解析层应具备一定的容错能力。如果 `chunk.type == 'chat_response'`，内容可能位于 `chunk.content` 中。

### 3.2 引用来源 (Citations) - *[规划中]*

RAG 系统通常需要在回答中附带引用来源。目前后端数据结构支持导出以下信息，前端应预留 UI 展示位置：
- **Video ID**: YouTube 视频 ID (如 `0vy7u91LueQ`)。
- **Timestamp**: 字幕开始时间 (Start Time) 和结束时间 (End Time)。
- **Text**: 原始字幕文本。

## 4. 数据库 schema 参考

为了让前端理解“引用”由什么组成，以下是核心数据表结构（基于 `db/schema.sql` 推断）：

*   **videos**: 存储视频元数据 (id, title, url)。
*   **subtitles / segments**: 存储具体的字幕行。
    *   `video_id`: 关联视频。
    *   `start_time`: 开始时间（秒）。
    *   `content`: 字幕文本。

## 5. 前端开发注意事项

1.  **Markdown 渲染**: 后端生成的回答通常是 Markdown 格式，前端必须支持 Markdown 渲染（推荐 `react-markdown`）。
2.  **WebSocket vs HTTP**: 虽然代码库中有 WebSocket (`ChatView` 组件)，但目前的 `ChatService` 主要表现为支持 HTTP Streaming。前端新项目建议优先实现 HTTP Streaming，简单且健壮。
3.  **多轮对话**: 必须在请求的 `messages` 数组中携带历史上下文，后端依赖此进行 Query Rewriting (查询重写)。
4.  **环境配置**:
    *   后端默认运行在 `http://127.0.0.1:8000` (参考 `cli_web` 函数)。
    *   确保前端代理 (Proxy) 配置正确，避免 CORS 问题。

---
*Created by Gemini for Frontend Integration Context*
