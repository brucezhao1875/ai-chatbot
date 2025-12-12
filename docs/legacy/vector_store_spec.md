# Qdrant Vector Store Upload Spec

## Scope
- 语料：已完成语义分段的中文段落 ~1,895 条（后续可扩展多语言）。
- 平台：Qdrant Cloud 托管版，作为统一向量数据库。
- 目标：明确从 DB/CSV 读取段落 → 生成向量 → 写入 Qdrant 的数据结构、状态管理与监控规范。

## Document-to-Vector Mapping
- 粒度：**一段字幕 = 一个向量 (point)**。
- Embedding 文本：`embedding_text = f"{topic_title} | {','.join(keywords)} | {text_readable}"`  
  - 若不希望 topic/keywords 参与检索，可改为纯 `text_readable`。  
  - 调用 DashScope `text-embedding-v3` 生成向量（维度以实际模型为准）。
- Qdrant Collection 设置：
  - `distance = "Cosine"`（或 `Dot`），`vector_size` 与 embedding 模型一致。
  - `payload` 自由结构化存储 metadata。

## Metadata Schema（Qdrant Payload）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `segment_id` | str | 主键，同时作为 Qdrant point `id`。推荐格式：`"{video_id}:{lang_primary}:{start}-{end}"`，其中 `lang_primary ∈ {zh,en,th}`，`start/end` 为整数秒。 |
| `video_id` | str | 视频唯一标识。 |
| `video_title` | str | 展示用途。 |
| `lang` | str | 例：`zh-Hans`。同时在 `segment_id` 中使用 `lang_primary` 进行标准化（`zh/en/th`）。 |
| `segment_type` | str | `dharma_talk` / `qa` / `other`。 |
| `start_time_seconds` | float | 段落起始秒（写入向量库的 `segment_id` 使用其整数部分）。 |
| `end_time_seconds` | float | 段落结束秒（写入向量库的 `segment_id` 使用其整数部分）。 |
| `duration_seconds` | float | 方便排序/过滤。 |
| `topic_title` | str | 简体主题。 |
| `keywords` | list[str] 或逗号分隔 | 3-5 关键词，便于筛选。 |
| `text_readable` | str | 简体、补标点的全文，用于展示。 |
| `source_url` | str | video link。 |
| `created_at` / `updated_at` | iso str | 审计信息。 |

> `text_raw`、`question_summary` 不再写入向量库；如需展示繁体字幕，可在前端另行加载。

## 脚本角色与并发（single vs batch）
- 单视频执行（single）：针对单个 `video_id`，完成“读取 segments → 生成 embedding_text → 调用模型得到向量 → upsert 到 Qdrant → 回写状态”的完整流程。
- 批量调度（batch）：选择一批候选段落，做原子认领与并发执行；控制并发、限流与重试，并在完成后回写状态与审计信息。
- 并发规范：
  - 原子认领：将候选项置为 `queued`，确保同一段不会被并发处理两次。
  - 失败重试：`none → queued → retry_1 → retry_2 → retry_3 → failed`；达到 `failed` 后需人工或批量重置。
  - 只读事实：查询事实数据始终从 `segments` 读取；过程/状态仅在状态表中维护。

## Upload Workflow
1. **候选查询与懒创建认领**  
   - 来源：`segments` 表。  
   - 条件：从事实表选出尚未向量化或需要重试的段落。  
   - 懒创建：认领时插入状态表（不存在则创建）并直接置为 `queued`，减少“全量插入 none”的垃圾项：
     ```sql
     INSERT OR IGNORE INTO segment_vector_sync (segment_id, target, status)
     VALUES (:segment_id, 'qdrant_cloud', 'queued');
     UPDATE segment_vector_sync
     SET status='queued', queued_at=datetime('now')
     WHERE segment_id=:segment_id AND target='qdrant_cloud' AND status IN ('none','retry_1','retry_2','retry_3');
     ```
2. **向量生成**  
   - 构造 `embedding_text`。  
   - 调用 DashScope `text-embedding-v3` → 得到向量。  
   - 失败时写 `error_message` 并推进状态（进入对应 `retry_*`）。
3. **写入 Qdrant**  
   - 使用 `qdrant-client` 或 REST `POST /collections/{name}/points`，payload：  
     ```json
     {
       "points": [
         { "id": "segment_id", "vector": [...], "payload": { ...metadata... } }
       ]
     }
     ```  
   - 采用 upsert 语义（重复 `id` 会覆盖）。
4. **状态回写**  
   - 成功：`segment_vector_sync.status='done'`，记录 `uploaded_at` 与 `embedding_model/embedding_dim/embedding_at`（审计用）。  
   - 失败：状态沿 `none → retry_1 → retry_2 → retry_3 → failed` 推进，并写 `error_message`。  
   - 脚本异常退出时，重新认领 `queued` 状态即可。

### 安全检查（集合存在性）
- 在执行 upsert 之前，必须检查目标集合是否存在；如果不存在，报错并退出（不要擅自删除或重建集合）。
- 如集合存在但维度与当前模型不一致，应提示“使用匹配维度的模型/新集合名/人工重建”，而不是自动删除。

## DB 状态表设计（segment_vector_sync）
```sql
CREATE TABLE segment_vector_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT 'qdrant_cloud',
    status TEXT NOT NULL DEFAULT 'none', -- none/queued/done/failed/retry_1-3
    queued_at TEXT,
    uploaded_at TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    UNIQUE(segment_id, target),
    FOREIGN KEY(segment_id) REFERENCES segments(segment_id)
);
```
- 保留任务表以获得队列、重试与审计优势。  
- 认领时“懒创建”：不存在即 `INSERT ... queued`，减少前置“全量插入 none”。  
- 多目标/多语言：以“段落×目标”的行表达上传进度，查询事实仍从 `segments`，进度与审计看 `segment_vector_sync`。  
- 可在该表或向量库 `payload` 记录 `embedding_model/embedding_dim/embedding_at` 以便审计。

## 运行与监控
- **single**：单视频向量化与上传，串行或小并发执行。  
- **batch**：批量认领与并发执行，支持 `--limit/--parallel/--langs/--prioritize-short` 等参数。  
- **监控 SQL**：
  ```sql
  SELECT status, COUNT(*)
  FROM segment_vector_sync
  WHERE target='qdrant_cloud'
  GROUP BY status;
  ```
- **重试**：提供 CLI 将 `failed/retry_*` 重置为 `none`，或按 `segment_id/video_id` 指定重传。  
- **日志**：记录 DashScope/Qdrant API 错误、批次耗时，用于审计。

## 后续迭代
- 多语言：按 `lang` 拆分成不同 collection，或在 payload 中增加 `lang` 过滤。  
- 批量写入：使用 Qdrant `upsert` 批处理 + 并发 embedding 减少请求数。  
- 数据一致性：定期校验 DB 中 `status='done'` 的记录在 Qdrant 是否存在（可通过 point count 或 sample 查询）。
