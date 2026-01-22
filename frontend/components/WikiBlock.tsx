import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from './Mermaid';
import { WikiBlock, MermaidMetadata, WikiSource } from '../types';
import { Plus, Check, GitCommitHorizontal, Trash2, FileDiff, Code, ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { ghcolors } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
}

// 清理标题中的 Markdown 标记（如 ###），保留实际标题内容
const cleanHeadingContent = (content: string): string => {
  // 移除开头的 Markdown 标题标记 (###, ##, # 等)
  return content.replace(/^#{1,6}\s+/, '').trim();
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
  onMermaidDoubleClick
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Check if block has children
  const hasChildren = block.children && block.children.length > 0;
  const isCollapsed = block.isCollapsed || false;
  const isHighlighted = highlightedBlockId === block.id;

  // --- Diff Styles ---
  const getDiffStyles = () => {
    if (isHighlighted) {
      return 'bg-orange-50 border-orange-300 ring-2 ring-orange-200 shadow-md';
    }
    switch (block.status) {
      case 'inserted':
        return 'bg-emerald-50/60 border-emerald-200/60 hover:border-emerald-300 hover:shadow-emerald-100/50';
      case 'deleted':
        return 'bg-red-50/50 border-red-200/50 opacity-60 hover:opacity-80 decoration-red-400';
      case 'modified':
        return 'bg-amber-50/50 border-amber-200/60 hover:border-amber-300';
      default:
        return isSelected
          ? 'bg-[#0071E3]/[0.03] border-blue-100'
          : 'border-transparent hover:bg-white hover:shadow-[0_1px_6px_rgba(0,0,0,0.02)] hover:border-gray-200/50';
    }
  };

  const getDiffBadge = () => {
    if (!block.status || block.status === 'original') return null;

    const badgeConfig = {
      inserted: { color: 'text-emerald-600 bg-emerald-100', icon: <Plus size={10} />, text: '新增' },
      deleted: { color: 'text-red-600 bg-red-100', icon: <Trash2 size={10} />, text: '删除' },
      modified: { color: 'text-amber-600 bg-amber-100', icon: <FileDiff size={10} />, text: '修改' }
    };
    const config = badgeConfig[block.status];

    return (
      <div className={`absolute -left-2 top-0 -translate-y-1/2 z-20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm ${config.color}`}>
        {config.icon}
        {config.text}
      </div>
    );
  };

  const renderContent = (content: string) => {
    switch (block.type) {
      case 'mermaid':
        // Wrap callback to include block.id
        const handleMermaidNodeClick = onMermaidNodeClick
          ? (nodeId: string, metadata?: MermaidMetadata) => onMermaidNodeClick(nodeId, metadata!, block.id)
          : undefined;
        return (
          <Mermaid
              chart={content}
              metadata={block.metadata}
              onNodeClick={handleMermaidNodeClick}
              highlightedNodeId={highlightedMermaidNodeId}
              onDoubleClick={() => onMermaidDoubleClick?.(content, block.metadata)}
              status={block.status}
          />
        );

      case 'code':
        const lines = content.split('\n');
        let language = 'text';
        let codeToDisplay = content;

        if (lines[0].trim().startsWith('```')) {
          language = lines[0].replace('```', '').trim() || 'text';
          codeToDisplay = content.replace(/^```.*\n/, '').replace(/```$/, '');
        }

        return (
          <div className="relative group my-4 rounded-xl overflow-hidden border border-[#d2d2d7]/50 shadow-sm bg-[#ffffff]">
            <div className="flex items-center justify-between px-4 py-2 bg-[#f5f5f7] border-b border-[#e5e5ea]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57] opacity-80"></div>
                <div className="w-3 h-3 rounded-full bg-[#febc2e] opacity-80"></div>
                <div className="w-3 h-3 rounded-full bg-[#28c840] opacity-80"></div>
              </div>
              <span className="text-xs font-mono text-[#86868b] uppercase">{language}</span>
            </div>
            <SyntaxHighlighter
              language={language}
              style={ghcolors}
              customStyle={{
                margin: 0,
                padding: '1.5rem',
                backgroundColor: '#ffffff',
                fontSize: '13px',
                lineHeight: '1.6',
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

        const headingStyles = {
          1: "wiki-h1 text-3xl font-bold text-[#1d1d1f] mt-8 mb-4 tracking-tight leading-tight",
          2: "wiki-h2 text-[24px] font-semibold text-[#1d1d1f] mt-6 mb-3 tracking-tight leading-snug",
          3: "wiki-h3 text-[19px] font-medium text-[#1d1d1f] mt-4 mb-2 tracking-tight leading-snug",
          4: "wiki-h4 text-[16px] font-medium text-[#1d1d1f] mt-3 mb-2",
          5: "wiki-h5 text-[15px] font-medium text-[#1d1d1f] mt-2 mb-1",
          6: "wiki-h6 text-[13px] font-semibold text-[#86868b] mt-2 mb-1 uppercase tracking-wider"
        };
        const style = headingStyles[level as keyof typeof headingStyles] || headingStyles[2];

        return (
          <div className="relative">
            {/* Collapse button for headings with children */}
            {hasChildren && onToggleCollapse && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(block.id);
                }}
                className={`
                  absolute -left-7 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 transition-all duration-300 text-gray-500 hover:text-gray-700
                  ${isHovered ? 'opacity-100' : 'opacity-0'}
                `}
                title={isCollapsed ? "展开" : "折叠"}
              >
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
            <Tag className={style}>{cleanedContent}</Tag>
          </div>
        );

      case 'list':
        return (
          <div className="my-1 text-[15px] leading-[1.6] text-[#1d1d1f]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                ul: ({node, ...props}) => <ul {...props} className="wiki-list list-disc pl-5 space-y-1 mb-2" />,
                ol: ({node, ...props}) => <ol {...props} className="wiki-list list-decimal pl-5 space-y-1 mb-2" />,
                li: ({node, ...props}) => <li {...props} className="pl-1 marker:text-[#86868b]" />,
                p: ({node, ...props}) => <span {...props} />,
                a: ({node, ...props}) => <a {...props} className="text-[#0071E3] hover:underline decoration-1 underline-offset-2" />,
                code: ({node, ...props}) => <code {...props} className="bg-[#f5f5f7] text-[#1d1d1f] px-1 py-0.5 rounded text-[90%] font-mono border border-[#e5e5ea]" {...props} />
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        );
      
      case 'table':
        return (
          <div className="my-6 overflow-hidden rounded-xl border border-[#d2d2d7]/60 shadow-sm">
            <div className="max-h-[500px] overflow-auto">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({node, ...props}) => <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }} {...props} />,
                  thead: ({node, ...props}) => <thead className="bg-[#F5F5F7] sticky top-0 z-10" {...props} />,
                  tbody: ({node, ...props}) => <tbody className="bg-white" {...props} />,
                  tr: ({node, ...props}) => <tr className="transition-colors hover:bg-[#f5f5f7]/50 border-b border-[#d2d2d7]/30" {...props} />,
                  th: ({node, ...props}) => <th className="px-5 py-3 text-left text-xs font-semibold text-[#86868b] uppercase tracking-wider bg-[#F5F5F7] border border-[#d2d2d7]/40" style={{ wordBreak: 'break-word' }} {...props} />,
                  td: ({node, ...props}) => <td className="px-5 py-4 text-sm text-[#1d1d1f] leading-relaxed align-top border border-[#d2d2d7]/30" style={{ wordBreak: 'break-word' }} {...props} />,
                  code: ({node, ...props}) => <code className="bg-[#f5f5f7] px-1.5 py-0.5 rounded text-xs font-mono border border-[#e5e5ea]" style={{ wordBreak: 'break-all' }} {...props} />
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
          <div className="my-1 text-[15px] leading-[1.7] text-[#1d1d1f] tracking-normal font-normal text-left">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({node, ...props}) => <p {...props} className="mb-2" />,
                a: ({node, ...props}) => <a {...props} className="text-[#0071E3] hover:underline decoration-1 underline-offset-2" />,
                code: ({node, ...props}) => <code {...props} className="bg-[#f5f5f7] text-[#1d1d1f] px-1.5 py-0.5 rounded text-[90%] font-mono border border-[#e5e5ea]" />,
                // 表格样式补充（兼容后端将表格作为 text 传入的情况）
                table: ({node, ...props}) => (
                  <div className="my-6 overflow-hidden rounded-xl border border-[#d2d2d7]/60 shadow-sm">
                    <div className="max-h-[500px] overflow-auto">
                      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }} {...props} />
                    </div>
                  </div>
                ),
                thead: ({node, ...props}) => <thead className="bg-[#F5F5F7] sticky top-0 z-10" {...props} />,
                tbody: ({node, ...props}) => <tbody className="bg-white" {...props} />,
                tr: ({node, ...props}) => <tr className="transition-colors hover:bg-[#f5f5f7]/50 border-b border-[#d2d2d7]/30" {...props} />,
                th: ({node, ...props}) => <th className="px-5 py-3 text-left text-xs font-semibold text-[#86868b] uppercase tracking-wider bg-[#F5F5F7] border border-[#d2d2d7]/40" style={{ wordBreak: 'break-word' }} {...props} />,
                td: ({node, ...props}) => <td className="px-5 py-4 text-sm text-[#1d1d1f] leading-relaxed align-top border border-[#d2d2d7]/30" style={{ wordBreak: 'break-word' }} {...props} />
              }}
            >
              {content}
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
          <div className="mb-2 opacity-50 hover:opacity-100 transition-opacity border-l-2 border-red-200 pl-3 text-sm bg-red-50/30 p-2 rounded-r-md line-through decoration-red-300/50 grayscale">
             {renderContent(block.originalContent)}
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
                  ? 'bg-[#0071E3] text-white shadow-md shadow-blue-200 scale-110'
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
            className="w-6 h-6 rounded-full flex items-center justify-center bg-white text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-100 border border-[#e5e5ea] shadow-sm transition-all duration-200"
            title="更多选项"
          >
            <MoreHorizontal size={14} />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-[#e5e5ea] py-1 min-w-[140px] z-30">
              {hasSources && onSourceClick && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSourceClick(block.id, block.sources![0].source_id, block.sources!);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] flex items-center gap-2 transition-colors"
                >
                  <Code size={14} className="text-[#86868b]" />
                  查看源代码
                </button>
              )}
              {!hasSources && (
                <div className="px-3 py-2 text-sm text-[#86868b]">
                  暂无源代码
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`transition-opacity duration-300 ${isSelected ? 'opacity-100' : 'opacity-100'}`}>
          {renderContent(block.content)}
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default WikiBlockRenderer;