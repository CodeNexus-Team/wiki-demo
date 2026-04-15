# 工作记录

## Wiki 对话智能体功能总结

> 截至 2026-04-07，Hole9Wiki 对话智能体（`server/agent.py`）的完整功能清单。

### 一、整体架构

智能体基于 **Claude CLI agentic loop** 实现，通过 `asyncio.create_subprocess_exec` 流式调用 `claude -p` 命令，实时解析 `stream-json` 事件。架构为三层：

```
React 前端 ←→ FastAPI 后端（SSE 流式推送）←→ Claude CLI 子进程（agentic loop）
                                                  ├── 内置工具: Read / Grep / Bash
                                                  └── MCP 工具: query_neo4j / ask_user
```

- **后端入口**：`server/server.py`，提供 REST + SSE 接口
- **智能体核心**：`server/agent.py`，Prompt 构建、CLI 调用、输出解析
- **MCP 扩展**：`neo4j_mcp_server.py`（知识图谱查询）、`ask_user_mcp_server.py`（结构化澄清）

---

### 二、核心功能

#### 1. 意图自动识别（三分类）

智能体收到用户输入后自动判断意图，无需前端手动切换模式：

| 意图类型 | 触发特征 | 输出格式 | 示例 |
|---------|---------|---------|------|
| **提问类** | "是什么"、"为什么"、"怎么实现"等疑问表达 | `@@QA_ANSWER@@` + Markdown 回答 | "这个类的调用链是什么？" |
| **修改类** | "改成"、"补充"、"删掉"、"重写"等动作指令 | 结构化修改指令（replace/insert_after/delete） | "把这段描述补充上字段说明" |
| **模糊类** | "优化"、"调整"等笼统词汇，或多种合理解读 | 触发澄清机制 | "优化一下这里" |

#### 2. Block 级内容修改

用户选中 Wiki 页面中的一个或多个 block 后提出修改需求，智能体：

1. 提取选中 block 的 Markdown 内容、source_id、neo4j_id（含祖先链信息）
2. 构建页面结构概览 + 关联源码路径上下文
3. 调用 Claude 读取实际源码、搜索代码后生成修改指令
4. 输出结构化 diff（`replace` / `insert_after` / `delete`），前端渲染红绿对比预览
5. 用户确认后通过 `apply_changes` API 写回 JSON 文件

**修改指令格式**：
```
---
action: replace | insert_after | delete
target: S74
source_ids: 1, 5
---
修改后的 markdown 正文
===
（多个操作用 === 分隔）
```

#### 3. 自由问答（QA）

无需选中 block，直接在对话框提问：

- 加载当前 Wiki 页面完整结构概览和 neo4j 关联源码路径
- Claude 自主决定读取哪些源码文件（Read）和搜索哪些代码（Grep）
- 返回 Markdown 格式回答，支持代码片段引用
- 支持澄清机制（问题过于笼统时触发）

#### 4. 多轮追问（会话恢复）

基于 Claude CLI 的 `--resume <session_id>` 实现上下文保持：

- 首次交互获取 `session_id`，后续追问自动恢复同一会话
- 已读取的源码上下文在追问中保留，无需重复加载
- 追问中支持从提问切换到修改、触发澄清等全部功能

**Session 生命周期**：
| 事件 | 行为 |
|------|------|
| 选中 block 提问/修改 | 新建会话 |
| 不选 block + 有 session | 恢复（`--resume`） |
| 应用/放弃 diff 变更 | 清除 session |
| 重置/切换分析类型 | 清除 session |

#### 5. 结构化澄清机制（MCP ask_user 工具）

当用户意图模糊时，智能体通过 MCP 工具向用户提问，而非猜测修改：

**完整流程**：
```
模型调用 ask_user 工具 → MCP server 写 pending.question.json → 阻塞轮询
→ agent.py 拦截 tool_use 事件 → 读问题文件 → on_clarify 回调
→ server.py SSE 发送 clarification 事件 → 前端渲染选项按钮
→ 用户点击选项（或自定义输入）→ POST /api/clarification_answer
→ Future resolve → agent.py 写 pending.answer.json → MCP server 返回 tool_result
→ 模型根据回答继续推理
```

**特性**：
- 支持单选和多选模式（`multi_select` 参数）
- 选项列表末尾固定"其他（请在输入框说明）"选项
- 多选 UI：复选框 + "确认选择 (N)" 提交按钮
- 兼容旧的 `@@CLARIFY@@` 文本前缀协议

#### 6. 源码事实验证

智能体被严格约束为基于事实输出，禁止编造内容：

- **Read 工具**：直接读取源码文件获取准确实现细节
- **Grep 工具**：搜索代码库查找类名、方法名、调用关系
- **Neo4j 查询**（可选）：查询跨模块继承关系、调用链等实体关系
- System Prompt 明确要求：如果工具查不到数据，只能基于已有 block 内容润色改写

工作流优先级：Read 源码 → Grep 搜索 → Neo4j 查询关系

#### 7. Neo4j 知识图谱集成

通过 MCP Server 提供 `query_neo4j` 工具：

- 支持 Cypher 查询语句
- 用于查询代码实体间的继承关系、调用链、依赖关系等
- Wiki block 的 `neo4j_id` 和 `neo4j_source` 信息自动注入 Prompt
- 祖先链 neo4j 信息递归收集，确保子 block 也能获取上级关联

---

### 三、实时交互体验

#### 1. SSE 流式推送

所有 AI 交互通过 Server-Sent Events 实时推送：

| 事件类型 | 数据字段 | 说明 |
|---------|---------|------|
| `progress` | `message` | 实时进度（"正在读取源码: xxx"、"正在搜索代码: xxx"） |
| `clarification` | `question`, `options`, `multi_select`, `session_key` | 澄清请求 |
| `result` | `data`, `session_id` | 最终结果（修改指令 / QA 回答） |
| `error` | `message` | 错误信息 |

#### 2. 工具调用可视化

前端实时展示智能体的工具调用过程：
- "正在读取源码: XxxService.java"
- "正在搜索代码: handlePayment"
- "正在查询知识图谱..."
- "🤔 AI 提问: ..."

#### 3. Diff 预览与确认

修改类结果以红绿对比形式展示，用户可：
- 查看每个 block 的修改前后对比
- 一键确认应用全部变更
- 放弃变更回到原状态

---

### 四、工程化保障

#### 1. 子进程安全管理

- 异常或取消时先 `SIGTERM`（5 秒超时），再 `SIGKILL`
- 防止 Claude CLI 子进程变成孤儿空烧 token

#### 2. 日志系统

- 完整日志输出到 `server/logs/agent.log`
- 记录：会话初始化、工具调用及输入、模型文本输出、API 费用、内部耗时
- Prompt 完整内容以 DEBUG 级别记录

#### 3. 可配置参数

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `CLAUDE_MODEL` | `sonnet` | 模型选择（sonnet/opus/haiku） |
| `CLAUDE_MAX_TOKENS` | `4096` | 输出 token 上限 |
| `MAX_TOOL_ROUNDS` | `15` | 最大工具调用轮次 |
| `SOURCE_ROOT_PATH` | — | 源码根目录路径 |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | — | Neo4j 连接信息 |

---

### 五、API 接口汇总

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/list_wikis` | GET | 获取 Wiki 页面树状列表 |
| `/api/fetch_page` | POST | 加载指定 Wiki 页面内容 |
| `/api/scan_wikis` | GET | 扫描全部 Wiki 页面路径 |
| `/api/search_wiki` | GET | 全库搜索 Wiki 内容 |
| `/api/user_query` | POST | 统一入口：扩展查询 / 执行工作流 |
| `/api/detailed_query` | POST | 选中 block 的智能查询/修改（SSE） |
| `/api/qa_query` | POST | 自由问答（SSE） |
| `/api/clarification_answer` | POST | 用户回答澄清问题 |
| `/api/apply_changes` | POST | 应用修改变更到 Wiki 文件 |

---

## 2026-03-31 会话工作内容

### 1. Gemini API 未配置时页面空白问题修复

**问题**：未配置 `GEMINI_API_KEY` 时，`GeminiService` 构造函数中 `new GoogleGenAI({ apiKey: undefined })` 导致模块加载崩溃，整个页面白屏。

**修改文件**：`frontend/services/geminiService.ts`

**方案**：
- 构造函数中检测 API Key 是否有效，无效时 `this.ai = null` 而非抛异常
- 新增 `isAvailable()` 方法和 `getClient()` 方法，仅在实际调用 Gemini 时才报错
- CodeNexus 功能不受影响，Gemini 功能优雅降级

---

### 2. 源码路径参数化

**问题**：`agent.py` 的 System Prompt 中硬编码了源码路径 `/Users/uinas/.../mall`。

**修改文件**：`server/agent.py`

**方案**：
- 将硬编码路径替换为 `{{SOURCE_ROOT_PATH}}` 模板变量
- 构建 prompt 时用 `SOURCE_ROOT_PATH` 环境变量替换
- 与 `_read_source_file`、`_search_codebase` 等工具函数使用同一配置

---

### 3. 完整提示词输出到日志

**修改文件**：`server/agent.py`

**方案**：在 prompt 构建完成后添加 `agent_logger.debug(f"Prompt 完整内容:\n{prompt}")`，方便调试。

---

### 4. 清理冲突工具 + Neo4j MCP Server 改造

**问题**：`agent.py` 中定义了 `TOOLS`（`read_source_file`、`search_codebase`、`read_wiki_page`、`query_neo4j`）和 `execute_tool`，但 `claude -p` 调用时从未使用，且与 Claude CLI 自带的 Read/Grep/Bash 功能冲突。

**修改文件**：
- `server/agent.py` — 删除 `TOOLS`、所有 `_read_*`/`_search_*`/`_query_neo4j` 函数和 `execute_tool`
- `server/neo4j_mcp_server.py` — **新建**，基于 `mcp` Python SDK 的 FastMCP Server，暴露 `query_neo4j` 工具

**方案**：
- Claude CLI 自带 Read/Grep/Bash 处理源码读取和搜索
- `query_neo4j` 通过 MCP Server 提供，CLI 命令加 `--mcp-config` 和 `--allowedTools` 参数
- 新增 `_build_mcp_config()` 生成临时 MCP 配置文件

**安装依赖**：`pip install mcp`

---

### 5. Neo4j 节点信息注入提示词

**问题**：Wiki 页面的每个章节关联了 `neo4j_id` 和 `neo4j_source`（源码路径），但拼接提示词时未传给 Claude。且叶子 text block 本身无 `neo4j_id`，信息在父级 section 上。

**修改文件**：`server/agent.py`

**方案**：
- 新增 `extract_neo4j_info()` — 递归提取 block 的 `neo4j_id` + `neo4j_source`
- 新增 `find_blocks_with_ancestors()` — 查找 block 时沿树向上收集祖先链的 neo4j 信息
- 提示词中新增「关联源码路径」章节，列出源码路径和 neo4j_id
- 优先引导 Claude 用 Read 直接读源码，Neo4j 查询降级为可选

---

### 6. Neo4j 环境变量配置

**修改文件**：
- `server/.env` — **新建**，包含 `NEO4J_URI`、`NEO4J_USER`、`NEO4J_PASSWORD`
- `server/server.py` — 启动时 `load_dotenv()` 加载 `.env`
- `server/neo4j_mcp_server.py` — 同样加载 `.env`

**安装依赖**：`pip install python-dotenv`（已安装）

---

### 7. System Prompt 工作流优化

**修改文件**：`server/agent.py`

**方案**：
- 删除冗长的 Neo4j 使用指南（schema 查询示例等）
- 工作流程调整为：Read 源码优先 → Grep 搜索 → Neo4j 查询关系（仅在需要时）
- 上下文中 `neo4j_source` 路径作为主要信息，`neo4j_id` 作为补充

---

### 8. 澄清机制（Clarification）— 完整实现

**问题**：用户输入模糊指令（如"优化"、"调整"）时，Claude 直接猜测修改，结果可能不符合预期。

**修改文件**：
- `server/agent.py` — 流式执行 + 澄清检测 + `--resume` 会话恢复
- `server/server.py` — SSE clarification 事件 + `/api/clarification_answer` 端点
- `frontend/services/codenexusWikiService.ts` — SSE 处理 clarification 事件
- `frontend/components/AnalysisView.tsx` — 选项按钮 UI + 输入框回答

**方案**：
- System Prompt 新增澄清机制：`@@CLARIFY@@` 文本协议，输出问题 + 可选项列表
- `_run_claude_streaming()` — 用 `asyncio.create_subprocess_exec` 替代 `subprocess.run`，实时流式读取 stream-json 事件
- 检测到 `@@CLARIFY@@` 前缀时，解析出 question + options
- `on_clarify` async 回调：通过 SSE 发送给前端，`asyncio.Future` 等待用户回答
- 用户回答后，agent 用 `claude --resume <session_id> -p "<answer>"` 在同一会话中继续（保留已读源码上下文）
- 前端渲染可点击的选项按钮，最后一项固定为「其他（请在输入框说明）」
- 点击选项直接提交，点击「其他」则切换到输入框模式

**交互流程**：
```
用户输入"调整" → Claude 输出 @@CLARIFY@@ + 选项
→ SSE clarification 事件 → 前端渲染选项按钮
→ 用户点击选项 → POST /api/clarification_answer
→ Future resolve → claude --resume 继续 → 返回修改结果
```

---

### 9. 子进程安全终止

**问题**：如果直接杀死 Python server 进程，`claude` CLI 子进程变成孤儿继续运行，空烧 token。

**修改文件**：`server/agent.py`

**方案**：
- `_run_claude_streaming()` 中用 `try/except` 包裹整个流式读取循环
- 异常或 `CancelledError` 时先 `proc.terminate()`（SIGTERM），5 秒超时后 `proc.kill()`（SIGKILL）
- 确保子进程不会泄漏

---

### 依赖变更汇总

| 包 | 用途 | 安装命令 |
|---|---|---|
| `mcp` | Neo4j MCP Server | `pip install mcp` |
| `python-dotenv` | 加载 `.env` 环境变量 | 已安装 |

### 新增文件

| 文件 | 说明 |
|---|---|
| `server/neo4j_mcp_server.py` | Neo4j 知识图谱 MCP Server |
| `server/.env` | 环境变量配置（Neo4j 连接信息） |

### 新增 API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/clarification_answer` | POST | 用户回答澄清问题 |

### 新增 SSE 事件类型

| 事件 | 字段 | 说明 |
|---|---|---|
| `clarification` | `question`, `options`, `session_key` | Agent 需要用户澄清 |

---

## 2026-04-06 会话工作内容

### 1. 搜索高亮闪烁修复

**问题**：Wiki 搜索高亮使用 CSS Custom Highlight API，其 Range 对象绑定具体 DOM 文本节点，React 重渲染替换节点后 Range 失效，高亮消失且不会恢复。

**修改文件**：`frontend/components/wiki/WikiContent.tsx`

**方案**：
- 在 CSS Highlight API effect 中新增 `MutationObserver` 监听 `.wiki-root` 的 DOM 变化
- 检测到 `childList`/`subtree`/`characterData` 变化后，50ms 防抖重建高亮
- CSS Highlight API 本身不修改 DOM，不会触发 MutationObserver 形成死循环

---

### 2. 意图自动判断（提问 vs 修改）

**问题**：选中 block 后只能修改，无法提问。

**修改文件**：
- `server/agent.py` — SYSTEM_PROMPT 增加意图判断段（提问/修改/模糊三分支）；`parse_agent_output` 检测 `@@QA_ANSWER@@` 前缀返回 `{"qa_answer": ...}`
- `server/server.py` — `DetailedQueryRequest` 增加可选 `resume_session_id` 字段
- `frontend/types.ts` — 新增 `QaAnswerResponse` 接口，`DetailedQueryRequest` 增加 `resume_session_id`
- `frontend/services/codenexusWikiService.ts` — `detailedQuery` 返回类型扩展支持 `QaAnswerResponse`，透传 `resumeSessionId`
- `frontend/components/AnalysisView.tsx` — `handleAnalyze` 优先检查 `qa_answer` 分支

**方案**：
- SYSTEM_PROMPT 新增意图判断：提问类 → 输出 `@@QA_ANSWER@@` + markdown 回答；修改类 → 原有修改指令；模糊类 → 触发澄清
- 模型在同一次调用中自动判断意图，无需前端切换模式
- 提问回答在聊天面板中以 markdown 格式展示

---

### 3. 多轮追问上下文保持

**问题**：每次提问都是全新 Claude CLI 会话，无上下文延续。

**修改文件**：
- `server/agent.py` — `run_detailed_query` 结果中附带 `session_id`（正常模式和恢复模式）
- `server/server.py` — `DetailedQueryRequest` 支持 `resume_session_id`，传入 agent
- `frontend/services/codenexusWikiService.ts` — `detailedQuery` 透传 `resumeSessionId`
- `frontend/components/AnalysisView.tsx` — 新增 `agentSessionIdRef` 管理会话生命周期

**Session 生命周期**：
| 事件 | 行为 |
|---|---|
| 选中 block 提问/修改 | 新建会话 |
| 不选 block + 有 session | 恢复（`--resume`） |
| 应用/放弃 diff 变更 | 清除 session |
| 重置/切换分析类型 | 清除 session |
| 切换页面 | 保留 session |

---

### 4. 追问路径完整响应处理

**问题**：追问中如果模型返回修改指令或澄清请求，前端不处理——修改指令被丢弃，澄清选项不展示。

**修改文件**：`frontend/components/AnalysisView.tsx`

**方案**：
- 追问路径增加 `qa_answer` / `new_page_path` / 修改指令三分支处理（与选中 block 路径一致）
- 追问路径传入 `onClarify` 回调，支持在追问中触发澄清
- 修改指令正确进入 diff 模式

---

### 5. 聊天消息 Markdown 渲染

**问题**：AI 回答以纯文本 `whitespace-pre-wrap` 展示，markdown 源码未渲染。

**修改文件**：`frontend/components/chat/ChatMessage.tsx`

**方案**：
- 引入 `ReactMarkdown` + `remarkGfm` + `SyntaxHighlighter`
- 助手消息通过 ReactMarkdown 渲染（标题、列表、代码块语法高亮、表格、引用等）
- 用户消息保持原有 `whitespace-pre-wrap` 纯文本渲染

---

### 6. 澄清机制结构化（MCP ask_user 工具）

**问题**：`@@CLARIFY@@` 文本前缀方案脆弱，模型可能输出提问性文本但不加前缀。

**修改文件**：
- `server/ask_user_mcp_server.py` — **新建**，MCP 工具 `ask_user(question, options, multi_select)`，通过临时文件与 FastAPI 阻塞通信
- `server/agent.py` — `_build_mcp_config` 注册 ask-user MCP server；SYSTEM_PROMPT 澄清段改为指导模型调用 `ask_user` 工具；`_run_claude_streaming` 拦截 ask_user 工具调用，读问题文件 → 通知前端 → 等待回答 → 写回答文件；`--allowedTools` 增加 `mcp__ask-user__ask_user`
- 保留 `@@CLARIFY@@` 兼容旧会话的 `--resume`

**完整流程**：
```
模型调用 ask_user → MCP server 写 pending.question.json → 阻塞轮询
→ _run_claude_streaming 检测到 tool_use → 读问题文件 → on_clarify 回调
→ server.py SSE clarification → 前端展示选项 → 用户选择
→ _run_claude_streaming 写 pending.answer.json → MCP server 返回 tool_result
→ 模型继续推理
```

---

### 7. 多选澄清支持

**修改文件**：
- `server/ask_user_mcp_server.py` — `ask_user` 新增 `multi_select` 参数
- `server/agent.py` — 拦截处强制 `multi_select: True`
- `server/server.py` — SSE clarification 事件透传 `multi_select`
- `frontend/types.ts` — `ChatMessage` 新增 `clarificationMultiSelect` 字段
- `frontend/services/codenexusWikiService.ts` — `onClarify` 签名增加 `multiSelect` 参数
- `frontend/components/chat/ChatMessage.tsx` — 多选 UI：☐/☑ 复选框 + "确认选择 (N)" 提交按钮；自定义输入与选项共存
- `frontend/components/AnalysisView.tsx` — 新增 `onClarificationMultiSubmit` 回调，多选结果用顿号连接

---

### 8. 纯问答澄清机制

**问题**：无 block 选中时走 `qaQuery`，完全没有澄清能力。

**修改文件**：
- `server/agent.py` — `QA_SYSTEM_PROMPT` 新增澄清段；`run_qa_query` 新增 `on_clarify` 参数传给 `_run_claude_streaming`
- `server/server.py` — `qa_query` 端点新增 `on_clarify` 回调 + SSE clarification 处理
- `frontend/services/codenexusWikiService.ts` — `qaQuery` 新增 `onClarify` 参数 + clarification SSE 处理
- `frontend/components/AnalysisView.tsx` — `qaQuery` 调用传入 `onClarify` 回调

---

### 9. 对话框默认收起为浮动图标

**修改文件**：`frontend/components/AnalysisView.tsx`

**方案**：
- 新增 `isChatOpen` 状态，wiki 页面加载后自动 `setIsChatOpen(false)`
- 收起时显示 AI 助手按钮（Bot 图标 + 提示文字 + 消息计数徽章）
- 固定在 wiki 卡片右上角（`absolute` 定位，不随内容滚动），位置用百分比适配
- 发送消息时自动 `setIsChatOpen(true)`
- 输入框底部左侧新增「✕ 收起」最小化按钮

---

### 10. 回车键行为优化

**修改文件**：`frontend/components/AnalysisView.tsx`

**方案**：Enter → 换行（textarea 默认行为）；Ctrl/Cmd+Enter → 发送

---

### 11. Wiki 展示时自动折叠 Dashboard

**修改文件**：`frontend/App.tsx`

**方案**：
- `handleOpenWikiPage` 中 `setIsSidebarCollapsed(true)`
- `handleSelectHistory` 中 `setIsSidebarCollapsed(true)`

---

### 12. 暗色模式 Mermaid 图表适配

**修改文件**：
- `frontend/components/Mermaid.tsx` — 新增 `MERMAID_DARK_THEME` 暗色主题变量；`initMermaid(isDark)` 按模式切换主题；`isDarkMode` prop 驱动重渲染；SVG 后处理：白色/近白色填充 → 暗灰，深色文字 → 浅色，保留有色节点不变；容器、右键菜单、错误提示适配暗色
- `frontend/components/WikiBlock.tsx` — 传递 `isDarkMode` 给 Mermaid 组件

---

### 13. 暗色模式聊天气泡适配

**修改文件**：`frontend/components/chat/ChatMessage.tsx`

**方案**：
- 新增 `isDarkMode` prop
- 气泡背景/文字/链接/行内代码/代码块主题/表格/引用/分割线全部适配暗色
- 澄清选项按钮、自定义输入框、确认按钮暗色适配
- 代码块暗色使用 `vscDarkPlus` 主题

---

### 14. 源码面板主题适配 + 文件树扁平展示

**修改文件**：
- `frontend/components/SourceCodePanel.tsx` — 新增 `isDarkMode` prop；面板背景/Header/文件树/代码高亮/行高亮全部适配亮暗双主题；文件树删除 `depth * 12` 缩进，扁平展示
- `frontend/components/AnalysisView.tsx` — 传递 `isDarkMode` 给 SourceCodePanel

---

### 15. Mermaid 编辑器按图表类型区别处理

**问题**：方向控制和间距滑条对所有图表类型都显示，但只有 flowchart/graph 支持。

**修改文件**：
- `frontend/hooks/useMermaidEditor.ts` — 新增 `chartType` 状态、`detectChartTypeFromCode`、`supportsDirection`、`supportsSpacing`；`setDirection`/`setNodeSpacing`/`setRankSpacing` 对不支持的类型直接 return
- `frontend/components/mermaid-editor/ToolBar.tsx` — 新增 `chartType` prop；方向/间距控件按类型显隐；不支持时显示提示
- `frontend/components/mermaid/MermaidEditModal.tsx` — 从 hook 取 `chartType` 传给 ToolBar

---

### 16. UML 图节点高亮修复

**问题**：源码面板打开时，mermaid 节点高亮逻辑只匹配 flowchart 的 `flowchart-{id}-数字` ID 格式，其他图表类型（classDiagram、sequenceDiagram、stateDiagram 等）无法高亮。

**修改文件**：`frontend/components/Mermaid.tsx`

**方案**：
- 高亮 effect 改为复用 `extractNodeIdByChartType` 统一提取各类图表的节点 ID
- 按 `chartType` 选择候选元素选择器（classDiagram → `classId-*`，sequenceDiagram → `actor*`，stateDiagram → `state-*`）
- 高亮形状选择器扩展为包含嵌套元素（去掉 `:scope >` 限制）
- 修复 `substr` 弃用警告 → `substring`

---

### 17. Wiki Source 卡片优化

**修改文件**：`frontend/components/WikiBlock.tsx`

**方案**：
- "Neo4j Source" 字样改为 "Wiki Source"
- 新增右键查看源码功能：判断名称是否为源码文件路径（含 `/` 且以代码扩展名结尾），右键点击构造虚拟 WikiSource 调用 `onSourceClick` 打开源码面板
- 匹配到源码的标签显示小 Code 图标

---

### 18. Wiki 页面标题区域上移

**修改文件**：`frontend/components/wiki/WikiContent.tsx`

**方案**：Wiki 内容区 `pt-8/pt-12` → `pt-4/pt-6`，减少顶部空白

---

### 19. 导航栏和标签栏间距缩小

**修改文件**：
- `frontend/components/AnalysisView.tsx` — 卡片容器外层 `px-4/px-12 pt-6` → `px-2/px-4 pt-2`
- `frontend/components/wiki/WikiContent.tsx` — 导航栏内边距 `p-4` → `px-2 py-3`

---

### 20. README 更新

**修改文件**：`README.md`

**方案**：
- 功能特性以用户视角重写，突出搜索、选中提问、多轮追问、意图自动识别等新功能
- 新增"段落关联源码"和"Mermaid 节点关联源码"独立列项
- 架构图加入 qa_query、search_wiki、意图判断、--resume 追问
- "交互式编辑"改为"交互式智能体"，新增意图识别、多轮追问、修改流程分节
- API 接口表新增 search_wiki、qa_query，更新 detailed_query 描述

---

### 新增文件

| 文件 | 说明 |
|---|---|
| `server/ask_user_mcp_server.py` | 结构化澄清 MCP 工具，通过临时文件与 FastAPI 阻塞通信 |

### 新增依赖

| 包 | 用途 | 安装命令 |
|---|---|---|
| `claude-code-sdk` | Claude Code Python SDK（曾尝试迁移，已回退） | `pip install claude-code-sdk` |

### 新增/修改 SSE 事件字段

| 事件 | 新增字段 | 说明 |
|---|---|---|
| `clarification` | `multi_select` | 是否允许多选 |
| `result` | `session_id` | Agent 会话 ID，供追问 `--resume` |

### 新增前端类型

| 类型 | 文件 | 说明 |
|---|---|---|
| `QaAnswerResponse` | `frontend/types.ts` | 模型判定为提问时的回答响应 |
| `clarificationMultiSelect` | `frontend/types.ts` (ChatMessage) | 多选澄清标记 |

---

## 2026-04-09 会话工作内容

本次会话核心主题：为整个 Wiki 仓库建立 **LLM 路由索引**（wiki_index.json），并围绕索引做了多轮 UI 迭代、最终收敛为极简版路由索引。

### 1. Wiki Index 构建工具（build_wiki_index.py）

**目标**：为整个 wiki_result 目录生成一份索引，让 LLM 快速了解整体情况、定位用户需求。

**新增文件**：`build_wiki_index.py`（项目根目录）

**两阶段流程**：
1. **逐页 LLM 提取**（并发）— 调用 OpenAI API 生成精准 summary、intent_keywords、suggested_questions
2. **全局聚合** — 读取所有单页 meta 生成 wiki_index.json

**粒度选择**：页面级 + outline（每页一条 entry，附带 H2 章节标题列表）

**关键设计**：
- **增量缓存**：`.index/meta/<hash>.meta.json` 存单页结果，基于 mtime 校验，未变化的页面跳过 LLM 调用
- **hash 文件名**：防止深层嵌套路径名超过文件系统 256 字符限制（`md5(page_path)[:16]`）
- **并发限速**：`--concurrency` 控制同时进行的 LLM 调用数
- **优雅降级**：LLM 失败时自动回退到规则提取的 summary

### 2. LLM 服务迁移：Claude CLI → OpenAI API

**问题**：Claude CLI 子进程启动开销巨大（每次 ~30-60 秒），108 页要 30-60 分钟。

**修改文件**：`build_wiki_index.py`

**方案**：
- 从 Claude CLI subprocess 调用迁移到 `openai` Python SDK（AsyncOpenAI）
- 通过环境变量配置：`OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL`
- 支持 `.env` 文件加载（server/.env 或项目根 .env）
- 默认模型 `gpt-4o-mini`，默认并发 10

**Reasoning 模型兼容**：
- 检测 `gpt-5-mini` / `o1` / `o3` 等 reasoning 模型前缀
- Reasoning 模型使用 `max_completion_tokens` 而非 `max_tokens`
- Reasoning 模型不支持 `temperature`，自动跳过
- 超时延长到 120s（思考需要时间）
- 默认 `max_completion_tokens=4000` 保证思考 + 输出都有预算

**错误处理增强**：
- 详细记录 finish_reason、raw content、异常类型
- 区分"空 content"、"无效 JSON"、"API 调用失败"等情况
- 保留 `OPENAI_NO_JSON_MODE` 环境变量跳过 `response_format`（兼容某些代理）

### 3. wiki_index.json 存放位置调整

**问题**：原本输出到 `wiki_result/wiki_index.json`，会被 wiki 扫描器扫到。

**修改文件**：`build_wiki_index.py`、`server/server.py`

**方案**：输出到隐藏目录 `wiki_result/.index/wiki_index.json`，不被扫描。

### 4. LLM 输出增加 suggested_questions 字段

**修改文件**：`build_wiki_index.py`、`frontend/types.ts`

**方案**：
- LLM prompt 增加 `suggested_questions` 字段要求（每页 3-5 个用户最可能问的具体问题）
- `WikiIndexPage` 类型增加可选 `suggested_questions: string[]`
- 用于前端推荐问题卡片展示

### 5. Wiki 概览页 UI（多轮迭代）

**新增文件**：`frontend/components/WikiOverview.tsx`（后删除）

**新增后端端点**：`/api/wiki_index`（读取 `.index/wiki_index.json`）

**前端服务**：`codenexusWikiService.fetchWikiIndex()`（404 时优雅返回 null）

**UI 演进历程**：

**第一版 - 卡片网格**：
- 页面顶部搜索框 + 关键词标签云
- 每个页面一个卡片（标题、summary、intent_keywords、block_count）
- 点击卡片跳转到对应页面

**第二版 - 树形图**（react-d3-tree）：
- 依赖：`npm install react-d3-tree`
- 左侧树形图 + 右侧悬浮详情面板
- 节点可点击展开/折叠、点击跳转页面
- 修复多个问题：
  - Hooks 顺序错乱（early return 在 useCallback 之前）→ 调整顺序
  - 显示范围太小 → 调整 `translate` 位置、`min-h-0` 修复 flex 布局
  - 悬停闪烁 → `useCallback` 稳定函数引用，避免树重建
  - 同名父子节点合并：`folder/folder.json` → 合并元数据到父节点
  - UML 节点高亮只匹配 flowchart → 复用 `extractNodeIdByChartType`

**第三版 - 分类列表**：
- 按文件夹结构递归生成多级标题（H2/H3/H4）
- 每条：`• 标题 — summary` markdown 列表风格
- 底部滚动到末尾才可见的树形图

**第四版 - AI 提问入口 + 推荐问题**（参考 Karpathy 思路）：
- 顶部大输入框，用户输入问题直接触发 QA 路由
- 推荐问题网格（汇总所有页面的 `suggested_questions`）
- 点击推荐问题 → 自动跳转到对应页面并触发 QA
- AnalysisView 新增 `pendingAutoQueryRef` + effect，页面加载完后自动触发 `handleAnalyze`

**最终 - 删除整个概览页**：
用户实际的总揽需求已经被 wiki 生成时的 `总揽.json` 页面完美满足（包含项目介绍 / 模块架构 / Mermaid 架构图 / 技术栈 / ...），再单独做"概览的概览"是多余的。最终决定：
- 删除 WikiOverview.tsx 文件
- 删除 OVERVIEW_PAGE_PATH 特殊路径机制
- WikiBrowser 新增 `findOverviewPage()` 启发式查找"总揽/总览/overview/index/README"页面，找不到则用路径最浅的页面
- 点击"生成 Wiki"后直接打开找到的总揽页

### 6. 暗色模式适配补充

**修改文件**：
- `frontend/components/SourceCodePanel.tsx` — 面板背景/Header/文件树/代码高亮/行高亮亮暗双主题；文件树扁平展示（删除 `depth * 12` 缩进）
- `frontend/components/Mermaid.tsx` — 新增 `MERMAID_DARK_THEME`；`initMermaid(isDark)` 按模式切换；SVG 后处理：白色填充→暗灰、深色文字→浅色，保留有色节点；右键菜单、错误提示适配
- `frontend/components/WikiBlock.tsx` — 传递 `isDarkMode` 给 Mermaid
- `frontend/components/chat/ChatMessage.tsx` — 气泡/markdown/代码块/表格/引用/澄清选项/自定义输入全部暗色适配，代码块用 `vscDarkPlus`
- `frontend/components/AnalysisView.tsx` — 传递 `isDarkMode` 给 SourceCodePanel/ChatMessage

### 7. Mermaid 编辑器按图表类型区别处理

**问题**：方向控制和间距滑条对所有图表类型都显示，但只有 flowchart/graph 支持。

**修改文件**：
- `frontend/hooks/useMermaidEditor.ts` — 新增 `chartType` 状态、`detectChartTypeFromCode`、`supportsDirection`、`supportsSpacing`；`setDirection`/`setNodeSpacing`/`setRankSpacing` 对不支持的类型直接 return
- `frontend/components/mermaid-editor/ToolBar.tsx` — 新增 `chartType` prop；方向/间距控件按类型显隐；不支持时显示提示
- `frontend/components/mermaid/MermaidEditModal.tsx` — 从 hook 取 `chartType` 传给 ToolBar

### 8. Wiki Source 卡片优化

**修改文件**：`frontend/components/WikiBlock.tsx`

**方案**：
- "Neo4j Source" 字样改为 "Wiki Source"
- 新增右键查看源码功能：判断名称是否为源码文件路径（含 `/` 且以代码扩展名结尾），右键点击构造虚拟 WikiSource 调用 `onSourceClick` 打开源码面板
- 匹配到源码的标签显示小 Code 图标

### 9. 浮动机器人图标（AI 助手入口）

**修改文件**：`frontend/components/AnalysisView.tsx`

**演进**：
- 最初：对话框默认收起为右下角浮动图标（`MessageCircle`）
- 改为机器人图标（`Bot`），渐变蓝色背景
- 可拖动到任意位置（mousedown/mousemove 事件）
- 后改为固定位置：Wiki header 区域内（`absolute top/right` 百分比定位），不随内容滚动
- 鼠标悬停显示可关闭的提示气泡（"选中块后提问" / "继续对话" / "已选 N 个块"）

### 10. 对话交互优化

**修改文件**：`frontend/components/AnalysisView.tsx`

- **回车键行为**：Enter → 换行，Ctrl/Cmd+Enter → 发送
- **最小化按钮**：输入框底部工具栏左侧新增 "✕ 收起"，点击后对话框收起为浮动图标
- **Wiki 展示时自动折叠 Sidebar**：`App.tsx` 的 `handleOpenWikiPage` 和 `handleSelectHistory` 中 `setIsSidebarCollapsed(true)`

### 11. 搜索高亮闪烁修复

**修改文件**：`frontend/components/wiki/WikiContent.tsx`

**问题**：CSS Custom Highlight API 的 Range 对象绑定 DOM 文本节点，React 重渲染替换节点后失效。

**方案**：
- 新增 `MutationObserver` 监听 `.wiki-root` 的 `childList`/`subtree`/`characterData` 变化
- 检测到变化后 50ms 防抖重建高亮
- CSS Highlight API 本身不修改 DOM，不会触发 observer 死循环

### 12. UML 图节点高亮修复

**修改文件**：`frontend/components/Mermaid.tsx`

**问题**：高亮 effect 只匹配 flowchart 的 `flowchart-{id}-数字` ID 格式，其他图表类型无法高亮。

**方案**：
- 复用 `extractNodeIdByChartType` 统一提取各类图表的节点 ID
- 按 chartType 选择候选元素选择器（classDiagram → `classId-*`，sequenceDiagram → `actor*`，stateDiagram → `state-*`）
- 修复 `substr` 弃用警告 → `substring`

### 13. 纯问答澄清机制

**修改文件**：
- `server/agent.py` — `QA_SYSTEM_PROMPT` 新增澄清段；`run_qa_query` 新增 `on_clarify` 参数
- `server/server.py` — `qa_query` 端点新增 `on_clarify` 回调 + SSE clarification 处理
- `frontend/services/codenexusWikiService.ts` — `qaQuery` 新增 `onClarify` 参数
- `frontend/components/AnalysisView.tsx` — `qaQuery` 调用传入 `onClarify` 回调

**方案**：纯问答场景（无 block 选中）也支持澄清机制，与 detailed_query 统一。

### 14. wiki_index.json 极简化（最终优化）

**背景**：初版 wiki_index.json 达 372 KB、12455 行（108 页），每次 LLM 路由都要加载这么大的文件。

**字段分析**：
| 字段 | 总大小 | 占比 | 决策 |
|---|---|---|---|
| outline | 240 KB | 65% | ❌ 删（章节标题，模型 Read 文件就有） |
| summary | 12 KB | 3% | ✅ 保留（路由核心） |
| intent_keywords | 10 KB | 3% | ❌ 删（与 summary 重叠） |
| cross_references | 31 KB | 8% | ❌ 删（模型 grep 可得） |
| key_classes | - | - | ✅ 保留为 classes（真实类名精确匹配） |
| questions | 21 KB (LLM 版) | 38% | ❌ 删（前端已不用） |
| title | 1 KB | 2% | ❌ 删（从 path basename 推导） |
| has_mermaid / block_count / source_file_count | <6 KB | 2% | ❌ 删（无路由价值） |

**最终结构**（每页只剩 3 个字段）：
```json
{
  "pages": [
    {
      "path": "后台管理系统/应用层/业务接口/业务接口.json",
      "summary": "50-100 字摘要",
      "classes": ["OmsOrderService", "AdminController", ...]
    }
  ]
}
```

**体积对比**：372 KB → 98 KB（纯规则）/ 预估 45 KB（LLM 模式）。

**设计哲学**：Claude CLI 有 Read/Glob/Grep 工具能直接读真实文件，index 只负责「路由」不承担「展示」。outline、cross_references、has_mermaid 等字段都可以通过读实际文件获得，没必要预先存储。`classes` 字段保留是因为它来自 `neo4j_source` 的真实类名（不是 LLM 幻想的关键词），用于精确类名查询路由。

---

### 新增文件汇总

| 文件 | 说明 |
|---|---|
| `build_wiki_index.py` | Wiki 索引构建工具（OpenAI 驱动） |

### 新增依赖

| 包 | 用途 | 安装命令 |
|---|---|---|
| `openai` | OpenAI API SDK，生成 index 摘要 | `pip install openai` |
| `react-d3-tree` | 树形图组件（最终已废弃） | ~~`npm install react-d3-tree`~~ |

### 新增环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI API Key |
| `OPENAI_MODEL` | `gpt-4o-mini` | 模型名 |
| `OPENAI_BASE_URL` | — | 第三方兼容服务地址 |
| `OPENAI_MAX_TOKENS` | 600 / 4000 | 输出 token 上限（reasoning 模型更大） |
| `OPENAI_NO_JSON_MODE` | — | 跳过 `response_format` 参数 |

### 新增 API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/wiki_index` | GET | 获取 wiki_index.json 总览数据（404 时前端优雅降级） |

### 最终文件结构

```
wiki_result/
├── *.json                    # Wiki 页面（可浏览）
├── .index/                   # 隐藏目录，不被 wiki 扫描
│   ├── wiki_index.json       # LLM 路由索引（path + summary + classes）
│   └── meta/                 # 单页缓存（增量构建用）
│       └── <hash>.meta.json
```

### 使用方式

```bash
# 构建 index（LLM 模式，默认）
export OPENAI_API_KEY=sk-xxx
python build_wiki_index.py output_all/wiki_result

# 纯规则模式（无需 API key）
python build_wiki_index.py output_all/wiki_result --no-llm

# 强制全量重建
python build_wiki_index.py output_all/wiki_result --force

# 提高并发
python build_wiki_index.py output_all/wiki_result --concurrency 20

# 切换模型
OPENAI_MODEL=gpt-4o python build_wiki_index.py output_all/wiki_result

# 集成到 demo.py
python demo.py /path/to/wiki-data c --build-index
python demo.py /path/to/wiki-data c --build-index --no-llm-index
```

### 设计收敛回顾

本次会话是一次"设计收敛"的过程：从最初的"完整元数据 + 丰富 UI"逐步简化到"极简索引 + 已有 wiki 页面"。最终认识到：

1. **已有内容不要重复造轮子** — 总揽页已经是精心生成的概览，不需要做"概览的概览"
2. **index 是给机器的，不是给人的** — path + summary 足够 LLM 路由，其他字段都是冗余
3. **读文件本身比预建索引更灵活** — Claude CLI 有 Read 工具，大部分信息都可以按需读取

---

## 智能体跨页能力改造（2026-04-13 ~ 2026-04-14）

> 让智能体能在单次请求中主动发现并读取**当前页面以外**的 wiki 内容，支撑跨模块问答与修改。分两轮落地：第一轮通过 prompt 注入让模型"知道"，第二轮通过专用 MCP 工具让模型"能读到"。

### 背景与问题定位

改造前智能体的跨页能力有两个实质缺陷：

1. **prompt 里完全没有其他页面的存在感**
   - `run_detailed_query` / `run_qa_query` 的 prompt 只注入当前页的 outline + 祖先 neo4j 源码路径
   - 即便 `.index/wiki_index.json` 存在，`agent.py` 对它零消费
   - 用户在"订单管理"页问"用户登录是怎么做的" → 模型只能盲目 Grep 源码

2. **cwd 在 `SOURCE_ROOT_PATH`，Read 读不到 wiki_root**
   - Claude CLI 的 Read 工具对 cwd 之外的目录受权限限制
   - 即便 prompt 告诉模型"用 Read 读绝对路径 `<wiki_root>/<path>`"，实际调用多半被拒
   - 也就是说即使加了跨页指引，工具层依然读不到目标页面

### 第一轮：wiki 总览注入（prompt 层面）

**改动点**：[server/agent.py](server/agent.py)

新增两个模块级辅助：

```python
_wiki_index_cache: Dict[str, tuple] = {}  # {abs_root: (mtime, index)}

def _resolve_wiki_root(wiki_root: str) -> str:
    """规范化为绝对路径，兼容相对路径和绝对路径两种传入方式"""

def _load_wiki_index(wiki_root: str) -> Optional[dict]:
    """按 mtime 做内存缓存，失败返回 None 让调用方降级"""

def _build_wiki_overview(index: dict, current_page: str) -> str:
    """格式化为 prompt 段，当前页标 ★；每行 path — summary [classes: A, B…]"""
```

调用集成到两个 agentic loop 的 prompt 拼装：

```
## Wiki 总览（全部页面，★ 为当前页）
★ - 总揽.json — 企业级多模块电商系统总览... [classes: MyBatisCodegenWithSwaggerSupport]
  - 门户系统/主程序/业务接口/订单购物车接口.json — 下单、支付回调... [classes: OmsPortalOrderController]
  ...
```

同步在 `SYSTEM_PROMPT` 和 `QA_SYSTEM_PROMPT` 的工作流程段加入"跨页查阅"指引，强调先查 wiki 再搜源码。

**效果评估**：

模型**知道**有哪些其他页面，但**读不到**——这就是问题 2 暴露的时机。验证日志（`server/logs/agent.log`）显示模型即使按指引尝试 Read 绝对路径也会失败（静默降级为全 Grep）。需要第二轮工具层改造。

### 第二轮：wiki-reader MCP server（工具层面）

**核心决策**：不给 Claude CLI 的内置 Read 工具加 `--add-dir` 打开写权限，改为**专门暴露一个只读 MCP 工具**，对齐现有 `neo4j_mcp_server` / `ask_user_mcp_server` 的"领域能力封装"架构风格。

#### 新建文件：[server/wiki_reader_mcp_server.py](server/wiki_reader_mcp_server.py)

基于 `fastmcp`，对外暴露 4 个工具：

| 工具 | 功能 | Token 对比原生 Read |
|---|---|---|
| `read_wiki_page(path)` | 读取页面，返回精简 block 树（去掉 `neo4j_id` / `neo4j_source` 等元数据） | **节省 40~60%** |
| `get_page_outline(path)` | 只返回 section 树 + 60 字预览的缩进大纲 | **节省 80~90%** |
| `read_wiki_section(path, section_id)` | 精准读某个 block 及其子树（用于大页分段读取） | **节省 70%+** |
| `list_wiki_pages(prefix)` | 按前缀列出所有页面路径（`get_page_outline` 之前的发现阶段） | 不适用 |

**安全设计**：

- `_safe_resolve()` 用 `Path.relative_to()` 严格校验目标路径必须在 `WIKI_ROOT_PATH` 之下
- path traversal（`../../etc/passwd`）被拒绝并记录 warning
- 只接受 `.json` 文件，跳过隐藏目录（`.index/` / `.meta/`）和 `root_doc.json`
- `read_wiki_page` 单次输出上限 30KB，超过建议改用 `get_page_outline` + `read_wiki_section` 组合
- 进程间通过环境变量 `WIKI_ROOT_PATH` 传入目录，不接受运行时覆盖

**Block 精简逻辑**：

```python
def _simplify_block(block: dict) -> dict:
    keep = {}
    for key in ("id", "type", "title", "source_id"):  # 保留
        if key in block:
            keep[key] = block[key]
    content = block.get("content")
    if isinstance(content, dict):
        kept_content = {}
        for k in ("markdown", "mermaid"):  # 只保留正文字段
            if k in content:
                kept_content[k] = content[k]
        keep["content"] = kept_content
    elif isinstance(content, list):
        keep["content"] = [_simplify_block(c) for c in content if isinstance(c, dict)]
    return keep
```

**丢弃字段**：`neo4j_id`、`neo4j_source`、内部元数据。这些对"跨页阅读"的模型决策完全无用，纯噪声。

#### 集成到 [server/agent.py](server/agent.py)

1. **常量表**新增路径和白名单：

```python
WIKI_READER_MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "wiki_reader_mcp_server.py")

# 显式白名单：内置 Read/Grep/Glob + 三个 MCP server 的所有工具
ALLOWED_TOOLS = ",".join([
    "Read", "Grep", "Glob",
    "mcp__neo4j-knowledge-graph__query_neo4j",
    "mcp__ask-user__ask_user",
    "mcp__wiki-reader__read_wiki_page",
    "mcp__wiki-reader__get_page_outline",
    "mcp__wiki-reader__read_wiki_section",
    "mcp__wiki-reader__list_wiki_pages",
])
```

2. **`_build_mcp_config(wiki_root)`** 签名从无参变成接收 `wiki_root`，根据是否提供动态决定是否注册 wiki-reader server（环境变量 `WIKI_ROOT_PATH` 在这里注入）

3. **四处 `cli_cmd` 构建**全部更新为 `--mcp-config _build_mcp_config(wiki_root)` + `--allowedTools ALLOWED_TOOLS`（`run_detailed_query` 正常/resume 两处 + `run_qa_query` 正常/resume 两处）

4. **`_build_wiki_overview`** 签名从 3 参数简化为 2 参数（不再需要 `abs_wiki_root`），header 文本改为推荐 MCP 工具按**相对路径**读取，不再暴露绝对路径

5. **两个 system prompt** 的"跨页查阅"段重写：
   - `SYSTEM_PROMPT`：强调"先从总览挑 1~2 页，再用 wiki-reader 工具读取"
   - `QA_SYSTEM_PROMPT`：工作流程第 2 步同步更新为 MCP 工具用法

6. **`_run_claude_streaming`** 的 `on_progress` 识别 `mcp__wiki-reader__*` 工具调用，按子工具推送细粒度进度：
   - `正在查看 wiki 大纲: xxx.json`
   - `正在查阅 wiki 页面: xxx.json`
   - `正在读取 wiki 片段: xxx.json#Sxx`
   - `正在列出 wiki 页面...`

### 数据流对比

**改造前**：

```
用户问跨页问题
  → agent.py 拼 prompt（只含当前页）
  → Claude 模型推理
  → 只能调 Grep 盲搜源码
  → 回答精度低、token 浪费大
```

**改造后**：

```
用户问跨页问题
  → agent.py 注入 wiki 总览（全部页面 path + summary）
  → Claude 模型推理
  → 从总览挑最相关页面
  → 调 mcp__wiki-reader__get_page_outline(path) 看结构
  → 调 read_wiki_page / read_wiki_section 精准读取
  → 基于事实生成回答
  → 回答精度高、token 按需取用
```

### 安全边界

第二轮特意不走 `--add-dir wiki_root` 的捷径，原因：

- Claude CLI 的 `--allowedTools` 对**内置工具**（Read/Grep/Edit/Write/Bash）不起白名单作用——日志实测证实内置工具永远默认可用（见 `agent.log:327` 的 `可用工具` 列表）
- 如果对 wiki_root 开 `--add-dir`，模型能通过内置 Edit 工具直接改 wiki JSON，绕过前端的 diff 确认
- MCP 工具的 `_safe_resolve` 只开放 `read_wiki_page` 等**只读**能力，Edit/Write 无从调用

### 已知局限与未解决问题（留待后续）

1. **Resume 血统问题**：`claude --resume` 继承首轮 prompt，追问场景下如果首轮是 `run_qa_query`（QA_SYSTEM_PROMPT）建立的 session，第二轮追问被前端路由到 `detailedQuery + resume`，会导致 `parse_agent_output` 按修改协议解析一段 QA markdown → 进入空 diff 模式。方案 A（给 `QA_SYSTEM_PROMPT` 加 `@@QA_ANSWER@@` 强制前缀）已讨论但未落地

2. **Prompt 体积偏大**：实测一次 QA 请求 prompt 长度 70794 字符（约 25-35k tokens），其中 Wiki 总览 34093 字符（48%），`source_context` 约 30000 字符（43%）。未裁剪，未做向量检索

3. **向量检索可行性调研完成但未实施**：
   - 第三方中转测试结果：**不代理 `/v1/embeddings` 端点**（405 Method Not Allowed），15 个代理模型里 0 个 embedding 模型
   - 本地方案已验证硬件充足：M4 + 16GB + MPS，bge-small-zh-v1.5 预估建库 ~1s、单次检索 ~10ms、内存增量 ~1GB
   - 改动大纲已设计完毕（`build_wiki_index.py` 扩展 + 新建 `server/wiki_retriever.py` + `_build_wiki_overview` 改造），等决策后实施

4. **纯问答模式下的自主修改**：QA 路径能触发修改的设计方案已讨论（混合输出协议 `@@QA_ANSWER@@` + `@@SUGGEST_EDIT@@`），但未实施。需要先确认三个设计点（触发约束严格度、前端进入 diff 的方式、是否顺带修 resume 血统 bug）

### 新增文件

| 文件 | 说明 |
|---|---|
| `server/wiki_reader_mcp_server.py` | Wiki 目录只读 MCP server，4 个业务语义工具 + path traversal 防护 |
| `server/logs/wiki_reader_mcp.log` | 新 MCP server 的独立日志 |

### 新增环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WIKI_ROOT_PATH` | — | 传给 wiki-reader MCP server 的 wiki 目录绝对路径（由 agent.py 自动注入，用户无需手动设置） |

### 修改文件

| 文件 | 改动摘要 |
|---|---|
| `server/agent.py` | 新增 `_wiki_index_cache` / `_resolve_wiki_root` / `_load_wiki_index` / `_build_wiki_overview`；`_build_mcp_config` 改接收 `wiki_root` 参数；新增 `ALLOWED_TOOLS` / `WIKI_READER_MCP_SERVER_PATH` 常量；两个 system prompt 的"跨页查阅"段重写；`_run_claude_streaming` 进度提示识别 wiki-reader 工具；四处 cli_cmd 统一使用新常量 |

### 验证与调优

- **wiki_reader_mcp_server.py** 的 `_safe_resolve` 通过单点 smoke test 验证（`WIKI_ROOT_PATH=$(pwd)` + path traversal 测试 `../etc/passwd` 正确被拒绝并记录 warning）
- **`agent.py` 语法**通过 `python -c "import ast; ast.parse(...)"` 校验
- **端到端验证**需要重启后端（FastAPI 不自动 hot reload）并手动发一次跨页请求观察 `wiki_reader_mcp.log` 是否有 `read_wiki_page: path=...` 等 INFO 记录

### 反思

1. **"prompt 指引"和"工具能力"必须同步升级**：第一轮只改 prompt 不改工具，模型看得见读不着，是典型的"指引和能力错配"。未来加新功能要同时检查这两层

2. **`--allowedTools` 的语义陷阱**：从日志发现 `--allowedTools` 对内置工具是"附加"而非"限制"，这对安全假设影响重大。显式白名单 `Read,Grep,Glob,...` 不能隐式禁用 `Edit/Write/Bash`，需要配合 `--disallowedTools` 才能真正收紧（当前版本尚未加这个保险）

3. **架构一致性的价值**：选择第二轮做 MCP server 而不是 `--add-dir` 捷径，让 wiki 读取能力和 neo4j 查询、ask_user 澄清共享同一套"领域能力封装"模式。新增工具扩展（如未来的 `search_wiki` 向量检索）可以直接复用这套架构

4. **日志是最好的回归测试**：改完后观察到一次 prompt 仍是旧版的事故（后端进程未重启），通过 `agent.log:327` 的 `可用工具` 列表验证代码是否生效。这是比写单测更便宜的快速验证手段
