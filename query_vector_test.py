#!/usr/bin/env python3
"""
Ad-hoc query tester:
1. 使用 DashScope text-embedding-v3 将 query 向量化。
2. 在 Qdrant collection 中检索 top_k 段落（含 payload）。
3. 可选：将候选传给 DashScope gte-rerank，再查看 top_n 排名。

用法示例：
    export QDRANT_URL=...
    export QDRANT_API_KEY=...
    export DASHSCOPE_API_KEY=...
    source venv/bin/activate
    python tools/query_vector_test.py \\
        --collection segments_zh \\
        --vector-name text-embedding-v3 \\
        --query "如何练习正念？" \\
        --top-k 20 --rerank-top 5
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, Optional


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query Qdrant collection with DashScope embeddings + rerank.")
    parser.add_argument("--collection", required=True, help="Qdrant collection name.")
    parser.add_argument("--vector-name", help="Qdrant vector name if collection uses named vectors.")
    parser.add_argument("--query", required=True, help="User question.")
    parser.add_argument("--top-k", type=int, default=20, help="Qdrant search top_k (default: 20).")
    parser.add_argument("--rerank-top", type=int, default=5, help="DashScope rerank top_n (default: 5).")
    parser.add_argument("--embedding-model", default="text-embedding-v3", help="DashScope embedding model (default: text-embedding-v3).")
    parser.add_argument("--rerank-model", default="gte-rerank", help="DashScope rerank model (default: gte-rerank).")
    parser.add_argument("--max-tokens", type=int, default=500, help="截断 payload 文本的最大字符数（默认500）。")
    parser.add_argument(
        "--output-md",
        help="Optional path to write a Markdown report (question、top-k、rerank结果)。",
    )
    parser.add_argument(
        "--rewrite-query",
        action="store_true",
        help="启用查询改写（qwen-turbo）后再向量检索。",
    )
    parser.add_argument(
        "--rewrite-model",
        default="qwen-turbo",
        help="查询改写所用 DashScope 模型（默认 qwen-turbo）。",
    )
    return parser.parse_args()


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"[ERROR] Missing environment variable: {name}", file=sys.stderr)
        sys.exit(2)
    return value


class DashScopeEmbedder:
    def __init__(self, api_key: str, model: str) -> None:
        try:
            import dashscope  # type: ignore
            from dashscope import TextEmbedding  # type: ignore
        except ImportError as exc:
            raise RuntimeError("dashscope package missing (pip install dashscope).") from exc
        dashscope.api_key = api_key
        self._client = TextEmbedding
        self._model = model

    def embed(self, text: str) -> List[float]:
        resp = self._client.call(model=self._model, input=text)
        if getattr(resp, "status_code", 200) != 200:
            raise RuntimeError(f"DashScope embedding error: {resp.status_code} {resp.message}")
        output = getattr(resp, "output", None) or {}
        embeddings = (
            getattr(output, "embeddings", None)
            or getattr(output, "text_embedding", None)
            or output.get("embeddings")
            or output.get("text_embedding")
        )
        if not embeddings:
            raise RuntimeError("DashScope embedding returned empty result.")
        item = embeddings[0] if isinstance(embeddings, list) else embeddings
        vector = (
            item.get("embedding")
            if isinstance(item, dict)
            else getattr(item, "embedding", None)
        )
        if not isinstance(vector, list):
            raise RuntimeError("DashScope embedding payload malformed.")
        return vector


def rerank_with_dashscope(
    api_key: str,
    model: str,
    query: str,
    docs: List[str],
    top_n: int,
) -> List[Dict[str, Any]]:
    try:
        import dashscope  # type: ignore
        from dashscope import TextReRank  # type: ignore
    except ImportError as exc:
        raise RuntimeError("dashscope package missing (pip install dashscope).") from exc
    dashscope.api_key = api_key
    resp = TextReRank.call(
        model=model,
        query=query,
        documents=docs,
        return_documents=True,
        top_n=top_n,
    )
    if getattr(resp, "status_code", 200) != 200:
        raise RuntimeError(f"DashScope rerank error: {resp.status_code} {resp.message}")
    output = getattr(resp, "output", None) or {}
    items = output.get("results") or []
    return items


def rewrite_query(api_key: str, model: str, user_question: str) -> str:
    system_prompt = """你是一个隆波帕默尊者佛法问答系统的智能助手。
你的任务是根据用户的输入，提取出用于检索佛法数据库的核心问题。
请去除寒暄语（如“你好”、“师兄”）、无关的背景描述，将问题转化为一个清晰、独立的、适合作为搜索关键词的查询语句。
如果用户的问题包含代词（如“这个”、“它”），请结合上下文（如果上下文不存在，则根据问题内容进行合理的明确）或保留原意进行明确。
不要回答用户的问题，不要增加任何解释性文字，只输出改写后的查询语句。
"""
    try:
        import dashscope  # type: ignore
        from dashscope import Generation  # type: ignore
    except ImportError as exc:
        raise RuntimeError("dashscope package missing (pip install dashscope).") from exc
    dashscope.api_key = api_key
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_question},
    ]
    resp = Generation.call(model=model, messages=messages)
    if getattr(resp, "status_code", 200) != 200:
        raise RuntimeError(f"DashScope rewrite error: {resp.status_code} {resp.message}")
    output = getattr(resp, "output", None)
    text = ""
    if output is not None:
        if hasattr(output, "choices") and output.choices:
            choice = output.choices[0]
            if isinstance(choice, dict):
                text = choice.get("message", {}).get("content", "")
            else:
                text = getattr(choice.message, "content", "")
        elif hasattr(output, "text"):
            text = output.text
    rewritten = (text or "").strip()
    if not rewritten:
        raise RuntimeError("DashScope rewrite returned empty text.")
    return rewritten


def format_payload(payload: Dict[str, Any], limit: int) -> str:
    text = payload.get("text_readable") or ""
    topic = payload.get("topic_title") or ""
    prefix = f"[{topic}] " if topic else ""
    body = text.strip()
    combined = f"{prefix}{body}"
    if len(combined) > limit:
        return combined[:limit] + "..."
    return combined


def main() -> None:
    args = parse_args()
    qdrant_url = get_env("QDRANT_URL")
    qdrant_api_key = get_env("QDRANT_API_KEY")
    dashscope_key = get_env("DASHSCOPE_API_KEY")

    search_query = args.query
    rewrite_used = False
    rewrite_error: Optional[str] = None
    if args.rewrite_query:
        try:
            rewritten = rewrite_query(dashscope_key, args.rewrite_model, args.query)
            print(f"[INFO] Rewritten query: {rewritten}")
            search_query = rewritten
            rewrite_used = True
        except Exception as exc:  # pylint:disable=broad-except
            rewrite_error = str(exc)
            print(f"[WARN] Query rewrite failed, fallback to original question: {exc}", file=sys.stderr)

    embedder = DashScopeEmbedder(dashscope_key, args.embedding_model)
    query_vector = embedder.embed(search_query)
    print(f"[INFO] Query embedding dim={len(query_vector)} (text=`{search_query}`)")

    from qdrant_client import QdrantClient

    client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
    search_kwargs = {
        "collection_name": args.collection,
        "query": query_vector,
        "limit": args.top_k,
        "with_payload": True,
        "with_vectors": False,
    }
    if args.vector_name:
        search_kwargs["using"] = args.vector_name
    response = client.query_points(**search_kwargs)
    hits = getattr(response, "points", None) or []
    if not hits:
        print("[INFO] Qdrant returned no hits.")
        return

    print("\n[Qdrant Top-K]")
    docs_for_rerank: List[str] = []
    payload_map: Dict[int, Dict[str, Any]] = {}
    qdrant_records: List[str] = []
    for idx, hit in enumerate(hits, 1):
        payload = hit.payload or {}
        preview = format_payload(payload, args.max_tokens)
        score = getattr(hit, "score", None)
        print(f"{idx:>2}. score={score:.4f} segment_id={payload.get('segment_id')} -> {preview}")
        doc_text = payload.get("text_readable") or payload.get("text") or preview
        docs_for_rerank.append(doc_text)
        payload_map[idx - 1] = payload
        qdrant_records.append(
            f"{idx}. score={score:.4f} segment_id={payload.get('segment_id')}\n   {preview}"
        )

    rerank_records: List[str] = []
    if args.rerank_top and docs_for_rerank:
        print("\n[Rerank Results]")
        rerank_items = rerank_with_dashscope(
            dashscope_key,
            args.rerank_model,
            args.query,
            docs_for_rerank,
            top_n=min(args.rerank_top, len(docs_for_rerank)),
        )
        for item in rerank_items:
            pos = item.get("index")
            score = (
                item.get("relevance_score")
                or item.get("score")
                or item.get("relevance")
            )
            payload = payload_map.get(pos or 0) or {}
            preview = format_payload(payload, args.max_tokens)
            score_str = f"{score:.4f}" if isinstance(score, (float, int)) else str(score)
            orig_rank = (pos or 0) + 1
            print(f"- rerank_score={score_str} (orig#{orig_rank}) segment_id={payload.get('segment_id')} -> {preview}")
            rerank_records.append(
                f"- rerank_score={score_str} (orig#{orig_rank}) segment_id={payload.get('segment_id')}\n  {preview}"
            )

    if args.output_md:
        lines = [
            "# Query Debug Report",
            "",
            f"- **Question:** {args.query}",
            f"- **Search Query:** {search_query}",
            f"- **Collection:** {args.collection}",
            f"- **Vector name:** {args.vector_name or '(default)'}",
            f"- **Embedding model:** {args.embedding_model}",
            f"- **Rerank model:** {args.rerank_model if args.rerank_top else 'N/A'}",
            f"- **Query rewrite:** {'enabled' if rewrite_used else 'disabled'}",
        ]
        if rewrite_error:
            lines.append(f"- **Rewrite error:** {rewrite_error}")
        lines.append("")
        lines.append("## Qdrant Top-K")
        if qdrant_records:
            lines.extend(qdrant_records)
        else:
            lines.append("_No hits returned._")
        lines.append("")
        lines.append("## Rerank Results")
        if rerank_records:
            lines.extend(rerank_records)
        else:
            lines.append("_Rerank disabled or no results._")
        with open(args.output_md, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        print(f"\n[INFO] Markdown report written to {args.output_md}")


if __name__ == "__main__":
    main()
