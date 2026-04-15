# CLAUDE.md

> Hole9Wiki 项目开发指南 — 供 Claude session 快速建立心智模型
> 子目录详细约定：[server/CLAUDE.md](server/CLAUDE.md) · [frontend/CLAUDE.md](frontend/CLAUDE.md)

## 1. 30 秒心智模型

**Hole9Wiki** 是一个交互式代码 Wiki 平台：
- **输入**：AI 预先生成的 `.meta.json` 格式 Wiki 数据（含源码引用 `source_id` 和 Neo4j 实体映射 `neo4j_id/neo4j_source`）
- **浏览**：React 前端把 block 树渲染为可折叠页面 + Mermaid 图表 + 源码面板
- **交互**：用户选中 block 后由 `claude -p` 子进程（agentic loop）读取源码并生成修改建议或回答

三条功能主线：
1. **浏览** — 页面切换、源码跳转、搜索、Mermaid 可视化
2. **编辑** — 选中 block → AI 生成 diff → Diff 预览 → 应用
3. **问答** — 任意提问 → AI 读源码 → Markdown 回答 → 多轮追问

关键信号：当前智能体通过 **MCP `ask_user` 工具**实现结构化澄清，通过 **`claude --resume <session_id>`** 实现多轮追问上下文保持。

---

## 2. 三层架构

| 层 | 位置 | 端口 | 角色 |
|---|---|---|---|
| **前端** | `frontend/` (React 19 + Vite + Tailwind) | `:3000` | UI 渲染、SSE 消费、Diff 预览 |
| **后端** | `server/server.py` (FastAPI) | `:11219` | REST/SSE、subprocess 管理、文件 IO |
| **智能体** | `server/agent.py` → `claude` CLI 子进程 | — | agentic loop、工具调用 |

**通信方式**：
- 前端 ↔ 后端：REST + **Server-Sent Events**（SSE）
- 后端 ↔ Claude CLI：`asyncio.create_subprocess_exec` + `--output-format stream-json`
- Claude CLI ↔ MCP：stdio（`neo4j_mcp_server.py` · `ask_user_mcp_server.py`）

**启动**：
```bash
python start.py /path/to/wiki-data      # 前后端一起
python demo.py /path/to/wiki-data c     # 仅后端 + 数据转换
python demo.py /path/to/wiki-data c --build-index   # + 构建 LLM 路由索引
```

---

## 3. 关键文件速查

### 改「XXX」时看这里

| 要修改的功能 | 入口文件:行 | 相关文件 |
|---|---|---|
| **意图识别**（QA/修改分流） | `server/agent.py` `SYSTEM_PROMPT` | `parse_agent_output` 识别 `@@QA_ANSWER@@` 前缀 |
| **澄清机制** | `server/ask_user_mcp_server.py` | `agent.py:_run_claude_streaming` 拦截 `ask_user` tool_use |
| **多轮追问**（会话恢复） | `server/agent.py:run_detailed_query` resume 分支 | `frontend/AnalysisView:agentSessionIdRef` |
| **选中 block 提问/修改** | `frontend/components/AnalysisView.tsx:handleAnalyze` | `codenexusWikiService.detailedQuery` |
| **自由问答** | `server/agent.py:run_qa_query` | `server.py:POST /api/qa_query` |
| **Diff 模式** | `frontend/hooks/useDiffMode.ts` | `DiffConfirmBar` 组件 |
| **搜索高亮** | `frontend/components/wiki/WikiContent.tsx:119-190` | `MutationObserver` + CSS Custom Highlight API |
| **Wiki 页面导航** | `frontend/components/WikiPageNavigator.tsx` | `buildPageTree()` |
| **Mermaid 渲染** | `frontend/components/Mermaid.tsx:initMermaid` | SVG 后处理做暗色适配 |
| **源码面板** | `frontend/components/SourceCodePanel.tsx` | `frontend/hooks/useSourcePanel.ts` |
| **聊天消息** | `frontend/components/chat/ChatMessage.tsx` | ReactMarkdown 渲染、澄清选项 UI |
| **浮动机器人图标** | `AnalysisView.tsx` 中「AI 助手按钮」块 | 由 `isChatOpen` 切换 |
| **Wiki 路由索引构建** | `build_wiki_index.py` | 输出到 `.index/wiki_index.json` |
| **Wiki 数据转换** | `markdown_parser.py` | 把 `.meta.json`/`.md` 转为前端 JSON |

---

## 4. 核心数据流

### 4.1 浏览 Wiki 页面

```
用户点击页面
  → AnalysisView.handlePageSwitch(pagePath)
  → useWikiPages.handlePageSwitchBase() 防抖 + 去重
  → codenexusWikiService.fetchPage() → POST /api/fetch_page
  → parseWikiPageToBlocks() 转为 WikiBlock[]
  → setBlocks() → WikiContent 渲染
  → usePageTabs.openTab() 同步 tab 栏
```

### 4.2 选中 block → 智能体修改/问答

```
1. WikiContent 中勾选 block
   → useBlockSelection 维护 selectedBlockIds: Set<string>
2. chat 输入框 Ctrl+Enter 提交
   → AnalysisView.handleAnalyze
3. 有选中 → detailedQuery()  |  无选中 → qaQuery()
4. POST /api/detailed_query (SSE)
5. server.py event_stream:
   - asyncio.create_task(run_detailed_query)
   - 通过 progress_queue 异步转发事件
6. agent.py run_detailed_query:
   - 提取选中 block + 祖先链 neo4j 信息
   - 构建 prompt（source_context 注入源码路径）
   - spawn claude CLI 子进程
7. _run_claude_streaming 解析 stream-json:
   - tool_use 事件 → Read/Grep/ask_user
   - 遇到 ask_user → on_clarify 回调 → SSE clarification 事件
   - result 事件 → parse_agent_output() 解析
8. 前端收到 result:
   - qa_answer → finalizeAssistantMessage()
   - modification → enterDiffMode() → 渲染红绿对比
9. 用户点「应用变更」→ applyDiffChanges() → POST /api/apply_changes
```

### 4.3 澄清机制（完整链路）

```
模型决定调用 ask_user 工具
  → MCP server 收到 ask_user(question, options, multi_select)
  → 写 /tmp/ask_user_comm/pending.question.json
  → 阻塞轮询等待 pending.answer.json
  ↕
agent.py _run_claude_streaming 看到 tool_use 事件
  → 从通信目录读取问题文件
  → on_clarify 回调(question, options)
  → server.py on_clarify: 发送 SSE clarification 事件 + 阻塞等 Future
  → 前端 ChatMessage 渲染选项按钮
  → 用户选择 → POST /api/clarification_answer
  → server.py Future.set_result(answer)
  → agent.py 写 pending.answer.json
  ↕
MCP server 读到回答 → 返回 tool_result → 模型继续推理
```

### 4.4 追问（无 block 但有 session）

```
AnalysisView.agentSessionIdRef.current 有值
  → detailedQuery(pagePath, [], prompt, ..., resumeSessionId)
  → POST /api/detailed_query 带 resume_session_id
  → run_detailed_query 走 resume 分支
  → claude --resume <session_id>
  → 继承前一次会话的已读源码上下文，继续推理
```

**Session 生命周期**：
- 选中 block 提问 → 建立 session
- 不选 block + 有 session → resume
- 应用/放弃 diff → **清除 session**
- 切换分析类型 → **清除 session**

---

## 5. 项目约定

### Python (`server/`)
- 全异步：`async def` + `asyncio`，不要引入同步阻塞 IO
- 子进程必须 `try/except` + `SIGTERM`（5s 超时）→ `SIGKILL`，避免孤儿 claude CLI 烧 token
- 日志：`agent_logger.info` 关键事件，`agent_logger.debug` 完整 prompt
- SystemPrompt 常量全大写下划线：`SYSTEM_PROMPT`、`QA_SYSTEM_PROMPT`、`MODIFY_PROMPT`

### React (`frontend/`)
- React 19 函数组件 + hooks，**不用 class 组件**
- 共享状态集中到 hooks：`useWikiPages` · `useBlockSelection` · `useSourcePanel` · `useDiffMode` · `usePageTabs`
- **暗色模式**：所有新组件必须接受 `isDarkMode` prop，亮暗分支写在 className 模板字符串里
- **memo 谨慎**：`WikiContent` / `WikiBlockRenderer` 是 memo 组件，传 props 时注意引用稳定（别用 inline object/array）
- **hooks 顺序**：所有 hooks（包括 useCallback/useMemo）必须在 early return 之前调用

### 命名
- React 组件 PascalCase，hook `use*`，服务 `*Service`
- Python snake_case，FastAPI 路由 `/api/snake_case`
- 事件类型 SSE：`progress` · `clarification` · `result` · `error`

### 数据结构
- `WikiBlock` 定义在 `frontend/types.ts`，递归树结构（`children: WikiBlock[]`）
- 后端 block 叫 `markdown_content`（树）+ `source_id`（扁平列表）
- 页面文件名直接作为 `page_path`，比如 `"总揽.json"` 或 `"门户系统/订单管理.json"`

---

## 6. 反模式警告（AI 容易踩的坑）

### ❌ 不要给 WikiContent 的父容器加 `overflow-auto`
会截断 WikiBlockRenderer 的 DOM，破坏搜索高亮 MutationObserver 的节点定位。

### ❌ 不要在 `run_detailed_query` 里直接解析 `@@CLARIFY@@` 文本
已经改为 MCP `ask_user` 工具。`@@CLARIFY@@` 前缀**仅作为旧 session resume 的回退兼容**保留，新代码走 `ask_user` 工具调用分支。

### ❌ 不要把 `wiki_index.json` 放到 `wiki_result/` 根目录
会被 wiki 扫描器当成普通 wiki 页面。当前位置：`wiki_result/.index/wiki_index.json`，扫描器会跳过 `.index/`。

### ❌ 不要在 useCallback / useMemo 之前 early return
React 19 会抛 `"Rendered more hooks than during the previous render"`。所有 hooks 必须在 early return 之前调用。

### ❌ 不要随便改 `useWikiPages.handlePageSwitchBase` 的防抖 ref
`latestRequestedPageRef` 和 `loadingPageRef` 用于处理连续切换时的 stale response，破坏后会导致页面内容错乱。

### ❌ 不要给 `AnalysisView` 的「Main Content Area」加 flex-col
原 `flex-1 overflow-hidden w-full pb-[200px]` 结构下，子元素 `flex-1` 无效，子卡片靠内容撑开高度。改成 flex 容器会破坏 `pb-200` 给底部对话框预留空间的逻辑。

### ❌ 不要手动设置 Mermaid 节点的 fill 颜色
暗色模式通过 `Mermaid.tsx` 的 SVG 后处理自动转换（白色 → 暗灰，深色文字 → 浅色），手动改会破坏亮色模式或保留着色的节点。

### ❌ 不要假设 `block.sources` 一定存在
多数 block 的 sources 来自页面级 `source_id` 列表而非 block 自身。`WikiBlock.tsx` 的右键查看源码功能通过"看 name 是否是源码路径"启发式匹配，不依赖 sources 字段。

---

## 7. 调试入口

### 日志文件
```bash
tail -f server/logs/agent.log           # 智能体完整过程
tail -f server/logs/ask_user_mcp.log    # ask_user MCP 工具
tail -f server/logs/neo4j_mcp.log       # Neo4j MCP 工具
```

### 手动触发
```bash
# 测试 Claude CLI 直连
claude -p "test" --model sonnet --output-format stream-json

# 测试 OpenAI index 生成（纯规则模式，零成本）
python build_wiki_index.py /path/to/wiki_result --no-llm

# 强制重建 index
python build_wiki_index.py /path/to/wiki_result --force

# 清理 index 缓存
rm -rf /path/to/wiki_result/.index/meta
```

### 常见问题定位

| 症状 | 先看 |
|---|---|
| 提问/修改无响应 | `server/logs/agent.log` 最后几行 |
| 澄清选项不展示 | `ask_user_mcp.log` + 浏览器 Network 面板的 SSE clarification 事件 |
| 追问丢失上下文 | `AnalysisView.agentSessionIdRef.current` 是否被意外清除 |
| 搜索高亮不显示 | 浏览器 Console：`CSS.highlights.get('wiki-search')` |
| Mermaid 暗色失真 | `Mermaid.tsx` 的 SVG 后处理是否被内联 `style` 属性覆盖 |
| 子进程孤儿 | `ps aux \| grep claude` 查找未清理的 CLI 进程 |

---

## 8. 已知债务（不是 bug，不要"修复"）

- **`server/backend_mock.py`** — 早期 mock 实现，已不使用但保留作参考
- **`server/user_data/`** — 空目录，后续用户配置预留
- **`frontend/components/CodeNexusAnalysisView.tsx`** — 早期版本，已被 `AnalysisView` 替代；TS 类型报错是已知的，**不要尝试修复**（未来可能整体删除）
- **`wiki_index.json` 目前只供 agent 内部路由使用** — 不对外暴露 UI（曾经有 `WikiOverview` 组件，现已删除）
- **`react-d3-tree` 依赖** — 用于已删除的 `WikiOverview`，可清理但未清理
- **`parse_agent_output` 保留 `@@CLARIFY@@` 前缀检测** — 仅作为旧 session resume 的兼容回退，新代码走 MCP `ask_user`
- **`/api/user_query` 端点** — 旧的 expand_query/execute_workflow 入口，前端仍在用但功能简化，可能未来重构

---

## 9. 项目时间线速查

完整历史在 [work_record.md](work_record.md)。关键里程碑：

| 阶段 | 重大变化 |
|---|---|
| 初版 | `claude -p` 子进程 + `@@CLARIFY@@` 文本前缀澄清 |
| 2026-04 初 | 搜索功能、意图识别（QA/修改）、多轮追问、暗色模式 |
| 2026-04 中 | MCP `ask_user` 工具替换文本前缀澄清、纯问答澄清 |
| 2026-04 末 | Wiki 路由索引（OpenAI 生成）、极简化到 path+summary+classes |

---

## 10. 快速接手检查清单

第一次进入此项目时按顺序做：

1. `cat README.md` — 了解用户视角功能
2. `cat CLAUDE.md`（本文件） — 建立心智模型
3. 根据任务类型读子目录 CLAUDE.md：
   - 改后端 → `server/CLAUDE.md`
   - 改前端 → `frontend/CLAUDE.md`
4. `cat work_record.md` — 查历史决策背景（仅在需要时）
5. 改动前务必：
   - 用 Grep 确认没有遗漏的相关引用
   - 读实际文件而不是依赖这里的描述（本文件可能过时）
   - 修改后自己走一遍"反模式警告"清单
