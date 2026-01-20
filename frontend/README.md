# CodeNexus.AI

> 智能代码分析与可视化 WIKI 系统

基于双 AI 引擎（Gemini + CodeNexus 自研）的代码分析平台，自动理解代码库并生成多维度的交互式技术文档。

---

## 核心特性

- **双 AI 引擎** - Gemini（快速通用）+ CodeNexus Wiki（精准深度分析）
- **6 大分析视图** - 架构、API、业务流程、控制流、数据库、仪表盘
- **交互式 Wiki 对象** - 文档拆解为可操作的原子块，支持块级选择和修改
- **源码映射** - Mermaid 图表节点直接关联源代码，右键跳转
- **实时 Diff** - 可视化新增（绿）、修改（黄）、删除（红）
- **多页面导航** - 树形导航器支持多 Wiki 页面切换
- **历史记录管理** - 自动保存生成历史，侧边栏一键访问，支持快速恢复

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS (Apple Design) |
| AI | Google GenAI SDK + CodeNexus API |
| 图表 | Mermaid.js + Recharts |
| Markdown | react-markdown + remark-gfm |

---

## 项目结构

```
codewiki-ai/
├── components/
│   ├── AnalysisView.tsx          # 核心视图
│   ├── CodeNexusAnalysisView.tsx # CodeNexus 专用视图
│   ├── WikiBlock.tsx             # 原子块渲染器（递归+折叠）
│   ├── WikiPageNavigator.tsx     # 多页面导航
│   ├── WikiHistoryPanel.tsx      # Wiki 生成历史面板
│   ├── Mermaid.tsx               # 交互式图表
│   ├── SourceCodePanel.tsx       # 源码阅读器
│   └── QuestionSelector.tsx      # 问题选择器
├── services/
│   ├── geminiService.ts          # Gemini AI 服务
│   └── codenexusWikiService.ts   # CodeNexus API 服务
├── utils/
│   ├── markdownParser.ts         # Markdown 解析
│   ├── wikiContentParser.ts      # Wiki 内容解析
│   ├── treeBuilder.ts            # 树形结构工具
│   └── blockOperations.ts        # 块操作函数
└── types.ts                      # 类型定义
```

---

## 快速开始

```bash
# 克隆项目
git clone <repository-url>
cd codewiki-ai

# 安装依赖
npm install

# 配置环境变量
cat > .env.local << EOF
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_CODENEXUS_API_URL=http://localhost:11219
EOF

# 启动开发服务器
npm run dev
```

访问 `http://localhost:3000`

---

## 使用方式

### CodeNexus 可交互wiki
1. 在模型选择器中选择 "CodeNexus Wiki (自研)"
2. 输入查询，系统生成扩展问题
3. 勾选感兴趣的问题，点击确认
4. 查看结构化可交互 Wiki 文档（支持多页面导航）

#### 块级操作
- 点击块左侧复选框选中
- 输入修改指令（如"扩充这段描述"）
- 预览 Diff 后选择应用或放弃

### Gemini 模式
1. 选择分析类型（架构/API/业务流程等）
2. 输入查询或点击建议提示词
3. 查看生成的 Wiki 文档

---

## 文档

- [开发者手册](DEVELOPER_HANDBOOK.md) - 完整开发指南

---

## 版本

| 版本 | 更新 |
|------|------|
| v1.9 | Wiki 生成历史管理：侧边栏入口、全局历史面板、自动保存（最多 50 条）、快速恢复、时间格式化 |
| v1.8 | Mermaid 交互优化：修复图表类型检测 bug、类型感知的节点 ID 提取、支持 4 种图表类型精确交互 |
| v1.7 | 源码面板优化：自动扫描目录、文件树左侧布局、可调整宽度、范围高亮、智能交互 |
| v1.6 | Mermaid 节点映射 bug 修复（正确使用 mapping 中的 sourceRef）、查看图表源代码时自动居中显示图表、onMermaidNodeClick 回调增加 blockId 参数 |
| v1.5 |源代码联动高亮（WikiBlock、Mermaid 节点）、聊天面板随源代码面板自适应、导航栏大纲视图层级标题样式 |
| v1.4 | 可调整布局：聊天面板拖拽调整、导航栏/源代码面板/问题选择器可调整大小、Wiki 内容自适应 |
| v1.3 | 树形结构重构、递归渲染、折叠功能 |
| v1.2 | 多页面导航系统 |
| v1.1 | UI 交互优化 |
| v1.0 | CodeNexus 集成、双引擎系统 |

---

*Powered by Google Gemini & CodeNexus Wiki*
