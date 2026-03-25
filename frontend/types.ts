import React from 'react';

export enum AnalysisType {
  DASHBOARD = 'DASHBOARD',
  WIKI_BROWSER = 'WIKI_BROWSER',
  ARCHITECTURE = 'ARCHITECTURE',
  API_ANALYSIS = 'API_ANALYSIS',
  BUSINESS_FLOW = 'BUSINESS_FLOW',
  CONTROL_FLOW = 'CONTROL_FLOW',
  DATABASE = 'DATABASE'
}

export interface WikiTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WikiTreeNode[];
}

export interface NavItem {
  id: AnalysisType;
  label: string;
  icon: React.ReactNode;
  description: string;
}

export interface ChartData {
  name: string;
  value: number;
  color?: string;
}

// --- Source Code Mapping Types ---
export interface SourceLocation {
  file: string; // e.g., "src/main/java/com/cloudmart/order/service/OrderService.java"
  line: number;
  endLine?: number; // 结束行号，用于标注代码块范围
  code?: string; // Optional snippet
}

export interface MermaidMetadata {
  sourceMapping: Record<string, SourceLocation>; // nodeId -> SourceLocation
}

// --- Wiki Object System Types ---

// Changed 'list-item' to 'list' to represent an aggregated list block
export type BlockType = 'heading' | 'paragraph' | 'list' | 'code' | 'mermaid' | 'table';

export interface WikiBlock {
  id: string;
  type: BlockType;
  content: string;
  level?: number; // For headings (1-6)

  // Tree Structure Fields
  children?: WikiBlock[];    // Child nodes (primarily for heading types)
  parentId?: string;         // Parent node ID for quick lookup
  depth?: number;            // Depth in tree (0 for root, used for indentation)
  isCollapsed?: boolean;     // Collapsed state (only effective for headings with children)

  // Metadata for Mermaid Mapping
  metadata?: MermaidMetadata;

  // Source code references (separate from content for code/mermaid blocks)
  sourceInfo?: string;

  // Source IDs and full source data for interaction
  sourceIds?: string[];
  sources?: WikiSource[];

  // Diff System Fields
  status?: 'original' | 'modified' | 'inserted' | 'deleted';
  originalContent?: string; // Store previous content for modified blocks

  // Neo4j data source IDs
  neo4jIds?: Neo4jIdMapping;
  // Neo4j node names (resolved from neo4jIds)
  neo4jSource?: Neo4jIdMapping;
}

export interface BlockOperation {
  action: 'UPDATE' | 'INSERT_AFTER' | 'DELETE';
  targetId: string; // The ID of the block to act upon
  content?: string; // New content for UPDATE or INSERT
  type?: BlockType; // Type for INSERT
  level?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // Summary of AI process/reasoning
  steps?: string[]; // Streaming thought steps (e.g. "Parsing...", "Generating...")
  references?: WikiBlock[]; // Context blocks referenced by the user
  timestamp: number;
}

// --- CodeNexus Wiki Service Types ---

export interface ExpandedQuestion {
  id: string;
  query: string;
  search_keywords_cn: string[];
  search_keywords_en: string[];
  targets: string[];
}

// 统一查询入口
export interface UserQueryRequest {
  user_query: string;
  selected_questions?: ExpandedQuestion[];  // 可选，有则执行工作流，无则扩展查询
}

// 扩展查询响应
export interface ExpandQueryResponse {
  questions: ExpandedQuestion[];
}

// 工作流执行响应
export interface ExecuteWorkflowResponse {
  wiki_root: string;
  wiki_pages: string[];
}

// Neo4j ID 映射类型 - 键为章节号或节点ID，值为单个ID或ID数组
export type Neo4jIdMapping = Record<string, string | string[]>;

// Wiki 页面内容块
export interface WikiPageContent {
  type: string;
  id: string;
  title?: string;
  content?: WikiPageContent[] | { markdown: string; mermaid?: string; mapping?: Record<string, string> };
  source_id?: string[];
  neo4j_id?: Neo4jIdMapping;
  neo4j_source?: Neo4jIdMapping;
}

// Wiki 源码引用
export interface WikiSource {
  source_id: string;
  name: string;
  lines: string[];
}

// Wiki 页面
export interface WikiPage {
  content: WikiPageContent[];
  source: WikiSource[];
}

// 获取页面
export interface FetchPageRequest {
  page_path: string;
}

export interface FetchPageResponse extends WikiPage {}

// 详细查询（块级细化）
export interface DetailedQueryRequest {
  page_path: string;
  block_ids: string[];
  user_query: string;
}

// 修改当前页面的响应
export interface ModifyPageResponse {
  insert_blocks: Array<{
    after_block: string;
    block: WikiPageContent;
  }>;
  delete_blocks: string[];
  replace_blocks?: Array<{
    target: string;
    new_content: { markdown: string; mermaid?: string };
    source_ids: string[];
  }>;
  insert_sources: WikiSource[];
  delete_sources: string[];
}

// 新增页面的响应
export interface NewPageResponse {
  new_page_path: string;
  new_page: WikiPage;
}

// Wiki 生成历史记录
export interface WikiHistoryRecord {
  id: string;
  timestamp: number;
  userQuery: string;
  modelId: string;
  pagePath?: string;
  wikiPages?: string[];
  blocksCount?: number; // 用于显示的块数量
  // blocks 字段已废弃，改为从缓存中获取页面数据
  blocks?: WikiBlock[];
}

// --- Page Tab Types (VSCode-style tabs) ---

export interface PageTab {
  id: string;                     // 唯一标识（使用 pagePath）
  pagePath: string;               // Wiki 页面路径
  title: string;                  // 显示标题（从 pagePath 提取文件名）
}

export interface PageTabState {
  blocks: WikiBlock[];            // 页面内容
  scrollPosition: number;         // 滚动位置
  selectedBlockIds: Set<string>;  // 选中的块
}