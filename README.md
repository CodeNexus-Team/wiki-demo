# Hole9Wiki

基于 AI 的交互式代码仓库 Wiki 展示平台。

## 功能特性

- 自动将 `.meta.json` / `.md` 格式的 Wiki 数据转换为前端可渲染的 JSON 格式
- 交互式 Wiki 浏览：层级折叠、源码关联、Mermaid 图表、多页 Tab 切换
- AI 驱动的内容编辑：选中 block 后由 Claude 智能体读取源码并修改内容
- Diff 预览与变更审核：修改前后红绿对比，确认后写入文件
- Neo4j 知识图谱集成：代码实体关系查询

## 架构概览

```
前端 (React + Vite)          后端 (FastAPI)              智能体 (Claude CLI)
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  WikiBrowser    │     │  /api/fetch_page │     │  claude -p prompt   │
│  AnalysisView   │────▶│  /api/detailed   │────▶│  Read / Grep / Bash │
│  WikiContent    │     │  /api/apply      │     │  输出修改指令        │
│  DiffMode       │◀────│  /api/scan_wikis │◀────│                     │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
     :3000                   :11219
```

## 前置要求

### 后端依赖
- Python 3.7+
- 安装 Python 包：
  ```bash
  pip install fastapi uvicorn anthropic
  ```

### 前端依赖
- Node.js 16+
- 安装依赖：
  ```bash
  cd frontend
  npm install
  ```

### 智能体依赖（交互式编辑功能）
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并完成认证
- 验证安装：`claude --version`
- 安装 MCP 和环境变量支持：
  ```bash
  pip install mcp python-dotenv
  ```

### 可选依赖
- Gemini API Key（前端 AI 分析功能，未配置时 CodeNexus 功能不受影响）
- Neo4j 数据库（用于代码实体关系查询，未配置时自动跳过）

## 快速开始

### 1. 转换数据并启动

```bash
python start.py /path/to/wiki-data c
```

执行流程：
1. 扫描目录下的 `.md` 和 `.meta.json` 文件
2. 转换为前端 JSON 格式，输出到 `/path/to/wiki-data/wiki_result/`
3. 启动后端（http://localhost:11219）和前端（http://localhost:3000）

### 2. 直接启动（已有转换后数据）

```bash
python start.py /path/to/wiki-data
```

### 3. 浏览器访问

打开 http://localhost:3000，在侧边栏点击「生成 Wiki」，点击生成按钮即可浏览所有 Wiki 页面。

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

交互式编辑功能需要访问代码仓库的实际源码文件。源码文件需存放在以下位置：

```
frontend/public/source-code/
└── <项目名>/                    # 代码仓库根目录
    ├── mall-admin/
    │   └── src/main/java/...
    ├── mall-common/
    │   └── src/main/java/...
    └── ...
```

**两个使用场景：**

1. **前端源码面板展示**：点击 Wiki block 关联的源码引用时，前端直接从 `frontend/public/source-code/` 加载文件内容并高亮显示。

2. **智能体读取源码**：Claude CLI 的工作目录为项目根目录，模型通过 `Read` 工具读取 `frontend/public/source-code/<项目名>/` 下的文件来获取准确信息。System Prompt 中需指定源码路径（当前硬编码在 `agent.py` 的 `SYSTEM_PROMPT` 中）。

**配置步骤：**

1. 将代码仓库复制或软链接到 `frontend/public/source-code/` 下：
   ```bash
   # 复制
   cp -r /path/to/your/java-project frontend/public/source-code/my-project

   # 或软链接（推荐，避免重复占用空间）
   ln -s /path/to/your/java-project frontend/public/source-code/my-project
   ```

2. 设置环境变量 `SOURCE_ROOT_PATH` 或修改 `server/agent.py` 中的默认值：
   ```bash
   export SOURCE_ROOT_PATH=/absolute/path/to/wiki-demo/frontend/public/source-code/my-project
   ```

> `.meta.json` 中 `source_id_list[].name` 的文件路径应与 `frontend/public/source-code/<项目名>/` 下的相对路径一致。例如 `name` 为 `mall-admin/src/main/java/com/macro/mall/config/GlobalCorsConfig.java`，则对应文件为 `frontend/public/source-code/mall/mall-admin/src/main/java/com/macro/mall/config/GlobalCorsConfig.java`。

## 交互式编辑（智能体）

在前端选中一个或多个 block 后输入修改指令，后端会：

1. 提取选中 block 的内容、页面结构概览、关联源码路径（含祖先链 neo4j 信息）
2. 调用 Claude Code CLI（流式读取 stream-json 事件，实时推送进度）
3. 如用户指令模糊，触发**澄清机制**：前端展示可点选的选项按钮，用户选择后在同一会话中继续
4. 模型通过 Read/Grep 读取源码，输出修改指令（replace / insert_after / delete）
5. 前端展示 Diff 预览（红色原内容 / 绿色新内容）
6. 用户确认后写入 JSON 文件

### 澄清机制

当用户输入模糊指令（如"优化"、"调整"）时，Agent 会先提出澄清问题并给出可选方向：

- 前端在输入框上方渲染选项按钮，用户一键选择
- 最后一项固定为「其他」，支持自由输入
- 选择后通过 `--resume` 在同一会话中继续，保留已读源码上下文

### 智能体日志

调用日志保存在 `server/logs/agent.log`，记录：
- 每次请求的参数和耗时
- Claude 调用的工具（Read、Grep、Bash 等）及返回结果
- 模型输出的修改指令内容

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WIKI_ROOT_PATH` | 自动设置 | Wiki JSON 文件根目录（启动时由 demo.py 自动设置为 `<root>/wiki_result`） |
| `CLAUDE_MODEL` | `sonnet` | Claude 模型选择：`sonnet` / `opus` / `haiku` |
| `CLAUDE_MAX_TOKENS` | `4096` | 智能体输出 token 上限 |
| `MAX_TOOL_ROUNDS` | `15` | 智能体最大工具调用轮次 |
| `SOURCE_ROOT_PATH` | 空 | 源码根目录（智能体读取源码时使用） |
| `NEO4J_URI` | 未设置 | Neo4j 连接地址（可选，未配置时跳过图谱查询） |
| `NEO4J_USER` | `neo4j` | Neo4j 用户名 |
| `NEO4J_PASSWORD` | 空 | Neo4j 密码 |

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/list_wikis` | GET | 获取 Wiki 文件树状列表 |
| `/api/scan_wikis` | GET | 扫描目录返回所有页面路径 |
| `/api/fetch_page?page_path=xxx` | POST | 获取单个 Wiki 页面内容 |
| `/api/user_query` | POST | 扩展查询 / 执行工作流 |
| `/api/detailed_query` | POST | 智能体交互式修改（SSE 流式响应，支持 progress/clarification/result/error 事件） |
| `/api/clarification_answer` | POST | 用户回答澄清问题（配合 detailed_query 的 clarification 事件） |
| `/api/apply_changes` | POST | 确认并应用变更到 JSON 文件 |

## 目录结构

```
wiki-demo/
├── start.py                # 一键启动脚本（前端 + 后端）
├── demo.py                 # 后端启动脚本
├── markdown_parser.py      # .meta.json / .md → 前端 JSON 转换器
├── clear.py                # JSON 文件清理工具
├── server/
│   ├── server.py           # FastAPI 后端主程序
│   ├── agent.py            # Claude 智能体（交互式编辑 + 澄清机制）
│   ├── neo4j_mcp_server.py # Neo4j MCP Server（知识图谱查询）
│   ├── backend_mock.py     # Mock 实现
│   ├── .env                # 环境变量配置（Neo4j 连接等）
│   └── logs/
│       └── agent.log       # 智能体调用日志
├── frontend/
│   ├── App.tsx             # 前端入口
│   ├── components/         # React 组件
│   ├── hooks/              # 自定义 Hooks
│   ├── services/           # API 服务层
│   └── utils/              # 工具函数
└── output_all/             # 示例数据
    ├── *.meta.json         # 输入数据
    └── wiki_result/        # 转换后的前端 JSON
```

## 单独启动

### 仅启动后端

```bash
python demo.py /path/to/wiki-data [c]
```

### 仅启动前端

```bash
cd frontend
npm run dev
```

## 清理 JSON 文件

```bash
python clear.py /path/to/wiki-data/wiki_result -f
```

## 故障排除

### 端口被占用
- 后端端口：编辑 `demo.py`，修改 `port=11219`
- 前端端口：编辑 `frontend/vite.config.ts`，添加 `server: { port: 3001 }`

### Gemini API 未配置
- 不影响 CodeNexus 功能使用，仅前端 Gemini 分析功能不可用
- 如需使用，在 `frontend/.env.local` 中设置 `GEMINI_API_KEY` 后重启前端

### 智能体调用失败
- 确认 Claude Code CLI 已安装：`claude --version`
- 检查日志：`server/logs/agent.log`
- 如果使用第三方中转，在 `agent.py` 中配置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`
- 确认 MCP 依赖已安装：`pip install mcp`

### Neo4j 查询失败
- 检查 `server/.env` 中的连接信息（`NEO4J_URI`、`NEO4J_USER`、`NEO4J_PASSWORD`）
- 未配置时智能体会自动跳过图谱查询，改用 Read/Grep 读取源码

### 转换失败
- 确认 `markdown_parser.py` 存在
- 检查输入文件格式是否符合 `.meta.json` 或 `.md` 规范

### 前端启动失败
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```