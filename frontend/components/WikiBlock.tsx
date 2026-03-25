import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from './Mermaid';
import { MermaidEditModal } from './mermaid/MermaidEditModal';
import { WikiBlock, MermaidMetadata, WikiSource, Neo4jIdMapping } from '../types';
import { Plus, Check, GitCommitHorizontal, Trash2, FileDiff, Code, ChevronRight, ChevronDown, MoreHorizontal, Database, Edit3 } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { ghcolors, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { WikiTheme, appleTheme } from '../config/wikiThemes';

interface WikiBlockRendererProps {
  block: WikiBlock;
  isSelected: boolean;
  onToggleSelect: (block: WikiBlock) => void;
  // New prop for interaction
  onMermaidNodeClick?: (nodeId: string, metadata: MermaidMetadata, blockId: string) => void;
  // New prop for source code interaction
  onSourceClick?: (blockId: string, sourceId: string, sources: WikiSource[]) => void;
  // Tree structure props
  onToggleCollapse?: (blockId: string) => void;
  // For checking if child blocks are selected
  selectedBlockIds?: Set<string>;
  // Highlight block when source panel is open
  highlightedBlockId?: string | null;
  // Highlight mermaid node
  highlightedMermaidNodeId?: string | null;
  // Mermaid double click
  onMermaidDoubleClick?: (chart: string, metadata?: MermaidMetadata) => void;
  // Mermaid edit callback
  onMermaidEdit?: (blockId: string, newChart: string) => void;
  // Theme
  theme?: WikiTheme;
  // Dark mode
  isDarkMode?: boolean;
  // Wiki page navigation
  wikiPages?: string[];
  onPageNavigate?: (pagePath: string) => void;
}


/**
 * 预处理 Markdown：冒号结尾的列表项后，将同级或更浅的后续行重新缩进为子内容
 * 例如：
 *   - 具体流程包括：          ←  缩进=2, marker 宽度=2 ("- ")
 *   1. 注册接口...             ←  缩进=2, 应该变成 4+2=6
 *   整个控制器通过注解...       ←  同理
 */
const preprocessColonIndent = (content: string): string => {
  const lines = content.split('\n');
  const result: string[] = [];
  let adjusting = false;
  let targetIndent = 0; // 后续行应有的缩进

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // 空行：保持 adjusting 状态，原样输出
    if (trimmed === '') {
      result.push(line);
      continue;
    }

    const currentIndent = (line.match(/^(\s*)/) ?? ['', ''])[1].length;

    // 检测列表项以中/英文冒号结尾
    const colonListMatch = trimmed.match(/^(\s*)-\s+.*[：:]$/);
    if (colonListMatch) {
      adjusting = true;
      // 子内容缩进 = 当前 "- " 的内容起始位置 + 2
      targetIndent = colonListMatch[1].length + 4;
      result.push(line);
      continue;
    }

    if (adjusting) {
      // 遇到新的列表标记（- **xxx**）或标题，停止调整
      if (/^\s*-\s+\*\*/.test(trimmed) || /^\s*#{1,6}\s/.test(trimmed)) {
        adjusting = false;
        result.push(line);
        continue;
      }

      // 当前行缩进 < 目标缩进，需要补齐
      if (currentIndent < targetIndent) {
        result.push(' '.repeat(targetIndent) + trimmed.trimStart());
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
};

// 清理标题中的 Markdown 标记（如 ###），保留实际标题内容
const cleanHeadingContent = (content: string): string => {
  // 移除开头的 Markdown 标题标记 (###, ##, # 等)
  return content.replace(/^#{1,6}\s+/, '').trim();
};

// 检查标题是否匹配某个 wiki 页面（通过页面名称匹配）
const findMatchingPage = (headingContent: string, wikiPages: string[]): string | null => {
  // 1. 移除 Markdown 标题标记 (###)
  // 2. 移除章节编号 (如 "1.2 ", "1.2.3 ", "一、" 等)
  const cleanedTitle = headingContent
    .replace(/^#{1,6}\s+/, '')  // 移除 Markdown 标题标记
    .replace(/^[\d.]+\s+/, '')  // 移除数字编号 (1.2 )
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, '')  // 移除中文编号 (一、)
    .trim()
    .toLowerCase();

  for (const pagePath of wikiPages) {
    // 从路径中提取页面名称，去掉 .json 扩展名
    const pageName = pagePath.split('/').pop()?.replace('.json', '').toLowerCase() || '';
    if (pageName === cleanedTitle) {
      return pagePath;
    }
  }
  return null;
};

const WikiBlockRenderer: React.FC<WikiBlockRendererProps> = ({
  block,
  isSelected,
  onToggleSelect,
  onMermaidNodeClick,
  onSourceClick,
  onToggleCollapse,
  selectedBlockIds,
  highlightedBlockId,
  highlightedMermaidNodeId,
  onMermaidDoubleClick,
  onMermaidEdit,
  theme = appleTheme,
  isDarkMode = false,
  wikiPages = [],
  onPageNavigate
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [localHighlightedNodeId, setLocalHighlightedNodeId] = useState<string | null>(null);
  const [showMermaidEditor, setShowMermaidEditor] = useState(false);
  const [localMermaidContent, setLocalMermaidContent] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 当 block.content 变化时，重置本地内容
  useEffect(() => {
    setLocalMermaidContent(null);
  }, [block.content]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const hasSources = block.sources && block.sources.length > 0;

  // 稳定的 mermaid 回调，避免每次渲染创建新函数
  const handleMermaidNodeClick = useCallback(
    (nodeId: string, metadata?: MermaidMetadata) => {
      onMermaidNodeClick?.(nodeId, metadata!, block.id);
    },
    [onMermaidNodeClick, block.id]
  );

  const handleMermaidApply = useCallback(
    (newChart: string) => {
      setLocalMermaidContent(newChart);
      onMermaidEdit?.(block.id, newChart);
    },
    [onMermaidEdit, block.id]
  );

  const handleOpenMermaidEditor = useCallback(() => setShowMermaidEditor(true), []);
  const handleCloseMermaidEditor = useCallback(() => setShowMermaidEditor(false), []);

  // Check if block has children
  const hasChildren = block.children && block.children.length > 0;
  const isCollapsed = block.isCollapsed || false;
  const isHighlighted = highlightedBlockId === block.id;

  // --- Diff Styles ---
  const getDiffStyles = () => {
    if (isHighlighted) {
      return isDarkMode
        ? 'bg-orange-900/30 border-orange-600 ring-2 ring-orange-500/50 shadow-md'
        : 'bg-orange-50 border-orange-300 ring-2 ring-orange-200 shadow-md';
    }
    switch (block.status) {
      case 'inserted':
        return isDarkMode
          ? 'bg-emerald-900/30 border-emerald-700/60 hover:border-emerald-600 hover:shadow-emerald-900/50'
          : 'bg-emerald-50/60 border-emerald-200/60 hover:border-emerald-300 hover:shadow-emerald-100/50';
      case 'deleted':
        return isDarkMode
          ? 'bg-red-900/30 border-red-700/50 opacity-60 hover:opacity-80 decoration-red-400'
          : 'bg-red-50/50 border-red-200/50 opacity-60 hover:opacity-80 decoration-red-400';
      case 'modified':
        return isDarkMode
          ? 'bg-[#0d2818] border-green-700/60 hover:border-green-600'
          : 'bg-green-50/60 border-green-200/60 hover:border-green-300';
      default:
        return isSelected
          ? isDarkMode
            ? 'bg-[#58a6ff]/10 border-[#58a6ff]/30'
            : 'bg-[#0071E3]/[0.03] border-blue-100'
          : isDarkMode
            ? 'border-transparent hover:bg-[#161b22] hover:shadow-[0_1px_6px_rgba(0,0,0,0.3)] hover:border-[#30363d]'
            : 'border-transparent hover:bg-white hover:shadow-[0_1px_6px_rgba(0,0,0,0.02)] hover:border-gray-200/50';
    }
  };

  const getDiffBadge = () => {
    if (!block.status || block.status === 'original') return null;

    const badgeConfig = {
      inserted: { color: 'text-emerald-600 bg-emerald-100', icon: <Plus size={10} />, text: '新增' },
      deleted: { color: 'text-red-600 bg-red-100', icon: <Trash2 size={10} />, text: '删除' },
      modified: { color: 'text-green-600 bg-green-100', icon: <FileDiff size={10} />, text: '修改' }
    };
    const config = badgeConfig[block.status];

    return (
      <div className={`absolute -left-2 top-0 -translate-y-1/2 z-20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm ${config.color}`}>
        {config.icon}
        {config.text}
      </div>
    );
  };

  // 渲染 Neo4j Source 小卡片（显示节点名称）
  const renderNeo4jIdCard = (neo4jIds: Neo4jIdMapping | undefined, neo4jSource: Neo4jIdMapping | undefined, isMermaid: boolean = false) => {
    // 优先使用 neo4jSource（节点名称），如果没有则不显示
    const displayData = neo4jSource && Object.keys(neo4jSource).length > 0 ? neo4jSource : null;
    if (!displayData) return null;

    // 构建名称到节点的反向映射（用于 mermaid 点击高亮）
    const nameToNodes: Record<string, string[]> = {};
    Object.entries(displayData).forEach(([nodeId, name]) => {
      const names = Array.isArray(name) ? name : [name];
      names.forEach(n => {
        if (!nameToNodes[n]) nameToNodes[n] = [];
        nameToNodes[n].push(nodeId);
      });
    });

    // 收集所有唯一的名称
    const allNames = new Set<string>();
    Object.values(displayData).forEach(value => {
      if (Array.isArray(value)) {
        value.forEach(name => allNames.add(name));
      } else if (value) {
        allNames.add(value);
      }
    });

    if (allNames.size === 0) return null;

    const nameArray = Array.from(allNames);

    // 检查某个名称是否处于激活状态（其关联的节点被高亮）
    const isNameActive = (name: string) => {
      if (!isMermaid || !localHighlightedNodeId) return false;
      return nameToNodes[name]?.includes(localHighlightedNodeId);
    };

    // 点击名称时高亮关联的第一个节点
    const handleNameClick = (name: string) => {
      if (!isMermaid) return;
      const nodes = nameToNodes[name];
      if (nodes && nodes.length > 0) {
        const firstNode = nodes[0];
        setLocalHighlightedNodeId(localHighlightedNodeId === firstNode ? null : firstNode);
      }
    };

    return (
      <div className={theme.neo4jCard.container}>
        <span className={theme.neo4jCard.label}>
          <Database size={12} className={theme.neo4jCard.labelIcon} />
          Neo4j Source
        </span>
        {nameArray.map(name => {
          const isActive = isNameActive(name);
          const relatedNodes = nameToNodes[name] || [];
          return (
            <span
              key={name}
              className={`${theme.neo4jCard.idTag} ${isMermaid ? 'cursor-pointer' : ''} ${isActive ? theme.neo4jCard.idTagActive : ''}`}
              title={isMermaid ? `点击高亮节点: ${relatedNodes.join(', ')}` : `Neo4j Node: ${name}`}
              onClick={() => handleNameClick(name)}
            >
              <span className={isActive ? theme.neo4jCard.activeIdText : ''}>{name}</span>
            </span>
          );
        })}
      </div>
    );
  };

  const renderContent = (content: string) => {
    switch (block.type) {
      case 'mermaid':
        // 合并外部高亮和本地高亮状态
        const effectiveHighlightedNodeId = localHighlightedNodeId || highlightedMermaidNodeId;
        // 使用本地内容或原始内容
        const displayContent = localMermaidContent ?? content;
        return (
          <>
            <div className={`${theme.mermaid} relative group/mermaid`}>
              {/* 编辑按钮 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenMermaidEditor();
                }}
                className={`
                  absolute top-3 right-3 z-10 p-2 rounded-lg transition-all duration-200
                  opacity-0 group-hover/mermaid:opacity-100
                  ${isDarkMode
                    ? 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white'
                    : 'bg-black/5 hover:bg-black/10 text-gray-500 hover:text-gray-700'
                  }
                `}
                title="编辑图表"
              >
                <Edit3 size={16} />
              </button>
              <Mermaid
                  chart={displayContent}
                  metadata={block.metadata}
                  neo4jIds={block.neo4jIds}
                  neo4jSource={block.neo4jSource}
                  onNodeClick={onMermaidNodeClick ? handleMermaidNodeClick : undefined}
                  highlightedNodeId={effectiveHighlightedNodeId}
                  onDoubleClick={handleOpenMermaidEditor}
                  status={block.status}
              />
            </div>
            {/* Mermaid 编辑模态框 */}
            <MermaidEditModal
              isOpen={showMermaidEditor}
              initialChart={displayContent}
              metadata={block.metadata}
              onClose={handleCloseMermaidEditor}
              onApply={handleMermaidApply}
              onSave={handleMermaidApply}
            />
          </>
        );

      case 'code':
        const lines = content.split('\n');
        let language = 'text';
        let codeToDisplay = content;

        if (lines[0].trim().startsWith('```')) {
          language = lines[0].replace('```', '').trim() || 'text';
          codeToDisplay = content.replace(/^```.*\n/, '').replace(/```$/, '');
        }

        const isDarkCode = theme.id === 'technical' || theme.id === 'apple';

        return (
          <div className={`relative group ${theme.codeBlock}`}>
            <div className={theme.codeHeader}>
              {theme.codeHeaderDots ? (
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]"></div>
                  <div className="w-3 h-3 rounded-full bg-[#28c840]"></div>
                </div>
              ) : (
                <span></span>
              )}
              <span className={`text-xs font-mono uppercase ${isDarkCode ? 'text-[#86868b]' : ''}`}>{language}</span>
            </div>
            <SyntaxHighlighter
              language={language}
              style={isDarkCode ? vscDarkPlus : ghcolors}
              customStyle={{
                margin: 0,
                padding: '1.5rem',
                backgroundColor: theme.id === 'apple' ? '#1d1d1f' : (isDarkCode ? '#0d1117' : '#ffffff'),
                fontSize: '14px',
                lineHeight: '1.7',
                fontFamily: 'SF Mono, Menlo, Monaco, Courier New, monospace',
              }}
              wrapLongLines={true}
            >
              {codeToDisplay}
            </SyntaxHighlighter>
          </div>
        );

      case 'heading':
        const level = block.level || 2;
        const Tag = `h${level}` as React.ElementType;
        const cleanedContent = cleanHeadingContent(content);

        const levelKey = `h${level}` as keyof typeof theme.heading;
        const headingStyle = theme.heading[levelKey] || theme.heading.h2;
        const containerStyle = theme.headingContainer[levelKey] || theme.headingContainer.h2;

        // H3 的小圆点装饰（仅当主题配置了时显示）
        const renderH3Dot = level === 3 && theme.h3Dot && (
          <span className={`${theme.h3Dot} flex-shrink-0`} />
        );

        // 检查是否有同名的 wiki 页面可跳转
        const matchingPagePath = findMatchingPage(content, wikiPages);
        const isNavigable = !!matchingPagePath && !!onPageNavigate;

        const handleHeadingClick = () => {
          if (isNavigable && matchingPagePath) {
            onPageNavigate!(matchingPagePath);
          }
        };

        return (
          <div className={`relative ${containerStyle}`}>
            {/* Collapse button for headings with children */}
            {hasChildren && onToggleCollapse && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(block.id);
                }}
                className={`
                  absolute -left-7 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition-all duration-300
                  ${isDarkMode
                    ? 'hover:bg-[#30363d] text-[#7d8590] hover:text-[#e6edf3]'
                    : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'
                  }
                  ${isHovered ? 'opacity-100' : 'opacity-0'}
                `}
                title={isCollapsed ? "展开" : "折叠"}
              >
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
            {renderH3Dot}
            {isNavigable ? (
              <Tag
                className={`${headingStyle} cursor-pointer hover:text-[#0071E3] transition-colors group/heading`}
                onClick={handleHeadingClick}
                title={`跳转到: ${matchingPagePath?.split('/').pop()?.replace('.json', '')}`}
              >
                {cleanedContent}
                <span className="ml-2 opacity-0 group-hover/heading:opacity-100 transition-opacity text-[#0071E3]">
                  →
                </span>
              </Tag>
            ) : (
              <Tag className={headingStyle}>{cleanedContent}</Tag>
            )}
          </div>
        );

      case 'list':
        return (
          <div className={`${theme.list} [&>ul]:list-none [&>ul]:pl-0 [&>ol]:list-none [&>ol]:pl-0`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                ul: ({node, ...props}) => <ul {...props} className={`wiki-list ${theme.ul}`} />,
                ol: ({node, ...props}) => <ol {...props} className={`wiki-list ${theme.ol}`} />,
                li: ({node, ...props}) => <li {...props} className={theme.li} />,
                p: ({node, ...props}) => <span {...props} />,
                a: ({node, ...props}) => <a {...props} className={theme.link} />,
                code: ({node, ...props}) => <code {...props} className={theme.inlineCode} />,
                strong: ({node, ...props}) => <strong {...props} className={theme.strong} />,
                hr: () => theme.hrDot ? (
                  <div className={theme.hr}>
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#d2d2d7] to-transparent" />
                    <div className="w-1.5 h-1.5 rounded-full bg-[#d2d2d7]" />
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#d2d2d7] to-transparent" />
                  </div>
                ) : (
                  <hr className={theme.hr} />
                )
              }}
            >
              {preprocessColonIndent(content)}
            </ReactMarkdown>
          </div>
        );

      case 'table':
        return (
          <div className={theme.table}>
            <div className="max-h-[500px] overflow-auto">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({node, ...props}) => <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }} {...props} />,
                  thead: ({node, ...props}) => <thead className={theme.thead} {...props} />,
                  tbody: ({node, ...props}) => <tbody className={theme.tbody} {...props} />,
                  tr: ({node, ...props}) => <tr className={theme.tr} {...props} />,
                  th: ({node, ...props}) => <th className={theme.th} style={{ wordBreak: 'break-word' }} {...props} />,
                  td: ({node, ...props}) => <td className={theme.td} style={{ wordBreak: 'break-word' }} {...props} />,
                  code: ({node, ...props}) => <code className={theme.inlineCode} style={{ wordBreak: 'break-all' }} {...props} />
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        );

      case 'paragraph':
      default:
        return (
          <div className={theme.paragraph}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({node, ...props}) => <p {...props} className={theme.paragraphInner} />,
                a: ({node, ...props}) => <a {...props} className={theme.link} />,
                code: ({node, ...props}) => <code {...props} className={theme.inlineCode} />,
                strong: ({node, ...props}) => <strong {...props} className={theme.strong} />,
                em: ({node, ...props}) => <em {...props} className={theme.em} />,
                ul: ({node, ...props}) => <ul {...props} className={`wiki-list ${theme.ul}`} />,
                ol: ({node, ...props}) => <ol {...props} className={`wiki-list ${theme.ol}`} />,
                li: ({node, ...props}) => <li {...props} className={theme.li} />,
                // 表格样式补充（兼容后端将表格作为 text 传入的情况）
                table: ({node, ...props}) => (
                  <div className={theme.table}>
                    <div className="max-h-[500px] overflow-auto">
                      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }} {...props} />
                    </div>
                  </div>
                ),
                thead: ({node, ...props}) => <thead className={theme.thead} {...props} />,
                tbody: ({node, ...props}) => <tbody className={theme.tbody} {...props} />,
                tr: ({node, ...props}) => <tr className={theme.tr} {...props} />,
                th: ({node, ...props}) => <th className={theme.th} style={{ wordBreak: 'break-word' }} {...props} />,
                td: ({node, ...props}) => <td className={theme.td} style={{ wordBreak: 'break-word' }} {...props} />,
                hr: () => theme.hrDot ? (
                  <div className={theme.hr}>
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#d2d2d7] to-transparent" />
                    <div className="w-1.5 h-1.5 rounded-full bg-[#d2d2d7]" />
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#d2d2d7] to-transparent" />
                  </div>
                ) : (
                  <hr className={theme.hr} />
                )
              }}
            >
              {preprocessColonIndent(content)}
            </ReactMarkdown>
          </div>
        );
    }
  };

  return (
    <div
      id={block.id}
      className={`
        relative group/block transition-all duration-300
        ${block.status === 'deleted' ? 'line-through decoration-red-300' : ''}
      `}
      style={{ paddingLeft: 0 }}
    >
      <div
        className={`
          pl-12 pr-4 py-2 -ml-12 rounded-xl border
          ${getDiffStyles()}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Status Badge */}
        {getDiffBadge()}

        {/* Original Content for Modified Blocks */}
        {block.status === 'modified' && block.originalContent && (
          <div className={`mb-3 border-l-4 pl-3 p-2 rounded-r-md line-through ${
            isDarkMode
              ? 'border-red-500 bg-red-900/40 text-red-300/80 decoration-red-400/60'
              : 'border-red-400 bg-red-50 text-red-700/70 decoration-red-400/60'
          }`}>
            <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
              原内容
            </div>
            {renderContent(block.originalContent)}
          </div>
        )}
        {block.status === 'modified' && (
          <div className={`border-l-4 pl-3 ${
            isDarkMode ? 'border-green-500' : 'border-green-400'
          }`}>
            <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
              新内容
            </div>
          </div>
        )}

        {/* Selection Button */}
        {!block.status && (
          <div
              className={`
              absolute left-3 top-2 transition-all duration-300 z-10
              ${isHovered || isSelected ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 -translate-x-2 scale-90 pointer-events-none'}
              `}
          >
              <button
              onClick={() => onToggleSelect(block)}
              className={`
                  w-6 h-6 rounded-full flex items-center justify-center shadow-sm transition-all duration-200
                  ${isSelected
                  ? isDarkMode
                    ? 'bg-[#58a6ff] text-white shadow-md shadow-blue-900/50 scale-110'
                    : 'bg-[#0071E3] text-white shadow-md shadow-blue-200 scale-110'
                  : isDarkMode
                    ? 'bg-[#21262d] text-[#7d8590] hover:text-[#58a6ff] hover:scale-110 border border-[#30363d]'
                    : 'bg-white text-[#86868b] hover:text-[#0071E3] hover:scale-110 border border-[#e5e5ea]'
                  }
              `}
              title={isSelected ? "取消引用" : "引用此内容"}
              >
              {isSelected ? <Check size={12} strokeWidth={3} /> : <Plus size={14} />}
              </button>
          </div>
        )}

        {/* More Options Menu */}
        <div
          ref={menuRef}
          className={`
            absolute right-2 top-2 transition-all duration-300 z-20
            ${isHovered || showMenu ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}
          `}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className={`w-6 h-6 rounded-full flex items-center justify-center shadow-sm transition-all duration-200 ${
              isDarkMode
                ? 'bg-[#21262d] text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#30363d] border border-[#30363d]'
                : 'bg-white text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-100 border border-[#e5e5ea]'
            }`}
            title="更多选项"
          >
            <MoreHorizontal size={14} />
          </button>

          {showMenu && (
            <div className={`absolute right-0 top-8 rounded-lg shadow-lg border py-1 min-w-[140px] z-30 ${
              isDarkMode
                ? 'bg-[#161b22] border-[#30363d]'
                : 'bg-white border-[#e5e5ea]'
            }`}>
              {hasSources && onSourceClick && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSourceClick(block.id, block.sources![0].source_id, block.sources!);
                    setShowMenu(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                    isDarkMode
                      ? 'text-[#e6edf3] hover:bg-[#30363d]'
                      : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
                  }`}
                >
                  <Code size={14} className={isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'} />
                  查看源代码
                </button>
              )}
              {!hasSources && (
                <div className={`px-3 py-2 text-sm ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
                  暂无源代码
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`transition-opacity duration-300 ${isSelected ? 'opacity-100' : 'opacity-100'}`}>
          {renderContent(block.content)}
          {/* Neo4j Source 小卡片 - heading 显示名称列表，mermaid 显示节点映射 */}
          {block.type === 'heading' && renderNeo4jIdCard(block.neo4jIds, block.neo4jSource, false)}
          {block.type === 'mermaid' && renderNeo4jIdCard(block.neo4jIds, block.neo4jSource, true)}
        </div>
      </div>

      {/* Recursively render children */}
      {hasChildren && !isCollapsed && (
        <div className="children-container">
          {block.children!.map(child => (
            <WikiBlockRenderer
              key={child.id}
              block={child}
              isSelected={selectedBlockIds ? selectedBlockIds.has(child.id) : false}
              onToggleSelect={onToggleSelect}
              onMermaidNodeClick={onMermaidNodeClick}
              onSourceClick={onSourceClick}
              onToggleCollapse={onToggleCollapse}
              selectedBlockIds={selectedBlockIds}
              highlightedBlockId={highlightedBlockId}
              highlightedMermaidNodeId={highlightedMermaidNodeId}
              onMermaidDoubleClick={onMermaidDoubleClick}
              onMermaidEdit={onMermaidEdit}
              theme={theme}
              isDarkMode={isDarkMode}
              wikiPages={wikiPages}
              onPageNavigate={onPageNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// 使用 React.memo 优化性能，避免不必要的重渲染
export default React.memo(WikiBlockRenderer, (prevProps, nextProps) => {
  // 只在关键 props 变化时才重新渲染
  return (
    prevProps.block.id === nextProps.block.id &&
    prevProps.block.content === nextProps.block.content &&
    prevProps.block.status === nextProps.block.status &&
    prevProps.block.isCollapsed === nextProps.block.isCollapsed &&
    prevProps.block.children === nextProps.block.children &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.highlightedBlockId === nextProps.highlightedBlockId &&
    prevProps.highlightedMermaidNodeId === nextProps.highlightedMermaidNodeId &&
    prevProps.isDarkMode === nextProps.isDarkMode &&
    prevProps.theme?.id === nextProps.theme?.id
  );
});