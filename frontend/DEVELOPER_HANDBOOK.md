# CodeNexus.AI 开发者手册

> 智能代码分析与可视化 WIKI 系统 - 完整开发指南

**版本**: v2.0
**最后更新**: 2026-01-22

---

## 目录

- [项目概述](#项目概述)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [核心架构](#核心架构)
- [双引擎系统](#双引擎系统)
- [WikiBlock 树形结构](#wikiblock-树形结构)
- [API 接口](#api-接口)
- [可调整布局系统](#可调整布局系统)
- [源代码联动高亮系统](#源代码联动高亮系统)
- [源代码面板优化](#源代码面板优化)
- [Mermaid 节点映射解析](#mermaid-节点映射解析)
- [导航栏大纲视图](#导航栏大纲视图)
- [Wiki 生成历史管理](#wiki-生成历史管理)
- [开发指南](#开发指南)
- [故障排查](#故障排查)

---

## 项目概述

CodeNexus.AI 是一个基于 AI 的代码分析和文档生成工具，支持双 AI 引擎（Gemini + CodeNexus 自研），能够自动理解代码库并生成多维度的技术文档。

### 核心特性

| 特性 | 说明 |
|------|------|
| 6 大分析视图 | 架构视图、API 分析、业务流程、控制流、数据库设计、仪表盘 |
| 双 AI 引擎 | Gemini（快速）+ CodeNexus Wiki（精准） |
| 智能 WIKI 系统 | 文档拆解为可操作的"原子块"，支持块级选择和修改 |
| 树形结构 | 支持层级展示、折叠/展开、递归渲染 |
| 交互式图表 | Mermaid 图表节点可直接关联源代码位置，点击后高亮对应节点并自动居中 |
| 实时 Diff 系统 | 可视化展示新增、修改、删除的内容 |
| 多页面导航 | 支持多 Wiki 页面的树形导航和切换，大纲视图按标题层级显示 |
| 可调整布局 | 聊天面板、导航栏、源代码面板均支持拖拽调整大小，内容区域自适应 |
| 源代码联动 | 查看源代码时自动高亮对应的 WikiBlock 和 Mermaid 节点 |
| 历史记录管理 | 自动保存生成历史，支持快速恢复、删除和清空，侧边栏一键访问 |

---

## 技术栈

### 核心框架
- **React 19.2.0** - Hooks 架构
- **TypeScript 5.8.2** - 强类型支持
- **Vite 6.2.0** - 现代化构建工具

### UI 与样式
- **Tailwind CSS** - 实用优先 CSS 框架
- **Apple Design Language** - 毛玻璃效果、圆角、阴影
- **Lucide React** - 轻量级图标库

### AI 集成
- **@google/genai ^1.30.0** - Google Gemini AI SDK
- **CodeNexus Wiki API** - 自研代码分析引擎

### 数据可视化
- **Mermaid.js ^11.12.1** - 流程图、架构图、时序图
- **Recharts ^3.4.1** - 统计图表

### Markdown 生态
- **react-markdown ^10.1.0** - Markdown 渲染
- **remark-gfm ^4.0.1** - GitHub Flavored Markdown
- **react-syntax-highlighter ^15.5.0** - 代码高亮

---

## 项目结构

```
codewiki-ai/
├── components/                    # React 组件
│   ├── AnalysisView.tsx          # 核心视图：聊天、Wiki 渲染、状态管理
│   ├── CodeNexusAnalysisView.tsx # CodeNexus 专用视图
│   ├── Dashboard.tsx             # 仪表盘：统计图表
│   ├── Sidebar.tsx               # 侧边栏导航（含历史记录入口）
│   ├── WikiBlock.tsx             # 原子块渲染器（支持递归、折叠、三点菜单、高亮）
│   ├── WikiPageNavigator.tsx     # 多页面树形导航器（可调整大小、结构导航、层级标题）
│   ├── WikiHistoryPanel.tsx      # Wiki 生成历史面板（侧边栏滑入）
│   ├── Mermaid.tsx               # Mermaid 图表封装（支持节点高亮）
│   ├── SourceCodePanel.tsx       # 源代码阅读器（可调整宽度、联动高亮）
│   └── QuestionSelector.tsx      # CodeNexus 问题选择器（可调整大小）
│
├── services/
│   ├── geminiService.ts          # Gemini AI 服务层
│   └── codenexusWikiService.ts   # CodeNexus API 服务层
│
├── utils/
│   ├── markdownParser.ts         # Markdown -> WikiBlock 解析器
│   ├── wikiContentParser.ts      # CodeNexus 结构化内容解析器
│   ├── treeBuilder.ts            # 树形结构工具函数
│   └── blockOperations.ts        # 树形操作函数（增删改）
│
├── mock/
│   └── sourceCode.ts             # 模拟 Java 代码库数据
│
├── App.tsx                       # 根组件：视图路由
├── types.ts                      # 全局 TypeScript 类型定义
├── vite.config.ts                # Vite 构建配置
└── package.json                  # 依赖管理
```

---

## 核心架构

### 组件层级

```
App
├── Sidebar (导航菜单 + 历史记录入口)
├── WikiHistoryPanel (历史记录面板，全局渲染)
└── <main>
    ├── Dashboard (仪表盘)
    └── AnalysisView (分析视图)
        ├── WikiPageNavigator (多页面导航)
        ├── WikiBlockRenderer[] (原子块渲染)
        │   ├── Mermaid (图表)
        │   ├── SyntaxHighlighter (代码)
        │   └── ReactMarkdown (文本)
        ├── SourceCodePanel (源码面板)
        └── ChatDeck (聊天面板)
            └── QuestionSelector (问题选择器)
```

### 数据流

```
用户输入 → handleAnalyze()
    ↓
[Gemini 模式]              [CodeNexus 模式]
geminiService.analyze()    codenexusWikiService.expandQuery()
    ↓                          ↓
返回 Markdown              QuestionSelector (用户选择)
    ↓                          ↓
parseMarkdownToBlocks()    executeWorkflow() → fetchPage()
    ↓                          ↓
                           parseWikiPageToBlocks()
    ↓                          ↓
    └──────── setBlocks() ─────┘
                  ↓
         WikiBlockRenderer 渲染
                  ↓
         用户交互 (选择、折叠、Diff)
```

---

## 双引擎系统

### 引擎对比

| 特性 | Gemini AI | CodeNexus Wiki |
|------|-----------|----------------|
| 速度 | 快速 | 中等（需执行工作流） |
| 精准度 | 通用 | 精准（基于代码分析） |
| 交互方式 | 直接生成 | 问题选择 → 生成 |
| 内容格式 | Markdown | 结构化 JSON + 源码引用 |
| 适用场景 | 快速原型、简单查询 | 深度分析、生产环境 |

### Gemini 模式

```typescript
// services/geminiService.ts
const result = await geminiService.analyze(type, prompt, model, onProgress);
const blocks = parseMarkdownToBlocks(result);
```

### CodeNexus 模式

```typescript
// services/codenexusWikiService.ts

// 1. 扩展查询
const questions = await codenexusWikiService.expandQuery(userQuery);

// 2. 用户选择问题后执行工作流
const workflow = await codenexusWikiService.executeWorkflow(
  userQuery, selectedQuestions, onProgress
);

// 3. 获取页面内容
const page = await codenexusWikiService.fetchPage(workflow.wiki_pages[0]);

// 4. 解析为 WikiBlock
const blocks = parseWikiPageToBlocks(page.content, page.source);
```

---

## WikiBlock 树形结构

### 数据结构

```typescript
// types.ts
interface WikiBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'mermaid' | 'table';
  content: string;
  level?: number;           // 标题层级 (1-6)
  language?: string;        // 代码块语言
  metadata?: MermaidMetadata;
  diffStatus?: 'original' | 'modified' | 'inserted' | 'deleted';

  // 树形结构字段
  children?: WikiBlock[];   // 子节点
  parentId?: string;        // 父节点ID
  depth?: number;           // 深度（用于缩进）
  isCollapsed?: boolean;    // 折叠状态
}
```

### 核心工具函数

```typescript
// utils/treeBuilder.ts
buildTree(blocks)           // 扁平数组 → 树形结构
flattenTree(tree)           // 树形结构 → 扁平数组
findBlockById(blocks, id)   // 递归查找节点
collectBlocksByIds(blocks, ids)  // 收集选中的块
getVisibleBlocks(blocks, collapsed)  // 获取可见节点

// utils/blockOperations.ts
insertBlockAfter(blocks, targetId, newBlock)  // 插入块
deleteBlock(blocks, targetId)                  // 删除块
updateBlockContent(blocks, targetId, content)  // 更新内容
markBlockAsDeleted(blocks, targetId)          // 标记删除
toggleBlockCollapse(blocks, targetId)         // 切换折叠
```

### 递归渲染

```tsx
// components/WikiBlock.tsx
function WikiBlockRenderer({ block, isSelected, selectedBlockIds, onToggleCollapse }) {
  return (
    <div style={{ marginLeft: `${(block.depth || 0) * 1.5}rem` }}>
      {/* 块内容 */}
      <BlockContent block={block} />

      {/* 折叠按钮（仅 heading 有 children 时显示） */}
      {block.type === 'heading' && block.children?.length > 0 && (
        <CollapseButton onClick={onToggleCollapse} />
      )}

      {/* 递归渲染子节点 */}
      {!block.isCollapsed && block.children?.map(child => (
        <WikiBlockRenderer
          key={child.id}
          block={child}
          isSelected={selectedBlockIds?.has(child.id)}
          selectedBlockIds={selectedBlockIds}
        />
      ))}
    </div>
  );
}
```

---

## API 接口

### CodeNexus API

**Base URL**: `VITE_CODENEXUS_API_URL` (默认 `http://localhost:11219`)

#### 1. 统一查询 `/api/user_query`

```typescript
// 扩展查询（无 selected_questions）
POST { user_query: "分析订单服务" }
→ { questions: ExpandedQuestion[] }

// 执行工作流（有 selected_questions）
POST { user_query: "...", selected_questions: [...] }
→ { wiki_root: string, wiki_pages: string[] }
```

#### 2. 获取页面 `/api/fetch_page`

```typescript
POST { page_path: "/wiki/xxx/page.json" }
→ { content: WikiPageContent[], source: WikiSource[] }
```

#### 3. 详细查询 `/api/detailed_query`

```typescript
POST { page_path: "...", block_ids: [...], user_query: "..." }
→ ModifyPageResponse | NewPageResponse
```

#### 4. 应用变更 `/api/apply_changes`

```typescript
POST { page_path: "...", page_diff: ModifyPageResponse }
→ { success: boolean, message: string, updated_path: string }
```

**说明**：用户确认变更后调用此接口，将 `page_diff` 应用到对应的页面文件。详细查询接口只返回预览数据，不会修改文件。

### 响应类型

```typescript
// 修改当前页面
interface ModifyPageResponse {
  insert_blocks: Array<{ after_block: string; block: WikiPageContent }>;
  delete_blocks: string[];
  insert_sources: WikiSource[];
  delete_sources: string[];
}

// 新增页面
interface NewPageResponse {
  new_page_path: string;
  new_page: WikiPage;
}
```

### 后端函数分类

后端函数分为两类：

| 函数 | 位置 | 类型 | 说明 |
|------|------|------|------|
| `expand_query_mock` | backend_mock.py | Mock | 待接入 AI 工作流 |
| `execute_workflow_mock` | backend_mock.py | Mock | 待接入 AI 工作流 |
| `detailed_query_mock` | backend_mock.py | Mock | 待接入 AI 工作流 |
| `fetch_page` | server.py | **真实实现** | 纯文件读取操作 |
| `apply_changes` | server.py | **真实实现** | 纯文件修改操作 |

`fetch_page` 和 `apply_changes` 是真实的文件操作逻辑，不依赖 AI。即使将来接入实际的 AI 工作流，这两个函数的逻辑也保持不变。

---

## 变更预览与应用工作流

### 概述

用户修改 Wiki 内容时，系统采用"预览→确认→应用"的工作流，确保用户在确认前可以预览变更效果，且不会意外修改文件。

### 工作流程

```
用户选择块 + 输入指令
        ↓
调用 /api/detailed_query
        ↓
后端返回 page_diff（预览数据，不修改文件）
        ↓
前端显示 Diff 预览（新增绿色、删除红色）
        ↓
    ┌───────┴───────┐
    ↓               ↓
用户点击"应用"   用户点击"放弃"
    ↓               ↓
调用 /api/apply_changes   恢复原始内容
    ↓               ↓
后端修改文件      清除 pendingPageDiff
    ↓
刷新页面显示
```

### 前端状态管理

```typescript
// components/AnalysisView.tsx
const [pendingPageDiff, setPendingPageDiff] = useState<ModifyPageResponse | null>(null);

// 收到预览数据时保存
const handleDetailedQueryResponse = (response: ModifyPageResponse) => {
  setPendingPageDiff(response);
  // 应用 Diff 到 UI 预览...
};

// 用户确认应用变更
const handleApplyChanges = async () => {
  if (pendingPageDiff && currentPagePath) {
    await codenexusWikiService.applyChanges(currentPagePath, pendingPageDiff);
  }
  setPendingPageDiff(null);
  // 刷新页面...
};

// 用户放弃变更
const handleDiscardChanges = () => {
  setPendingPageDiff(null);
  // 恢复原始内容...
};
```

### 块插入逻辑

前后端保持一致的插入逻辑：

```typescript
// 插入块到指定位置
function insertAfterBlock(blockList, afterId, newBlock) {
  for (const block of blockList) {
    if (block.id === afterId) {
      if (block.type === "section") {
        // section 类型：新块作为第一个子节点插入
        block.content.unshift(newBlock);
      } else {
        // 非 section 类型：新块作为下一个兄弟节点插入
        const index = blockList.indexOf(block);
        blockList.splice(index + 1, 0, newBlock);
      }
      return true;
    }
    // 递归搜索子节点...
  }
  return false;
}
```

**规则说明**：
- `section` 类型块：新块插入为其第一个子节点（内容层级）
- 其他类型块（text、mermaid 等）：新块插入为其下一个兄弟节点（同层级）

---

## Mermaid 图表状态显示

### 概述

Mermaid 图表支持显示不同的状态（删除、新增、修改），在 Diff 预览时提供清晰的视觉反馈。

### 状态类型

```typescript
// components/Mermaid.tsx
interface MermaidProps {
  status?: 'deleted' | 'inserted' | 'modified';
  // ...
}
```

### 删除状态样式

删除状态的 Mermaid 图表显示以下视觉效果：
- 降低透明度（opacity: 40%）
- 红色边框（2px solid red）
- X 形交叉线覆盖
- "删除" 标签（右上角红色背景）

```tsx
// components/Mermaid.tsx
{status === 'deleted' && (
  <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-lg">
    {/* 红色半透明背景 */}
    <div className="absolute inset-0 bg-red-200/40" />

    {/* X 形交叉线 */}
    <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
      <line x1="0" y1="0" x2="100%" y2="100%" stroke="#ef4444" strokeWidth="2" />
      <line x1="100%" y1="0" x2="0" y2="100%" stroke="#ef4444" strokeWidth="2" />
    </svg>

    {/* 删除标签 */}
    <div className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded">
      删除
    </div>
  </div>
)}
```

### WikiBlock 传递状态

```tsx
// components/WikiBlock.tsx
case 'mermaid':
  return (
    <Mermaid
      chart={content}
      metadata={block.metadata}
      status={block.status}  // 传递状态到 Mermaid 组件
      // ...
    />
  );
```

---

## Wiki 生成历史管理

### 概述

系统自动保存每次 Wiki 生成的历史记录，用户可以通过侧边栏快速访问、恢复或管理历史记录。

### 架构设计

#### 状态管理

历史记录状态在 App.tsx 中集中管理，确保在所有页面（包括仪表盘）都能访问：

```typescript
// App.tsx
const [wikiHistory, setWikiHistory] = useState<WikiHistoryRecord[]>([]);
const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

// 历史记录操作
const handleSelectHistory = (record: WikiHistoryRecord) => {
  // 从仪表盘自动切换到分析视图
  if (currentView === AnalysisType.DASHBOARD && record.blocks.length > 0) {
    setCurrentView(AnalysisType.ARCHITECTURE);
  }
  setIsHistoryPanelOpen(false);
};

const handleDeleteHistory = (id: string) => {
  setWikiHistory(prev => prev.filter(record => record.id !== id));
};

const handleClearAllHistory = () => {
  setWikiHistory([]);
  setIsHistoryPanelOpen(false);
};
```

#### 数据结构

```typescript
// types.ts
interface WikiHistoryRecord {
  id: string;              // 唯一标识
  timestamp: number;       // 生成时间戳
  userQuery: string;       // 用户查询
  modelId: string;         // 使用的模型
  blocks: WikiBlock[];     // 生成的 Wiki 块（完整数据）
  pagePath?: string;       // 页面路径
  wikiPages?: string[];    // 相关 Wiki 页面列表
}
```

### 功能特性

#### 1. 侧边栏入口

历史记录入口位于 Sidebar 底部，显示历史记录数量徽章：

```typescript
// components/Sidebar.tsx
<button onClick={onOpenHistory}>
  <History size={18} />
  <span>wiki生成历史</span>
  {wikiHistory.length > 0 && (
    <span className="badge">{wikiHistory.length}</span>
  )}
</button>
```

#### 2. 历史面板

右侧滑入式面板，z-index 层级为 60/70，确保在所有组件之上：

```typescript
// components/WikiHistoryPanel.tsx
// 背景遮罩层 z-[60]
<div className="fixed inset-0 bg-black/20 z-[60] backdrop-blur-sm" />

// 面板本身 z-[70]
<div className="fixed right-0 top-0 bottom-0 w-96 bg-white z-[70]">
  {/* 历史记录列表 */}
</div>
```

#### 3. 自动保存

在两个场景自动保存历史记录：

```typescript
// components/AnalysisView.tsx

// 场景1：CodeNexus 工作流完成后
const workflowResult = await codenexusWikiService.executeWorkflow(...);
const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
saveToHistory(currentUserQuery, parsedBlocks);

// 场景2：Gemini 分析完成后
const resultText = await geminiService.analyze(...);
const parsedBlocks = parseMarkdownToBlocks(resultText);
saveToHistory(currentPrompt, parsedBlocks);

// 保存函数（最多保留 50 条）
const saveToHistory = (userQuery: string, generatedBlocks: WikiBlock[]) => {
  const record: WikiHistoryRecord = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    userQuery,
    modelId: selectedModel,
    blocks: generatedBlocks,
    pagePath: currentPagePath || undefined,
    wikiPages: wikiPages.length > 0 ? wikiPages : undefined
  };
  setWikiHistory(prev => [record, ...prev].slice(0, 50));
};
```

#### 4. 恢复历史

点击历史记录卡片恢复内容：

```typescript
// App.tsx - 全局处理
const handleSelectHistory = (record: WikiHistoryRecord) => {
  // 从仪表盘自动切换到分析视图
  if (currentView === AnalysisType.DASHBOARD) {
    setCurrentView(AnalysisType.ARCHITECTURE);
  }
  setIsHistoryPanelOpen(false);
};

// AnalysisView.tsx - 恢复内容
const handleSelectHistory = (record: WikiHistoryRecord) => {
  setBlocks(record.blocks);
  if (record.pagePath) setCurrentPagePath(record.pagePath);
  if (record.wikiPages) setWikiPages(record.wikiPages);
  onSelectHistory(record);  // 调用全局回调
  setChatHistory(prev => [...prev, {
    role: 'assistant',
    content: `已恢复历史记录：${record.userQuery}`,
    timestamp: Date.now()
  }]);
};
```

#### 5. 时间格式化

智能显示相对时间：

```typescript
// components/WikiHistoryPanel.tsx
const formatTime = (timestamp: number) => {
  const diffMins = Math.floor((Date.now() - timestamp) / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
```

### 层级问题解决

**问题**：历史面板与聊天框等组件层级冲突，导致同时显示。

**解决方案**：
1. 将 WikiHistoryPanel 从 AnalysisView 移到 App.tsx 全局渲染
2. 提升 z-index：背景遮罩 z-[60]，面板 z-[70]
3. 确保在所有页面（包括仪表盘）都能正常显示

### 持久化建议

当前实现使用内存存储（React state），页面刷新后数据丢失。建议添加 LocalStorage 持久化：

```typescript
// App.tsx
const [wikiHistory, setWikiHistory] = useState<WikiHistoryRecord[]>(() => {
  try {
    const saved = localStorage.getItem('wiki-history');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
});

useEffect(() => {
  try {
    localStorage.setItem('wiki-history', JSON.stringify(wikiHistory));
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}, [wikiHistory]);
```

**注意事项**：
- LocalStorage 限制约 5-10MB
- 需要处理存储配额超限的情况
- 考虑只保存摘要信息以减少存储空间

---

## 开发指南

### 环境配置

```bash
# 1. 克隆项目
git clone <repository-url>
cd codewiki-ai

# 2. 安装依赖
npm install

# 3. 配置环境变量
cat > .env.local << EOF
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_CODENEXUS_API_URL=http://localhost:11219
EOF

# 4. 启动开发服务器
npm run dev
```

### 添加新分析类型

1. **types.ts** - 添加枚举值
```typescript
enum AnalysisType {
  SECURITY_ANALYSIS = 'SECURITY_ANALYSIS',
}
```

2. **geminiService.ts** - 添加系统指令和建议提示词
```typescript
const SYSTEM_INSTRUCTION = {
  SECURITY_ANALYSIS: `你是一位安全专家...`,
};

const SUGGESTIONS = {
  SECURITY_ANALYSIS: ['扫描 SQL 注入漏洞', ...],
};
```

3. **Sidebar.tsx** - 添加导航按钮
```tsx
<NavButton icon={Shield} label="安全分析" type={AnalysisType.SECURITY_ANALYSIS} />
```

### 处理树形结构操作

```typescript
// 正确方式：使用递归操作函数
import { insertBlockAfter, markBlockAsDeleted, updateBlockContent } from '@/utils/blockOperations';
import { collectBlocksByIds, findBlockById } from '@/utils/treeBuilder';

// 收集选中的块（支持任意深度）
const selectedBlocks = collectBlocksByIds(blocks, selectedBlockIds);

// 删除块
newBlocks = markBlockAsDeleted(newBlocks, blockId);

// 插入块
newBlocks = insertBlockAfter(newBlocks, afterBlockId, newBlock);

// 更新内容
newBlocks = updateBlockContent(newBlocks, blockId, newContent);
```

---

## 可调整布局系统

### 聊天面板调整

聊天面板支持三个方向的拖拽调整：左右调整宽度，上方调整高度。

```typescript
// components/AnalysisView.tsx
const [chatWidth, setChatWidth] = useState(768);
const [chatHeight, setChatHeight] = useState(
  () => typeof window !== 'undefined' ? window.innerHeight * 0.9 : 500
);
const isDraggingRef = useRef<'left' | 'right' | 'top' | null>(null);

// 拖拽处理
useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    if (isDraggingRef.current === 'left' || isDraggingRef.current === 'right') {
      const centerX = window.innerWidth / 2;
      const newHalfWidth = Math.abs(e.clientX - centerX);
      const newWidth = Math.max(400, Math.min(newHalfWidth * 2, window.innerWidth - 300));
      setChatWidth(newWidth);
    } else if (isDraggingRef.current === 'top') {
      const newHeight = Math.max(200, Math.min(window.innerHeight - e.clientY, window.innerHeight - 100));
      setChatHeight(newHeight);
    }
  };
  // ...
}, []);
```

**重要**：拖拽控制只在 `hasContent` 为 true 时显示（即有对话内容后）。

### 源代码面板宽度调整

源代码面板宽度通过父组件（AnalysisView）管理，支持左边缘拖拽。

```typescript
// components/AnalysisView.tsx - 状态提升
const [sourcePanelWidth, setSourcePanelWidth] = useState(600);

<SourceCodePanel
  panelWidth={sourcePanelWidth}
  onWidthChange={setSourcePanelWidth}
/>

// Wiki 内容区域自适应
<div style={{ paddingRight: isSourcePanelOpen ? sourcePanelWidth : 0 }}>
  {/* Wiki 内容 */}
</div>
```

```typescript
// components/SourceCodePanel.tsx
interface SourceCodePanelProps {
  panelWidth: number;
  onWidthChange: (width: number) => void;
}

// 左边缘拖拽
<div
  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/30"
  onMouseDown={() => { isDraggingRef.current = true; }}
/>
```

### 导航栏和问题选择器

使用 CSS `resize` 属性实现简单的调整功能：

```tsx
// WikiPageNavigator.tsx
<div
  className="resize overflow-auto"
  style={{ width: 256, minWidth: 200, minHeight: 200 }}
>
  {/* 导航内容 */}
</div>

// QuestionSelector.tsx
<div
  className="resize min-w-[300px] min-h-[200px]"
  style={{ width: '100%', height: '500px' }}
>
  {/* 问题列表 */}
</div>
```

### 聊天面板随源代码面板自适应

当源代码面板打开时，聊天面板会自动向左移动以避免被遮挡：

```typescript
// components/AnalysisView.tsx
<div
  className="fixed bottom-0 left-64 z-50 flex flex-col items-center"
  style={{ right: isSourcePanelOpen ? sourcePanelWidth : 0 }}
>
  {/* 聊天面板内容 */}
</div>
```

---

## 源代码联动高亮系统

### 概述

当用户查看源代码时，系统会自动高亮对应的 WikiBlock 或 Mermaid 图表节点，建立代码与文档的视觉关联。

### 状态管理

```typescript
// components/AnalysisView.tsx
const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
const [highlightedMermaidNodeId, setHighlightedMermaidNodeId] = useState<string | null>(null);

// 点击查看源代码时设置高亮
const handleSourceClick = (blockId: string, sourceId: string, sources: any[]) => {
  // ... 解析源代码位置
  setHighlightedBlockId(blockId);
  setIsSourcePanelOpen(true);
};

// 点击 Mermaid 节点时设置高亮
const handleMermaidNodeClick = (nodeId: string, metadata?: MermaidMetadata, blockId?: string) => {
  // ... 解析源代码位置
  setHighlightedMermaidNodeId(nodeId);
  // 同时设置 block 高亮，以便图表居中显示
  if (blockId) {
    setHighlightedBlockId(blockId);
  }
  setIsSourcePanelOpen(true);
};

// 关闭源代码面板时清除高亮
onClose={() => {
  setIsSourcePanelOpen(false);
  setHighlightedBlockId(null);
  setHighlightedMermaidNodeId(null);
}}
```

### WikiBlock 高亮

```typescript
// components/WikiBlock.tsx
interface WikiBlockRendererProps {
  highlightedBlockId?: string | null;
  highlightedMermaidNodeId?: string | null;
  // ...
}

const isHighlighted = highlightedBlockId === block.id;

const getDiffStyles = () => {
  if (isHighlighted) {
    return 'bg-orange-50 border-orange-300 ring-2 ring-orange-200 shadow-md';
  }
  // ... 其他状态样式
};
```

### Mermaid 节点高亮

通过将 CSS 样式注入到 SVG 中实现持久化高亮：

```typescript
// components/Mermaid.tsx
interface MermaidProps {
  highlightedNodeId?: string | null;
  // ...
}

const getHighlightedSvg = () => {
  if (!svg || !highlightedNodeId) return svg;

  // 注入高亮样式到 SVG
  const highlightStyle = `
    <style>
      [id*="${highlightedNodeId}"] {
        filter: drop-shadow(0 0 8px rgba(249, 115, 22, 0.6)) !important;
      }
      [id*="${highlightedNodeId}"] rect,
      [id*="${highlightedNodeId}"] circle,
      [id*="${highlightedNodeId}"] ellipse,
      [id*="${highlightedNodeId}"] polygon,
      [id*="${highlightedNodeId}"] path:not([class*="edge"]) {
        stroke: #f97316 !important;
        stroke-width: 3px !important;
      }
    </style>
  `;

  return svg.replace(/<svg([^>]*)>/, `<svg$1>${highlightStyle}`);
};

// 渲染时使用处理后的 SVG
<div dangerouslySetInnerHTML={{ __html: getHighlightedSvg() }} />
```

### 递归传递高亮状态

在 WikiBlockRenderer 递归渲染子组件时需要传递高亮状态：

```tsx
{block.children?.map(child => (
  <WikiBlockRenderer
    key={child.id}
    block={child}
    highlightedBlockId={highlightedBlockId}
    highlightedMermaidNodeId={highlightedMermaidNodeId}
    // ... 其他 props
  />
))}
```

### 查看源代码时自动居中

当用户点击查看源代码时，对应的 WikiBlock 或 Mermaid 图表会自动滚动到视图中心：

```typescript
// components/AnalysisView.tsx
// 源代码面板打开时，滚动高亮的 block 到视图中心
useEffect(() => {
  if (isSourcePanelOpen && highlightedBlockId) {
    const el = document.getElementById(highlightedBlockId);
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }
}, [isSourcePanelOpen, highlightedBlockId]);
```

### Mermaid 节点点击传递 blockId

为了在点击 Mermaid 节点时能够居中显示整个图表，需要将 blockId 传递到回调函数：

```typescript
// components/WikiBlock.tsx
interface WikiBlockRendererProps {
  onMermaidNodeClick?: (nodeId: string, metadata: MermaidMetadata, blockId: string) => void;
  // ...
}

// 在渲染 Mermaid 时包装回调以传递 block.id
case 'mermaid':
  const handleMermaidNodeClick = onMermaidNodeClick
    ? (nodeId: string, metadata?: MermaidMetadata) => onMermaidNodeClick(nodeId, metadata!, block.id)
    : undefined;
  return (
    <Mermaid
      chart={content}
      metadata={block.metadata}
      onNodeClick={handleMermaidNodeClick}
      highlightedNodeId={highlightedMermaidNodeId}
    />
  );
```

---

## 源代码面板优化

### 自动扫描目录

不再需要手动维护 `manifest.json` 文件，系统会自动扫描 `public/source-code` 目录下的所有文件。

#### Vite 插件实现

```typescript
// vite.config.ts
function sourceCodeScannerPlugin(): Plugin {
  return {
    name: 'source-code-scanner',
    configureServer(server) {
      server.middlewares.use('/api/source-code/files', (_req, res) => {
        const sourceCodeDir = path.join(__dirname, 'public', 'source-code');
        const files: string[] = [];

        function scanDir(dir: string, relativePath: string = '') {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              scanDir(path.join(dir, entry.name), relPath);
            } else if (entry.isFile() && entry.name !== 'manifest.json') {
              files.push(relPath);
            }
          }
        }

        scanDir(sourceCodeDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ files }));
      });
    }
  };
}
```

#### 前端调用

```typescript
// components/SourceCodePanel.tsx
useEffect(() => {
  if (!isOpen) return;
  fetch('/api/source-code/files')
    .then(res => res.json())
    .then(data => {
      setFileTree(buildFileTree(data.files || []));
    })
    .catch(() => setFileTree([]));
}, [isOpen]);
```

### 文件树左侧布局

文件树从顶部移到左侧，类似 VSCode 的经典布局：

```
┌─────────────────────┐
│      Header         │
├────────┬────────────┤
│ File   │            │
│ Tree   │  Code      │
│ (200px)│  Area      │
│        │            │
└────────┴────────────┘
```

```tsx
// components/SourceCodePanel.tsx
<div className="flex-1 flex overflow-hidden">
  {/* File Tree - Left Sidebar */}
  {fileTree.length > 0 && (
    <div
      className="border-r border-[#333] bg-[#252526]/40 overflow-y-auto custom-scrollbar flex-shrink-0 relative"
      style={{ width: treeWidth }}
    >
      <div className="py-1">
        {fileTree.map(node => renderTreeNode(node))}
      </div>
      {/* Tree resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/50 z-10"
        onMouseDown={() => { isDraggingTreeRef.current = true; }}
      />
    </div>
  )}

  {/* Code Area - Right Side */}
  <div className="flex-1 overflow-y-auto custom-scrollbar relative" ref={codeRef}>
    {/* 代码显示区域 */}
  </div>
</div>
```

### 可调整文件树宽度

文件树宽度可以通过拖拽右边缘调整：

```typescript
// components/SourceCodePanel.tsx
const [treeWidth, setTreeWidth] = useState<number>(200); // 初始宽度 200px
const isDraggingTreeRef = useRef(false);

// 拖拽处理器
useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingTreeRef.current) return;
    const panel = document.querySelector('.source-code-panel') as HTMLElement;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const newWidth = Math.max(150, Math.min(e.clientX - panelRect.left, panelWidth - 300));
    setTreeWidth(newWidth);
  };
  const handleMouseUp = () => { isDraggingTreeRef.current = false; };
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}, [panelWidth]);
```

**约束**：
- 最小宽度：150px
- 最大宽度：面板宽度 - 300px（确保代码区有足够空间）
- 初始宽度：200px

### 智能目录展开

只展开当前查看文件所在的目录路径，其他目录保持折叠：

```typescript
// components/SourceCodePanel.tsx
useEffect(() => {
  if (location) {
    setCurrentFile(location.file);
    setHighlightLine(location.line);
    setHighlightEndLine(location.endLine || null);

    // 只展开当前文件所在的目录路径
    const folders = new Set<string>();
    const parts = location.file.split('/');
    let path = '';
    parts.slice(0, -1).forEach((p: string) => {
      path = path ? `${path}/${p}` : p;
      folders.add(path);
    });
    setExpandedFolders(folders);
  }
}, [location]);
```

### 代码范围高亮

支持解析 "10-20" 格式的行号范围，实现多行高亮：

```typescript
// 解析行号范围
const lineRange = source.lines[0];
let line = 1;
let endLine: number | undefined;

if (lineRange) {
  const rangeMatch = lineRange.match(/^(\d+)-(\d+)$/);
  const singleMatch = lineRange.match(/^(\d+)$/);

  if (rangeMatch) {
    line = parseInt(rangeMatch[1], 10);
    endLine = parseInt(rangeMatch[2], 10);
  } else if (singleMatch) {
    line = parseInt(singleMatch[1], 10);
  }
}

const location: SourceLocation = {
  file: source.name,
  line: line,
  endLine: endLine
};
```

**应用位置**：
- `components/AnalysisView.tsx` - handleSourceClick
- `components/CodeNexusAnalysisView.tsx` - handleSourceClick
- `utils/wikiContentParser.ts` - Mermaid sourceMapping 解析

### Mermaid 节点智能交互

#### 类型感知的交互系统

Mermaid 图表支持多种类型（flowchart、classDiagram、sequenceDiagram、stateDiagram），每种类型的 DOM 结构和节点 ID 格式都不同。系统会根据图表类型自动选择合适的选择器和 ID 提取策略。

#### 图表类型检测

```typescript
// components/Mermaid.tsx
function detectChartType(chart: string): string {
  const trimmedChart = chart.trim().toLowerCase();

  // 注意：必须使用小写匹配，因为 chart 已经转为小写
  if (trimmedChart.startsWith('graph')) return 'graph';
  if (trimmedChart.startsWith('flowchart')) return 'flowchart';
  if (trimmedChart.startsWith('sequencediagram')) return 'sequenceDiagram';
  if (trimmedChart.startsWith('classdiagram')) return 'classDiagram';
  if (trimmedChart.startsWith('statediagram')) return 'stateDiagram';
  // ...
  return 'unknown';
}
```

**常见错误**：使用驼峰式关键字（如 `classDiagram`）匹配已转为小写的字符串，导致永远匹配失败。

#### 节点 ID 提取策略

不同图表类型使用不同的节点 ID 提取逻辑：

```typescript
// components/Mermaid.tsx
function extractNodeIdByChartType(element: Element, chartType: string): string | null {
  const domId = element.id;

  // Block 图表（flowchart/graph）
  if (chartType === 'graph' || chartType === 'flowchart') {
    // flowchart-NodeId-123 → NodeId
    const idMatch = domId.match(/^flowchart-(.+?)-\d+$/);
    if (idMatch) return idMatch[1];
  }

  // UML 类图（classDiagram）
  else if (chartType === 'classDiagram') {
    // classId-ClassName-0 → ClassName
    const classMatch = domId.match(/^classId-(.+?)(?:-\d+)?$/);
    if (classMatch) return classMatch[1];
  }

  // 时序图（sequenceDiagram）
  else if (chartType === 'sequenceDiagram') {
    // actor0 → 提取 text 内容作为 actor 名称
    if (domId && domId.startsWith('actor')) {
      const textElement = element.querySelector('text');
      if (textElement?.textContent) {
        return textElement.textContent.trim();
      }
      return domId;
    }
  }

  // 状态图（stateDiagram）
  else if (chartType === 'stateDiagram') {
    // state-StateName → StateName
    const stateMatch = domId.match(/^state-(.+)$/);
    if (stateMatch) return stateMatch[1];
  }

  // 通用 fallback
  return domId || element.textContent?.trim() || null;
}
```

#### 动态选择器策略

根据图表类型选择合适的 CSS 选择器：

```typescript
// components/Mermaid.tsx
const handleContextMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement;

  // 根据图表类型选择选择器
  let selector = '.node, .actor, .messageText, .task, .classSection, [id^="flowchart-"], g[id]';

  if (chartType === 'classDiagram') {
    selector = '.classGroup, .node, g[id^="classId-"]';
  } else if (chartType === 'sequenceDiagram') {
    selector = '.actor, .messageText, g[id^="actor"]';
  } else if (chartType === 'stateDiagram') {
    selector = '.node, .state, g[id^="state-"]';
  }

  const interactiveGroup = target.closest(selector);

  if (interactiveGroup) {
    // 使用类型感知的提取函数
    const foundId = extractNodeIdByChartType(interactiveGroup, chartType);

    // 检查节点是否在 sourceMapping 中
    const hasMapping = metadata?.sourceMapping?.[foundId];

    if (hasMapping) {
      e.preventDefault();
      setActiveNodeId(foundId);
      setMenuPosition({ x: e.clientX, y: e.clientY });
    }
  }
};
```

#### 选择器对比表

| 图表类型 | DOM ID 格式 | CSS 选择器 | ID 提取策略 |
|---------|------------|-----------|------------|
| flowchart/graph | `flowchart-NodeId-123` | `.node, [id^="flowchart-"]` | 正则提取中间的 NodeId |
| classDiagram | `classId-ClassName-0` | `.classGroup, .node, g[id^="classId-"]` | 提取类名，去除数字后缀 |
| sequenceDiagram | `actor0` | `.actor, .messageText, g[id^="actor"]` | 提取 text 元素的文本内容 |
| stateDiagram | `state-StateName` | `.node, .state, g[id^="state-"]` | 提取状态名称 |

**效果**：
- 有映射的节点：鼠标悬停显示 `context-menu` 光标，右键可打开菜单
- 无映射的节点：鼠标悬停显示 `default` 光标，右键无反应
- 支持 4 种核心图表类型的精确交互

---

## Mermaid 节点映射解析

### 概述

Mermaid 图表的节点可以关联到源代码位置。后端返回的数据结构包含 `mapping` 字段，将节点 ID 映射到 `source_id`。

### 后端数据结构

```typescript
// 后端返回的图表内容
interface ChartContent {
  mermaid: string;  // Mermaid 代码
  mapping: Record<string, string>;  // nodeId -> source_id
}

// 后端返回的源码信息
interface WikiSource {
  source_id: string;
  name: string;      // 文件路径
  lines: string[];   // 行范围，如 ["10-20", "30-40"]
}
```

### 解析逻辑

```typescript
// utils/wikiContentParser.ts
if ('mapping' in item.content && item.content.mapping) {
  const sourceMapping: Record<string, SourceLocation> = {};

  Object.entries(item.content.mapping as Record<string, string>).forEach(([nodeId, sourceRef]) => {
    // 使用 mapping 中的 sourceRef（source_id）查找对应的 source
    const source = sources.find(s => s.source_id === sourceRef);
    if (source) {
      const lineRange = source.lines[0] || '1';
      let line = 1;
      let endLine: number | undefined;

      // Handle formats like "10-20" or "10"
      const rangeMatch = lineRange.match(/^(\d+)-(\d+)$/);
      const singleMatch = lineRange.match(/^(\d+)$/);

      if (rangeMatch) {
        line = parseInt(rangeMatch[1], 10);
        endLine = parseInt(rangeMatch[2], 10);
      } else if (singleMatch) {
        line = parseInt(singleMatch[1], 10);
      }

      sourceMapping[nodeId] = {
        file: source.name,
        line: line,
        endLine: endLine
      };
    }
  });

  if (Object.keys(sourceMapping).length > 0) {
    metadata = { sourceMapping };
  }
}
```

### 常见错误

**错误：所有节点映射到同一个源码位置**

```typescript
// 错误写法 - 忽略了 mapping 中的 sourceRef
Object.entries(item.content.mapping).forEach(([nodeId, sourceRef]) => {
  const source = sources.find(s => s.source_id === item.source_id[0]);  // 错误！
  // ...
});

// 正确写法 - 使用 mapping 中的 sourceRef
Object.entries(item.content.mapping).forEach(([nodeId, sourceRef]) => {
  const source = sources.find(s => s.source_id === sourceRef);  // 正确
  // ...
});
```

---

## 导航栏大纲视图

### 层级标题样式

大纲视图中的标题根据层级使用不同的字体大小和样式：

```typescript
// components/WikiPageNavigator.tsx
const levelStyles: Record<number, string> = {
  1: 'text-base font-semibold text-gray-900',
  2: 'text-sm font-medium text-gray-800',
  3: 'text-sm text-gray-700',
  4: 'text-xs text-gray-600',
  5: 'text-xs text-gray-500',
  6: 'text-xs text-gray-400',
};

// 渲染时应用对应样式
<div
  className={`px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100 ${levelStyles[heading.level]}`}
  style={{ paddingLeft: `${(heading.level - 1) * 12 + 12}px` }}
>
  {heading.title}
</div>
```

---

## 故障排查

### 问题 1: CodeNexus 无响应

```bash
# 检查后端服务
curl http://localhost:11219/health

# 检查环境变量
echo $VITE_CODENEXUS_API_URL
```

### 问题 2: 子节点无法选中

确保递归渲染时正确传递 `selectedBlockIds`：

```tsx
<WikiBlockRenderer
  block={child}
  isSelected={selectedBlockIds?.has(child.id)}  // 检查子节点自身
  selectedBlockIds={selectedBlockIds}            // 传递给下一层
/>
```

### 问题 3: 块操作不生效

使用树形操作函数而非数组方法：

```typescript
// 错误
const index = blocks.findIndex(b => b.id === id);
blocks.splice(index, 1);

// 正确
newBlocks = markBlockAsDeleted(blocks, id);
```

### 问题 4: CORS 错误

后端添加 CORS 配置：

```python
# FastAPI
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"])
```

### 问题 5: TypeScript 类型错误

确保 `tsconfig.json` 包含：
```json
{ "types": ["node", "vite/client"] }
```

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v2.0 | 2026-01-22 | 变更预览工作流重构：预览与应用分离、添加 `/api/apply_changes` 接口、`pendingPageDiff` 状态管理、Mermaid 删除状态视觉效果（X 线+标签）、前后端块插入逻辑统一（section→子节点，其他→兄弟节点）、后端函数重构（fetch_page/apply_changes 移至 server.py 作为真实实现） |
| v1.9 | 2026-01-14 | Wiki 生成历史管理：侧边栏入口、全局历史面板（z-index 60/70）、自动保存（最多 50 条）、快速恢复、时间格式化、修复仪表盘无法显示历史和层级冲突问题 |
| v1.8 | 2026-01-12 | Mermaid 交互优化：修复图表类型检测 bug（大小写匹配）、实现类型感知的节点 ID 提取策略、支持 flowchart/classDiagram/sequenceDiagram/stateDiagram 四种图表类型的精确交互 |
| v1.7 | 2026-01-06 | 源码面板优化：自动扫描目录（Vite 插件）、文件树左侧布局、可调整宽度（200px 初始）、智能目录展开、代码范围高亮（支持 "10-20" 格式）、Mermaid 节点智能交互过滤 |
| v1.6 | 2025-12-31 | Mermaid 节点映射 bug 修复（正确使用 mapping 中的 sourceRef）、查看图表源代码时自动居中显示图表、onMermaidNodeClick 回调增加 blockId 参数 |
| v1.5 | 2025-12-30 | 源代码联动高亮（WikiBlock、Mermaid 节点）、聊天面板随源代码面板自适应、导航栏大纲视图层级标题样式 |
| v1.4 | 2025-12-30 | 可调整布局：聊天面板拖拽调整、导航栏/源代码面板/问题选择器可调整大小、Wiki 内容自适应 |
| v1.3 | 2025-12-30 | 树形结构重构、递归渲染、折叠功能 |
| v1.2 | 2025-12-25 | 多页面导航系统 |
| v1.1 | 2025-12-25 | UI 交互优化、标题编号修复、章节折叠 |
| v1.0 | 2025-12-15 | CodeNexus Wiki 集成、双引擎系统 |

---

**维护者**:中国人民大学 信息学院 智能计算与数据系统研究所 孙煜
