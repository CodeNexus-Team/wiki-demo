# frontend/CLAUDE.md

> 前端层开发指南（被操作 `frontend/` 目录时自动加载）
> 全局上下文见 [../CLAUDE.md](../CLAUDE.md)

## 1. 技术栈速查

| 项 | 选择 |
|---|---|
| **框架** | React 19（函数组件 + hooks，**不用 class**） |
| **构建** | Vite + TypeScript |
| **样式** | Tailwind CSS（通过 importmap CDN 加载，非 JIT 编译） |
| **Markdown** | `react-markdown` + `remark-gfm` |
| **代码高亮** | `react-syntax-highlighter`（prism 风格） |
| **Mermaid** | `mermaid@11`（通过 importmap CDN） |
| **图标** | `lucide-react` |
| **依赖管理** | `importmap` from CDN（不是 npm bundle） — 见 `index.html` |

**关键事实**：`index.html` 里的 `<script type="importmap">` 把 React/Tailwind/lucide 等通过 CDN 加载,不是 Vite 打包。`node_modules` 主要用于 TypeScript 类型检查。

---

## 2. 目录结构

```
frontend/
├── App.tsx                     # 根入口，路由切换（Dashboard / WikiBrowser / AnalysisView）
├── index.tsx                   # ReactDOM 挂载
├── types.ts                    # 所有共享类型定义
├── components/
│   ├── AnalysisView.tsx        # ⭐ 主视图：Wiki 浏览 + 对话 + 编辑
│   ├── WikiBrowser.tsx         # Wiki 生成入口
│   ├── Dashboard.tsx           # 仪表盘（数据可视化）
│   ├── SourceCodePanel.tsx     # 源码侧边面板
│   ├── WikiBlock.tsx           # 单个 block 渲染（递归）
│   ├── WikiPageNavigator.tsx   # 左侧页面树导航
│   ├── PageTabBar.tsx          # 顶部 Tab 栏
│   ├── QuestionSelector.tsx    # 工作流问题选择器
│   ├── Mermaid.tsx             # Mermaid 渲染 + 暗色适配
│   ├── Sidebar.tsx             # 左侧项目级导航
│   ├── WikiHistoryPanel.tsx    # 历史记录面板
│   ├── wiki/
│   │   └── WikiContent.tsx     # ⭐ Wiki 内容主容器 + 搜索
│   ├── chat/
│   │   ├── ChatPanel.tsx
│   │   ├── ChatMessage.tsx     # ⭐ 聊天气泡 + 澄清选项 UI
│   │   ├── DiffConfirmBar.tsx
│   │   ├── SelectionBar.tsx
│   │   └── ThinkingChain.tsx
│   ├── mermaid/
│   │   ├── MermaidModal.tsx
│   │   └── MermaidEditModal.tsx
│   └── mermaid-editor/
│       ├── EditorPanel.tsx
│       ├── PreviewPanel.tsx
│       └── ToolBar.tsx         # 按图表类型显隐控件
├── hooks/
│   ├── useWikiPages.ts         # ⭐ 页面切换 + 防抖 + stale 响应丢弃
│   ├── useBlockSelection.ts    # 选中状态管理
│   ├── useSourcePanel.ts       # 源码面板开关 + 高亮
│   ├── useDiffMode.ts          # Diff 预览 + 应用变更
│   ├── usePageTabs.ts          # Tab 栏状态
│   ├── useChatHistory.ts       # 对话历史
│   ├── useMermaidEditor.ts     # Mermaid 编辑器状态（chartType 感知）
│   ├── useMermaidModal.ts
│   ├── useResizablePanel.ts    # 可拖拽面板宽度
│   ├── useSvgDrag.ts
│   └── useWikiTheme.ts         # 主题（亮暗 + 配色方案）
├── services/
│   ├── codenexusWikiService.ts # ⭐ 后端 API 调用封装 + SSE 解析
│   ├── geminiService.ts        # Gemini API（降级可用）
│   └── wikiPageCache.ts        # 页面缓存
├── config/
│   ├── wikiThemes.ts           # 主题配色表
│   └── suggestions.ts
├── utils/
│   ├── wikiContentParser.ts    # 后端 JSON → WikiBlock[]
│   ├── blockOperations.ts      # 折叠/展开/标记等
│   └── treeBuilder.ts
└── mock/
    └── sourceCode.ts           # 源码 fallback
```

---

## 3. 关键组件职责

### 3.1 AnalysisView（最复杂，~1000 行）

**职责**：整个 Wiki 查看 + 交互界面的容器。

**状态分类**：
- **Wiki 状态**：`blocks`、`wikiPages`、`currentPagePath`（来自 `useWikiPages`）
- **选择状态**：`selectedBlockIds`（来自 `useBlockSelection`）
- **对话状态**：`chatHistory`、`isChatOpen`、`isChatExpanded`（来自 `useChatHistory`）
- **Diff 状态**：`isDiffMode`、`isDiffModeRef`（来自 `useDiffMode`）
- **Session 状态**：`agentSessionIdRef`（手动管理）
- **Tab 状态**：`tabs`、`activeTabId`（来自 `usePageTabs`）
- **源码面板状态**：`isSourcePanelOpen`、`sourcePanelWidth`（来自 `useSourcePanel`）
- **澄清状态**：`clarificationResolverRef`（Promise resolver，等用户选择）

**核心函数**：
- `handleAnalyze` —— 提交提问/修改的主入口，含所有路由逻辑（200+ 行）
- `handlePageSwitch` —— 切换页面，处理 tab 复用和概览页特殊路径
- `auto-query effect` —— 从 `pendingAutoQueryRef` 取待执行的 prompt 自动触发

**需要修改时**：先定位到要改的状态属于哪个分类，再看对应 hook。

### 3.2 WikiContent（Wiki 主容器）

**职责**：渲染 block 树 + 左侧导航 + 搜索栏。

**关键内容**：
- `MutationObserver` 监听 `.wiki-root` DOM 变化，重建 CSS Custom Highlight API 的 Range（搜索高亮）
- `React.memo` 包装避免 parent 重渲染导致整棵树重建
- 左侧 `WikiPageNavigator` 可隐藏/展开，宽度可拖拽

**动他之前必读**：搜索高亮的 `MutationObserver` 逻辑很 fragile，改动 DOM 结构或 parent overflow 会破坏它。

### 3.3 WikiBlockRenderer（递归渲染）

**职责**：把 WikiBlock 递归渲染成 DOM。

**重要特性**：
- 使用**自定义 memo 比较器**，只比较关键 props（`block.id`、`block.content`、`isSelected` 等）
- 传入的 props 必须**引用稳定**，inline object/array 会破坏 memo
- 支持 section / text / heading / list / table / mermaid / code 等多种 block 类型

### 3.4 ChatMessage（聊天气泡）

**职责**：渲染对话消息 + Markdown + 澄清选项 UI。

**关键特性**：
- 用户消息 → 纯文本 `whitespace-pre-wrap`
- 助手消息 → ReactMarkdown（支持代码高亮、表格、引用、暗色适配）
- 澄清选项支持单选/多选，多选带复选框 + "确认选择" 按钮
- 「其他」选项点击后展开自由输入框，与勾选项共存

### 3.5 Mermaid（图表渲染 + 暗色适配）

**两阶段渲染**：
1. `mermaid.render()` 生成 SVG 字符串
2. `innerHTML = svg` 注入 DOM 后做**后处理**：
   - 白色填充 → 暗灰（仅暗色模式）
   - 深色文字 → 浅色
   - 右键菜单 + 节点高亮支持

**节点 ID 提取**：
- 通过 `extractNodeIdByChartType` 函数按图表类型（flowchart/classDiagram/sequenceDiagram/stateDiagram）使用不同的 ID 规则
- 高亮 effect 必须用这个函数，不要直接硬编码 `flowchart-*` 正则

---

## 4. Hooks 使用约定

### 4.1 useWikiPages

**职责**：页面切换 + 防抖 + stale response 丢弃。

**关键 refs**：
- `latestRequestedPageRef` —— 最新请求的页面 path
- `loadingPageRef` —— 正在加载的页面 path

**为什么需要**：连续快速点击不同页面时，慢请求的响应可能在快请求之后返回（race condition），需要丢弃 stale 响应。

**不要改**：这两个 ref 的校验逻辑。

### 4.2 useBlockSelection

**职责**：维护 `selectedBlockIds: Set<string>`。

**为什么用 Set**：O(1) 查询 + 避免重复。不要改成数组。

### 4.3 useDiffMode

**职责**：进入/退出 diff 模式，应用/丢弃变更。

**入口方法**：
- `enterDiffMode(newBlocks, response, originalBlocks)` —— 进入
- `applyChanges()` —— 写入后端 + 退出
- `discardChanges()` —— 还原 + 退出

**关键点**：diff 模式下 `isDiffMode = true`，`useWikiPages.onPageLoaded` 会检查这个 ref 并跳过覆盖 blocks，避免后台 loading 竞态覆盖 diff 状态。

### 4.4 useSourcePanel

**职责**：打开/关闭源码面板 + 高亮行号。

**调用时机**：
- `handleSourceClick(blockId, sourceId, sources)` — 点击 block 的"查看源代码"
- `handleMermaidNodeClick(nodeId, metadata, blockId)` — 点击 mermaid 节点

---

## 5. 状态管理模式

### 5.1 不用 Redux/Zustand

所有状态通过 **hooks 上提 + prop drilling**。页面切换等复杂状态用 **ref**。

### 5.2 Ref 用法

大量使用 `useRef` 而不是 state 的场景：
- **避免闭包陷阱**：`currentPagePathRef`、`blocksRef` 用于 async await 后读取最新值
- **不触发重渲染**：`agentSessionIdRef`、`pendingAutoQueryRef`
- **防抖/去重**：`isDiffModeRef`（避免 stale state 干扰）

### 5.3 Promise resolver 存 ref

澄清机制用 `clarificationResolverRef` 存 `(answer: string) => void`：
- `onClarify` 回调返回一个 Promise，resolver 写入 ref
- 用户点击选项时 → `clarificationResolverRef.current(opt)` → Promise resolve

---

## 6. API 调用模式

所有后端调用都在 `codenexusWikiService.ts`。**不要绕过**它直接 fetch。

### 6.1 SSE 解析模板

```typescript
const response = await fetch(url, { method: 'POST', body });
const reader = response.body?.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';   // 最后一行可能不完整，留到下次

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6));
    // 处理 event.type: progress / clarification / result / error
  }
}
```

**注意**：`buffer = lines.pop()` 这行不能省，否则遇到分片数据会解析失败。

### 6.2 澄清事件处理

`detailedQuery` 和 `qaQuery` 都支持 `onClarify` 回调：
```typescript
onClarify: (question, options, multiSelect) => Promise<string>
```

收到 `clarification` SSE 事件 → 调用 `onClarify` → 等待用户选择 → `POST /api/clarification_answer` → 后端继续。

---

## 7. 暗色模式约定

### 7.1 prop 传递

所有视觉组件接受 `isDarkMode?: boolean`，从 `useWikiTheme()` 的 context 或 AnalysisView 层层下传。

### 7.2 样式写法

```tsx
className={`
  base-classes
  ${isDarkMode
    ? 'bg-[#0d1117] text-[#e6edf3] border-[#30363d]'
    : 'bg-white text-[#1d1d1f] border-gray-200'
  }
`}
```

**配色基准**：
- 背景：`#0d1117`（暗）/ `#ffffff` / `#F5F5F7`（亮）
- 文字：`#e6edf3`（暗）/ `#1d1d1f`（亮）
- 边框：`#30363d`（暗）/ `#e5e5ea`（亮）
- 主色：`#58a6ff`（暗）/ `#0071E3`（亮）

### 7.3 Mermaid 和 SyntaxHighlighter

- Mermaid：通过 `initMermaid(isDark)` 重新初始化 + SVG 后处理
- SyntaxHighlighter：`style={isDarkMode ? vscDarkPlus : ghcolors}`

---

## 8. 反模式（前端专属）

### ❌ 不要给 WikiContent 的父容器加 `overflow-auto`
会截断 `.wiki-root` 可见区域，破坏搜索高亮 `MutationObserver` 的观察范围。

### ❌ 不要给 Main Content Area 加 `flex flex-col`
当前是 `flex-1 overflow-hidden w-full pb-[200px]`，子元素用 `blocks.length > 0 && ...` 条件渲染卡片容器。改成 flex-col 会破坏 `pb-200` 给底部对话框预留空间的布局。

### ❌ 不要用 inline object/array 作为 memo 组件的 prop
```tsx
// ❌ 破坏 memo
<WikiBlockRenderer block={block} sources={[...something]} />

// ✅ 引用稳定
const sources = useMemo(() => [...], [dep]);
<WikiBlockRenderer block={block} sources={sources} />
```

### ❌ 不要在 early return 后 useCallback/useMemo
```tsx
// ❌ hooks 顺序不一致
if (!data) return <Loading />;
const fn = useCallback(() => ..., [data]);

// ✅
const fn = useCallback(() => ..., [data]);
if (!data) return <Loading />;
```

### ❌ 不要直接 setBlocks 切换页面
必须走 `useWikiPages.handlePageSwitch` 走防抖和 stale response 丢弃。直接 `setBlocks` 会破坏 `loadingPageRef` 的状态。

### ❌ 不要在 `handleAnalyze` await 之后读 state
async 函数 await 后的 `blocks` / `currentPagePath` 都是闭包捕获的旧值，要用 `blocksRef.current` / `currentPagePathRef.current`。

### ❌ 不要手动 fetch Claude API
所有后端通信走 `codenexusWikiService.ts`。需要新的端点时在 service 里加方法。

### ❌ 不要修改 `index.html` 的 importmap 除非新增依赖
importmap 决定 CDN 加载的包版本，改动风险很高。新依赖必须同时更新 `package.json` 和 importmap。

### ❌ 不要在 WikiBlockRenderer 里直接操作 DOM
DOM 操作（如搜索高亮、Mermaid 节点高亮）集中在父组件 effect 里。子组件保持纯函数渲染。

---

## 9. 常见任务速查

### 9.1 加一个新的 chat 消息类型

1. `types.ts` 扩展 `ChatMessage` 接口
2. `useChatHistory.ts` 添加对应的 `addXxxMessage` 方法
3. `ChatMessage.tsx` 根据新字段渲染
4. `AnalysisView.handleAnalyze` 在合适位置调用

### 9.2 加一个新的后端 API

1. `codenexusWikiService.ts` 加方法
2. `types.ts` 加 request/response 类型
3. 组件里 `import` 并调用

### 9.3 加一个新的澄清选项类型（比如文件选择器）

**不要扩展 ask_user 工具**，当前只支持 options 字符串列表。要做富类型澄清应该加一个新的 MCP 工具（比如 `ask_user_file_picker`），前端对应新的 SSE event type 和 UI 组件。

### 9.4 调整 Wiki 暗色模式配色

- Wiki 内容本身：`config/wikiThemes.ts` 改 theme 定义
- 聊天气泡 / 澄清选项：`ChatMessage.tsx` 里硬编码
- Mermaid：`Mermaid.tsx:MERMAID_DARK_THEME` 和 SVG 后处理段
- 源码面板：`SourceCodePanel.tsx` 里硬编码

---

## 10. 调试技巧

### 10.1 查看 SSE 事件
Chrome DevTools → Network → 找 `detailed_query` 请求 → EventStream 标签页。

### 10.2 搜索高亮失效时
```js
// 浏览器 Console
CSS.highlights.get('wiki-search')   // 应该返回 Highlight 对象
document.querySelectorAll('.wiki-root mark')  // 不应该有任何结果（用的是 CSS API，不是 mark 标签）
```

### 10.3 诊断 memo 是否失效
在 `WikiBlockRenderer` 的 memo 比较器里加 `console.log` 打印重新渲染次数。如果每次 parent 重渲染都触发，说明某个 prop 引用不稳定。

### 10.4 澄清机制不触发
检查顺序：
1. 浏览器 Network → EventStream → 是否有 `clarification` 事件
2. 有事件但 UI 不渲染 → 看 `ChatMessage` 的 `clarificationOptions` prop 是否收到
3. 事件都没收到 → 看后端 `ask_user_mcp.log` 是否有工具调用记录

---

## 11. 不要碰的东西

- **`CodeNexusAnalysisView.tsx`** — 旧版本，已被 AnalysisView 替代，TS 类型错误是已知的
- **`geminiService.ts` 的兼容层** — 已做优雅降级，没配 GEMINI_API_KEY 也不会崩
- **`mock/sourceCode.ts`** — 源码 fallback，实际用户会配 `public/source-code/` 目录
- **`index.html` 的 Tailwind CDN 配置** — 通过 CDN 加载的 Tailwind 不支持 JIT，要谨慎使用动态类名
- **`react-d3-tree` 依赖** — 曾用于已删除的 WikiOverview，可清理但暂不处理
