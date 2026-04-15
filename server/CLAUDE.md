# server/CLAUDE.md

> 后端与智能体层开发指南（被操作 `server/` 目录时自动加载）
> 全局上下文见 [../CLAUDE.md](../CLAUDE.md)

## 1. 文件职责

| 文件 | 职责 | 关键函数 |
|---|---|---|
| `server.py` | FastAPI 主程序、所有 REST/SSE 端点、subprocess 编排 | `event_stream` 闭包 |
| `agent.py` | Claude CLI agentic loop 封装、prompt 构建、输出解析 | `run_detailed_query` · `run_qa_query` · `_run_claude_streaming` · `parse_agent_output` |
| `neo4j_mcp_server.py` | MCP Server：`query_neo4j` 工具（Cypher 查询） | `query_neo4j` |
| `ask_user_mcp_server.py` | MCP Server：`ask_user` 结构化澄清工具 | `ask_user` |
| `intend_understand/` | 旧的意图识别模块（已废弃，保留不用） | — |
| `backend_mock.py` | 早期 mock 实现（已废弃，不要改） | — |
| `.env` | Neo4j 连接、OpenAI key 等敏感配置 | — |
| `logs/` | 运行日志输出目录 | `agent.log` · `ask_user_mcp.log` · `neo4j_mcp.log` |

---

## 2. agent.py 架构

### 2.1 核心流程

```
run_detailed_query(page_path, block_ids, user_query, ...)
  ├─ resume 分支: 用户追问（有 resume_session_id）
  │    └─ _run_claude_streaming 直接走 --resume
  │
  └─ 正常分支: 首次交互
       ├─ 加载 wiki 页面 JSON
       ├─ find_blocks_with_ancestors() 提取选中 block + 祖先 neo4j 信息
       ├─ build_page_outline() 构建页面结构概览
       ├─ 拼 source_context（关联源码路径）
       ├─ 拼完整 prompt
       └─ _run_claude_streaming() → parse_agent_output() → 返回结果
```

### 2.2 `_run_claude_streaming` 的三种事件

```python
async for raw_line in proc.stdout:
    event = json.loads(line)

    # 1. system/init —— 捕获 session_id 用于 resume
    # 2. assistant + tool_use —— 工具调用（Read/Grep/ask_user/neo4j）
    #    → 拦截 ask_user 触发澄清回调
    # 3. result —— 最终文本输出，传给 parse_agent_output
```

**关键拦截点**：
- `tool_use.name == "mcp__ask-user__ask_user"` → 读 `pending.question.json` → `on_clarify` 回调 → 写 `pending.answer.json`
- 工具名里含 `Read` / `Grep` / `neo4j` 时调 `on_progress` 推送进度给前端

### 2.3 parse_agent_output 的输出格式

**三种可能返回**：

1. **QA 回答**（文本以 `@@QA_ANSWER@@` 开头）：
   ```python
   {"qa_answer": "markdown 格式回答", "session_id": "..."}
   ```

2. **修改指令**（结构化 block diff）：
   ```python
   {
     "insert_blocks": [...],
     "delete_blocks": [...],
     "replace_blocks": [...],
     "session_id": "..."
   }
   ```

3. **新页面创建**（不常见）：
   ```python
   {"new_page_path": "...", "new_page": {...}, "session_id": "..."}
   ```

前端 `AnalysisView.handleAnalyze` 依次检查这三种情况。

### 2.4 修改指令的文本协议

模型输出格式：
```
---
action: replace | insert_after | delete
target: S74
source_ids: 1, 5
---
修改后的 markdown 正文
===
---
action: insert_after
...
```

多操作用 `===` 分隔，每个操作以 `---` header + body 形式。`parse_agent_output` 负责切分。

---

## 3. MCP 子服务器

### 3.1 neo4j_mcp_server

```bash
python server/neo4j_mcp_server.py   # 单独测试
```

- 暴露 `query_neo4j(cypher_query)` 工具
- 读 `.env` 中的 `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD`
- 未配置时返回占位字符串，不抛异常
- Cypher 语句常用格式：
  ```cypher
  MATCH (n)-[r]-(m) WHERE id(n) = <neo4j_id> RETURN type(r), m.name
  ```

### 3.2 ask_user_mcp_server

- 暴露 `ask_user(question, options, multi_select)` 工具
- 通信目录：`$ASK_USER_COMM_DIR`（默认 `/tmp/ask_user_comm/`）
- **阻塞轮询模型**：写 `pending.question.json` → 轮询 `pending.answer.json` → 返回 `tool_result`
- 超时：默认 300s，超时后返回 "用户未在规定时间内回答"

**重要**：MCP server 和主 agent 进程通过**文件系统**通信，不走管道。因为 agent.py 是通过 subprocess 调 claude CLI，CLI 又通过 stdio 调 MCP，三层嵌套，直接共享内存不可能。

---

## 4. server.py 的 SSE 模式

所有长耗时请求（`/api/detailed_query` · `/api/qa_query`）都用相同的模式：

```python
async def event_stream():
    progress_queue: asyncio.Queue = asyncio.Queue()

    def on_progress(msg):
        progress_queue.put_nowait(("progress", msg))

    async def on_clarify(clarify_data):
        session_key = str(uuid4())
        future = asyncio.get_event_loop().create_future()
        _pending_clarifications[session_key] = future
        progress_queue.put_nowait(("clarification", clarify_data, session_key))
        answer = await future        # ← 阻塞等待用户通过 /api/clarification_answer 回答
        return answer

    task = asyncio.create_task(run_detailed_query(..., on_progress, on_clarify))

    while not task.done():
        item = await asyncio.wait_for(progress_queue.get(), timeout=0.3)
        yield f"data: {json.dumps(item)}\n\n"

    yield f"data: {json.dumps({'type': 'result', 'data': task.result()})}\n\n"
```

**关键点**：
- `_pending_clarifications` 是模块级 dict：`{session_key: Future}`
- `/api/clarification_answer` 端点通过 `session_key` 找到 Future 并 `set_result()`
- 两个端点（detailed_query / qa_query）都有一模一样的澄清机制

---

## 5. 子进程安全管理

**必须遵守的模式**：
```python
proc = await asyncio.create_subprocess_exec(*cli_cmd, ...)
try:
    async for raw_line in proc.stdout:
        ...
    await proc.wait()
except (Exception, asyncio.CancelledError):
    if proc.returncode is None:
        proc.terminate()    # SIGTERM
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()     # SIGKILL
            await proc.wait()
    raise
```

**为什么**：`claude` CLI 一次调用可能烧几千 tokens 几十秒。父进程被中断（HTTP client 断开 / 用户刷新页面）时如果不清理子进程，它会孤儿继续运行，空烧用户的 token 配额。

---

## 6. 改动常见场景

### 6.1 加一个新的意图类型（比如"解释类"）

1. `agent.py` 修改 `SYSTEM_PROMPT` 的「意图判断」段，加入新类型的特征
2. 选择一个前缀（比如 `@@EXPLAIN@@`）
3. `parse_agent_output` 顶部加入 `if text.startswith("@@EXPLAIN@@"): return {"explain": ...}`
4. `AnalysisView.handleAnalyze` 在 qa_answer/new_page/modification 三个分支之前加入新分支

### 6.2 给澄清工具加一个新字段（比如 `priority`）

1. `ask_user_mcp_server.py:ask_user` 签名加参数、写入 `pending.question.json`
2. `agent.py:_run_claude_streaming` 的 `ask_user` 拦截分支从问题文件读取新字段，加入 `clarify_data`
3. `server.py` 的 `on_clarify` SSE 事件 payload 加字段
4. 前端 `codenexusWikiService.ts` onClarify 回调签名扩展
5. 前端 `ChatMessage` 渲染新字段

### 6.3 修改 SYSTEM_PROMPT

**谨慎操作**。当前 prompt 经过多轮调优，修改前先理解：
- 意图判断规则的优先级：提问 > 修改 > 澄清
- 澄清触发词列表
- `@@QA_ANSWER@@` 前缀约束

改动后用真实样例（至少 3 种意图各一个）回归测试。

---

## 7. 环境变量速查

| 变量 | 默认 | 影响 |
|---|---|---|
| `WIKI_ROOT_PATH` | `demo.py` 自动设置 | 页面文件根目录 |
| `CLAUDE_MODEL` | `sonnet` | 智能体模型 |
| `CLAUDE_MAX_TOKENS` | `4096` | 单次输出上限 |
| `MAX_TOOL_ROUNDS` | `15` | agentic loop 最大轮次 |
| `SOURCE_ROOT_PATH` | 空 | 智能体 cwd（Read 工具的相对路径根） |
| `NEO4J_URI/USER/PASSWORD` | 空 | 未配置时 `query_neo4j` 返回占位 |
| `ASK_USER_COMM_DIR` | `/tmp/ask_user_comm` | MCP ask_user 通信目录 |
| `OPENAI_API_KEY` | — | **仅 build_wiki_index.py 使用**，agent 不需要 |

---

## 8. 反模式（后端专属）

### ❌ 不要在 agent.py 用同步 subprocess.run
会阻塞整个 event loop。必须用 `asyncio.create_subprocess_exec`。

### ❌ 不要在 event_stream 里 `await task`
`task.result()` 只能在 `task.done()` 后调用，否则会永久阻塞。正确模式是 `while not task.done()` 循环 drain queue。

### ❌ 不要给 SYSTEM_PROMPT 加"请一步一步思考"之类的话
Claude Sonnet 不需要 CoT 提示，加了反而会让它输出不必要的思考过程污染 `@@QA_ANSWER@@` 前缀。

### ❌ 不要把大 prompt 直接写在 `claude -p "..."` 里
非常长的 prompt 走命令行参数可能被 shell 截断。如果未来需要更长 prompt，用 stdin 或临时文件传递。

### ❌ 不要手动 import `mcp` 然后自己写 server
`ask_user_mcp_server.py` 用的是 `fastmcp`（简化框架），新增 MCP server 也必须用它，别用 raw `mcp` SDK。

### ❌ 不要在 parse_agent_output 里做复杂的 JSON 修复
当前只做"最宽松"的格式容错（去 markdown 包裹 + 提取第一个 `{...}`）。遇到解析失败应该让上层降级到 fallback 行为，不要在这里硬塞 AI repair。

---

## 9. 调试技巧

### 9.1 看完整 prompt
`SYSTEM_PROMPT` + 实际 user prompt 在 `agent_logger.debug` 级别记录：
```bash
DEBUG=1 python demo.py ...   # （需要自己加环境变量控制）
```
或者直接改 `agent_logger.setLevel(logging.DEBUG)`。

### 9.2 验证 CLI 子进程参数
改 `_run_claude_streaming` 前几行加 `print(cli_cmd)` 打印完整命令,手动在 shell 里跑看行为。

### 9.3 孤儿进程检查
```bash
ps aux | grep claude   # 看有没有残留的 claude 子进程
pkill -f "claude -p"   # 清理所有残留
```

### 9.4 MCP 通信文件
```bash
ls -la /tmp/ask_user_comm/   # 看当前是否有待响应的问题
cat /tmp/ask_user_comm/pending.question.json   # 看模型问了什么
```

---

## 10. 不要碰的东西

- **`backend_mock.py`** — 废弃的 mock，不是 bug，不要改
- **`intend_understand/` 目录** — 旧的意图识别模块，已被 SYSTEM_PROMPT 取代，保留不删
- **`user_data/` 目录** — 空目录，后续用户配置预留
- **parse_agent_output 里 `insert_blocks` 的格式** — 前端有严格契约，字段名改了前端会炸
