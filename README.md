# Hole9Wiki

基于 AI 的交互式代码仓库 Wiki 展示平台。

## 功能特性

- **浏览 Wiki**：层级折叠展开、多页 Tab 切换、Mermaid 图表渲染、暗色/亮色主题切换
- **段落关联源码**：每个内容块可关联源码文件，点击右上角菜单即可打开源码面板，高亮显示对应行
- **Mermaid 节点关联源码**：图表中的节点与 Neo4j 知识图谱实体映射，点击节点可查看对应源码
- **搜索内容**：Ctrl/Cmd+F 全文搜索，关键词高亮，搜索结果可跨页面跳转
- **选中提问**：选中感兴趣的内容块，直接提问，AI 会阅读源码后给出准确回答
- **多轮追问**：回答后可继续追问，AI 记得之前读过的源码和上下文，无需重复说明
- **选中修改**：选中需要改进的内容块，描述修改需求，AI 阅读源码后生成修改建议
- **智能判断意图**：选中 block 后无需区分"提问"还是"修改"，AI 自动识别你的意图
- **模糊指令澄清**：输入"优化一下"等模糊指令时，AI 会列出可选方向让你一键选择
- **Diff 预览确认**：修改前后红绿对比，确认无误后再写入，避免误操作
- **数据格式转换**：自动将 `.meta.json` / `.md` 格式的 Wiki 数据转换为可浏览的页面
- **Wiki 路由索引（LLM 驱动）**：为整个 Wiki 仓库生成极简路由索引（`.index/wiki_index.json`），让 AI 在回答问题前能快速定位相关页面，避免盲目扫描

## 架构概览

```
前端 (React + Vite)          后端 (FastAPI)              智能体 (Claude CLI)
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  WikiBrowser    │     │  /api/fetch_page │     │  claude -p prompt   │
│  AnalysisView   │────▶│  /api/detailed   │────▶│  Read / Grep / Bash │
│  WikiContent    │     │  /api/qa_query   │     │  意图判断:           │
│  ChatMessage    │◀────│  /api/search_wiki│◀────│   提问→回答/修改→指令 │
│  DiffMode       │     │  /api/apply      │     │  --resume 追问      │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
     :3000                   :11219
```

## 前置要求

### 后端依赖
- Python 3.9+
- 一键安装所有 Python 依赖：
  ```bash
  pip install -r requirements.txt
  ```
  涵盖:`fastapi` · `uvicorn` · `pydantic` · `python-dotenv` · `mcp` · `neo4j` · `openai`。

### 前端依赖
- Node.js 16+
- 安装依赖：
  ```bash
  cd frontend
  npm install
  ```

### 智能体依赖（交互式编辑功能）
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并完成认证(独立工具,不走 pip)
- 验证安装：`claude --version`

### 运行时可选服务
- **Neo4j 数据库** —— 代码实体关系查询,未配置时自动跳过(`neo4j` 包仍会被 import,但不连库)
- **OpenAI API Key** —— 生成 Wiki 路由索引 `wiki_index.json`,未配置时可用 `--no-llm` 纯规则模式

## 快速开始

推荐方式：**先启动前端，在浏览器里配置并启动后端**。首次运行不需要敲任何转换/索引命令。

### 方式 A：浏览器一键启动（推荐）

```bash
cd frontend
npm run dev
```

打开 http://localhost:3000，系统检测到后端未运行会显示「启动后端」界面：

1. 在表单里填（已配置过的字段会从 `server/.env` 自动回显）：
   - **OpenAI API Key**（必填）—— 用于生成 Wiki 路由索引，支持第三方兼容服务
   - **OpenAI Base URL / Model**（可选）—— 留空用官方 / `gpt-4o-mini`
   - **业务源码根目录**（可选）—— Agent 读取源码的位置（下方「源码文件存放」章节详述）
   - **原始 Wiki 根目录**（必填）—— 含 `.md` / `.meta.json` 的目录，会自动转换到 `<目录>/wiki_result/`
   - **Neo4j**（可选，折叠）—— 未配置时图谱查询自动跳过
2. 点击「启动后端」→ SSE 实时展示转换/建索引/启动日志 → 完成后自动进入主界面。

**底层逻辑**：Vite dev 插件接收表单 → 合并写入 `server/.env` → `spawn python launch.py <WIKI_RAW_PATH>`（自动做一致性检查，必要时转换 + 建索引 + 启动 FastAPI）。

### 方式 B：命令行启动（已有转换后数据）

```bash
python start.py /path/to/wiki-data       # 前端 + 后端一起
python start.py /path/to/wiki-data c     # + 自动执行一次转换
```

### 方式 C：单独启动后端

```bash
python launch.py /path/to/wiki-data      # 前端 BackendLauncher 走的底层命令
# 或
python demo.py /path/to/wiki-data c --build-index
```

### 浏览 Wiki

任一方式启动成功后，侧边栏点「生成 Wiki」即可看到所有页面。

## 输入数据格式

### `.meta.json` 格式（推荐）

AI 生成 Wiki 时的输出格式，结构精简，减轻 AI 负担：

```json
{
  "wiki": [
    {
      "markdown": "## 1. 模块功能概述\n\n该模块负责...",
      "neo4j_id": {
        "section_ref": 12345
      }
    },
    {
      "markdown": "## 2. 核心组件\n\n### 2.1 SomeClass\n\n描述...",
      "mermaid": "graph TD\n  A-->B",
      "neo4j_id": {
        "node_id": 67890
      }
    }
  ],
  "source_id_list": [
    {
      "source_id": "3791",
      "name": "com/example/SomeClass.java",
      "lines": ["55-56"]
    }
  ]
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `wiki` | array | Wiki 内容块列表 |
| `wiki[].markdown` | string | Markdown 格式的文档内容 |
| `wiki[].mermaid` | string | 可选，Mermaid 图表代码 |
| `wiki[].neo4j_id` | object | 可选，内容与 Neo4j 节点的映射关系 |
| `source_id_list` | array | 源码引用列表 |
| `source_id_list[].source_id` | string | 引用 ID（在 markdown 中通过 block 的 source_id 字段关联） |
| `source_id_list[].name` | string | 源码文件路径 |
| `source_id_list[].lines` | string[] | 关联的行号范围，如 `["55-56", "100-120"]` |

### `.md` 格式

标准 Markdown 文件，使用 heading 层级表示文档结构。

### 转换后的前端 JSON 格式

转换后生成层级嵌套的 block 树结构：

```json
{
  "markdown_content": [
    {
      "type": "section",
      "id": "S1",
      "title": "## 1. 模块功能概述",
      "content": [
        {
          "type": "text",
          "id": "S2",
          "content": {
            "markdown": "该模块负责...",
            "mermaid": "graph TD\n  A-->B"
          },
          "source_id": ["3791"],
          "neo4j_id": { "section_ref": 12345 },
          "neo4j_source": { "section_ref": "SomeClass" }
        }
      ]
    }
  ],
  "source_id": [
    {
      "source_id": "3791",
      "name": "com/example/SomeClass.java",
      "lines": ["55-56"]
    }
  ]
}
```

**Block 类型：**

| type | 说明 | 关键字段 |
|------|------|---------|
| `section` | 章节容器 | `title`（heading 文本）, `content`（子 block 数组） |
| `text` | 内容叶节点 | `content.markdown`, 可选 `content.mermaid`, `source_id` |

## 源码文件存放

交互式编辑需要访问真实源码。通过 `SOURCE_ROOT_PATH` 环境变量指向一个**绝对路径**目录即可，**不再要求放在 `frontend/public/` 下**。

**两个使用场景，都由同一个 `SOURCE_ROOT_PATH` 驱动：**

1. **前端源码面板** —— Vite dev 插件 `sourceCodeScannerPlugin` 读取 `SOURCE_ROOT_PATH`，把它挂到 `/source-code/*` 路径下；源码面板 `fetch('/source-code/<file>')` 直接取。
2. **智能体读源码** —— Claude CLI 的 cwd 设为 `SOURCE_ROOT_PATH`，模型通过 `Read` 工具按相对路径读取。

**配置方式**（二选一）：

- 在「启动后端」界面的「业务源码根目录」字段里填（推荐），会写入 `server/.env`。
- 或手工编辑 `server/.env`：
  ```
  SOURCE_ROOT_PATH=/absolute/path/to/your/project
  ```

> `.meta.json` 中 `source_id_list[].name` 的路径必须相对于 `SOURCE_ROOT_PATH`。例如 `name` 为 `mall-admin/src/main/java/.../GlobalCorsConfig.java`，则实际文件应在 `$SOURCE_ROOT_PATH/mall-admin/src/main/java/.../GlobalCorsConfig.java`。

## 交互式智能体

在前端选中一个或多个 block 后输入指令，智能体会自动判断你的意图：

### 意图识别

- **提问**（如"这个类的作用是什么？"）→ 阅读源码后直接回答，支持继续追问
- **修改**（如"把这段改详细点"）→ 阅读源码后生成修改指令，展示 Diff 预览
- **模糊**（如"优化一下"）→ 触发澄清机制，列出可选方向让你选择

### 多轮追问

回答后可以不选中 block 直接继续追问，智能体通过 `--resume` 恢复之前的会话上下文，记得之前读过的源码和给出的回答。也可以在追问中切换为修改请求，智能体会正确进入 Diff 模式。

### 澄清机制

当用户输入模糊指令（如"优化"、"调整"）时，Agent 会先提出澄清问题并给出可选方向：

- 前端在聊天气泡中渲染选项按钮，用户一键选择
- 最后一项固定为「其他」，支持自由输入
- 选择后通过 `--resume` 在同一会话中继续，保留已读源码上下文

### 修改流程

1. 提取选中 block 的内容、页面结构概览、关联源码路径（含祖先链 neo4j 信息）
2. 调用 Claude Code CLI（流式读取 stream-json 事件，实时推送进度）
3. 模型通过 Read/Grep 读取源码，输出修改指令（replace / insert_after / delete）
4. 前端展示 Diff 预览（红色原内容 / 绿色新内容）
5. 用户确认后写入 JSON 文件

### 智能体日志

调用日志保存在 `server/logs/agent.log`，记录：
- 每次请求的参数、意图判断结果和耗时
- Claude 调用的工具（Read、Grep、Bash 等）及返回结果
- 模型输出的回答或修改指令内容

## Wiki 路由索引（build_wiki_index.py）

为整个 `wiki_result` 目录生成一份极简的路由索引，让 LLM 能快速了解 Wiki 整体情况、定位用户问题相关的页面。

### 设计理念

- **极简路由**：只存 `path` + `summary` + `classes`，让模型快速判断"要读哪个页面"
- **不承担展示**：Claude CLI 有 Read/Grep/Glob 工具，具体内容按需读取，无需在 index 里存 outline/cross_references 等冗余信息
- **增量构建**：缓存单页 meta 到 `.index/meta/`，mtime 校验未变化的页面直接复用

### 索引结构

```json
{
  "pages": [
    {
      "path": "门户系统/订单管理.json",
      "summary": "订单提交、支付、查询、取消的完整业务流程（50-100 字 LLM 摘要）",
      "classes": ["OmsOrderService", "OmsPortalOrderController"]
    }
  ]
}
```

每页仅 3 个字段：
- **`path`** — 作为 Read 工具的参数
- **`summary`** — 给 LLM 做语义路由判断
- **`classes`** — 从 `neo4j_source` 提取的真实类名，支持精确类名查询

### 构建命令

```bash
# LLM 模式（默认，质量最好）
export OPENAI_API_KEY=sk-xxx
python build_wiki_index.py /path/to/wiki_result

# 纯规则模式（无需 API key，摘要是前 200 字截断）
python build_wiki_index.py /path/to/wiki_result --no-llm

# 强制全量重建（忽略缓存）
python build_wiki_index.py /path/to/wiki_result --force

# 提高并发（默认 10）
python build_wiki_index.py /path/to/wiki_result --concurrency 20

# 切换模型
OPENAI_MODEL=gpt-4o python build_wiki_index.py /path/to/wiki_result
```

### 集成到启动流程

```bash
# demo.py 新增 --build-index 选项
python demo.py /path/to/wiki-data c --build-index

# 纯规则模式（无需 OpenAI key）
python demo.py /path/to/wiki-data c --build-index --no-llm-index
```

### 输出位置

输出到 `wiki_result/.index/` 隐藏目录，不会被 wiki 扫描器扫到：

```
wiki_result/
├── *.json                  ← Wiki 页面（被扫描）
└── .index/                 ← 隐藏目录（不被扫描）
    ├── wiki_index.json     ← LLM 路由索引
    └── meta/               ← 单页缓存（增量构建用）
        └── <hash>.meta.json
```

### 支持的 LLM 模型

- **OpenAI GPT 系列**：`gpt-4o-mini`（默认，最便宜）/ `gpt-4o` / `gpt-3.5-turbo`
- **OpenAI Reasoning 模型**：`gpt-5-mini` / `o1-mini` / `o3-mini`（自动使用 `max_completion_tokens` 参数）
- **第三方兼容服务**：通过 `OPENAI_BASE_URL` 指定（Azure / 国内代理等）

### 性能参考

| 模型 | 单页延迟 | 124 页总耗时 |
|---|---|---|
| `gpt-4o-mini` | 1-3s | 30-60 秒 |
| `gpt-4o` | 3-6s | 1-2 分钟 |
| `gpt-5-mini`（reasoning） | 15-40s | 30-80 分钟 |

## 环境变量

### 智能体相关

在「启动后端」界面填表会自动写入 `server/.env`。高级字段（带默认值的）可以不写入 `.env`，运行时用默认值兜底；空字符串也会被安全处理（`_env_str` / `_env_int` 容错）。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WIKI_RAW_PATH` | — | **必填**。原始 Wiki 根目录（含 `.md` / `.meta.json`），启动时 `launch.py` 自动转换到 `<WIKI_RAW_PATH>/wiki_result/` |
| `WIKI_ROOT_PATH` | 自动拼装 | `launch.py` 在运行时自动设为 `<WIKI_RAW_PATH>/wiki_result`，**不需要手填** |
| `SOURCE_ROOT_PATH` | 空 | 业务源码根目录（前端源码面板 + Agent Read 工具共用） |
| `CLAUDE_MODEL` | `sonnet` | Claude 模型：`sonnet` / `opus` / `haiku` |
| `CLAUDE_MAX_TOKENS` | `4096` | 智能体输出 token 上限 |
| `MAX_TOOL_ROUNDS` | `15` | 智能体最大工具调用轮次 |
| `NEO4J_URI` | 未设置 | Neo4j 连接地址（可选，未配置时跳过图谱查询） |
| `NEO4J_USER` | `neo4j` | Neo4j 用户名 |
| `NEO4J_PASSWORD` | 空 | Neo4j 密码 |
| `ASK_USER_COMM_DIR` | `/tmp/ask_user_comm` | `ask_user` MCP 结构化澄清的文件通信目录 |

### Wiki 路由索引相关（build_wiki_index.py）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENAI_API_KEY` | 未设置 | OpenAI API Key（LLM 模式必需） |
| `OPENAI_MODEL` | `gpt-4o-mini` | 使用的模型名 |
| `OPENAI_BASE_URL` | 未设置 | 第三方兼容服务地址（Azure / 国内代理等） |
| `OPENAI_MAX_TOKENS` | `600` / `4000` | 输出 token 上限（reasoning 模型自动用 4000） |
| `OPENAI_NO_JSON_MODE` | 未设置 | 设置为 `1` 跳过 `response_format` 参数（兼容部分代理） |

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/list_wikis` | GET | 获取 Wiki 文件树状列表 |
| `/api/wiki_index` | GET | 获取 Wiki 路由索引（`.index/wiki_index.json`），不存在时返回 404 |
| `/api/search_wiki?q=xxx` | GET | 全文搜索 Wiki 内容，返回匹配的 block 及预览 |
| `/api/scan_wikis` | GET | 扫描目录返回所有页面路径 |
| `/api/fetch_page?page_path=xxx` | POST | 获取单个 Wiki 页面内容 |
| `/api/user_query` | POST | 扩展查询 / 执行工作流 |
| `/api/detailed_query` | POST | 智能体交互（SSE 流式响应），自动识别提问/修改意图，支持 `resume_session_id` 追问 |
| `/api/clarification_answer` | POST | 用户回答澄清问题（配合 detailed_query 的 clarification 事件） |
| `/api/qa_query` | POST | Wiki & 源码自由问答（SSE 流式响应，无 block 选中时使用） |
| `/api/apply_changes` | POST | 确认并应用变更到 JSON 文件 |

## 目录结构

```
wiki-demo/
├── start.py                  # CLI 一键启动脚本（前端 + 后端）
├── launch.py                 # 前端 BackendLauncher 走的启动脚本（一致性检查 + 转换 + 建索引 + uvicorn）
├── demo.py                   # 后端启动脚本（支持 --build-index）
├── markdown_parser.py        # .meta.json / .md → 前端 JSON 转换器
├── build_wiki_index.py       # Wiki 路由索引构建工具（OpenAI 驱动）
├── clear.py                  # JSON 文件清理工具
├── server/
│   ├── server.py             # FastAPI 后端主程序（含 .env 管理、BackendLauncher API）
│   ├── agent.py              # Claude 智能体（交互式编辑 + 澄清机制）
│   ├── neo4j_mcp_server.py   # Neo4j MCP Server（知识图谱查询）
│   ├── ask_user_mcp_server.py# 结构化澄清 MCP Server
│   ├── .env                  # 环境变量（由 BackendLauncher 表单或手工维护）
│   └── logs/
│       └── agent.log         # 智能体调用日志
├── frontend/
│   ├── App.tsx               # 前端入口（后端未启动时显示 BackendLauncher）
│   ├── vite.config.ts        # 含 backendLauncherPlugin + sourceCodeScannerPlugin 两个自定义 dev 插件
│   ├── components/
│   │   ├── BackendLauncher.tsx    # 唯一的 .env 配置入口 + 启动按钮
│   │   ├── SourceCodePanel.tsx    # 源码面板（读 SOURCE_ROOT_PATH）
│   │   └── ...
│   ├── hooks/                # 自定义 Hooks
│   ├── services/             # API 服务层
│   └── utils/                # 工具函数
└── output/                   # 示例数据
    ├── *.meta.json           # 输入数据
    └── wiki_result/          # 转换后的前端 JSON
        ├── *.json            # Wiki 页面（被扫描）
        └── .index/           # 隐藏目录（不被扫描）
            ├── wiki_index.json  # LLM 路由索引
            └── meta/            # 单页缓存（增量构建用）
```

## 单独启动

### 仅启动后端（绕过 BackendLauncher）

```bash
python launch.py /path/to/wiki-data        # 自动转换 + 建索引 + 启动
python demo.py /path/to/wiki-data c        # 只转换 + 启动，不建索引
python demo.py /path/to/wiki-data --build-index  # 手工控制建索引
```

### 仅启动前端

```bash
cd frontend
npm run dev
```
后端未起时会显示 BackendLauncher；后端已起时跳过，直接进主界面。

## 清理 JSON 文件

```bash
python clear.py /path/to/wiki-data/wiki_result -f
```

## 故障排除

### BackendLauncher 启动失败 / 想重新配置
- 后端成功启动后 BackendLauncher 自动隐藏。如需改配置：
  1. `POST /api/dev/backend/stop` 或直接 `kill` 掉 launch.py 进程
  2. 刷新 http://localhost:3000 会自动回到 BackendLauncher
- SSE 日志里 `[error]` 行可直接看到失败原因；Python 侧详细日志在 `server/logs/agent.log`

### 端口被占用
- 后端端口：编辑 `frontend/vite.config.ts` 的 `BACKEND_PORT` 常量（默认 11219）
- 前端端口：编辑 `frontend/vite.config.ts` 的 `server: { port: 3000 }`

### `.env` 里某个字段是空串导致崩溃
- 已修复。`CLAUDE_MODEL=` / `CLAUDE_MAX_TOKENS=` 这类空值会被 `_env_str` / `_env_int` 容错为默认值
- 推荐做法：**直接删除空值行**，不要留 `KEY=`

### 智能体调用失败
- 确认 Claude Code CLI 已安装：`claude --version`
- 检查日志：`server/logs/agent.log`
- 如果使用第三方 Anthropic 中转，设置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`
- 确认 MCP 依赖已安装：`pip install mcp`

### Neo4j 查询失败
- 检查 `server/.env` 中的连接信息（`NEO4J_URI`、`NEO4J_USER`、`NEO4J_PASSWORD`）
- 未配置时智能体自动跳过图谱查询，改用 Read/Grep 读取源码

### 源码面板显示"未找到源代码文件"
- 确认 `SOURCE_ROOT_PATH` 已在 `server/.env` 或 BackendLauncher 中填写绝对路径
- 重启前端（Vite 插件只在启动时读 `.env`）

### 转换失败
- 确认 `markdown_parser.py` 存在
- 检查输入文件格式是否符合 `.meta.json` 或 `.md` 规范

### 前端启动失败
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```