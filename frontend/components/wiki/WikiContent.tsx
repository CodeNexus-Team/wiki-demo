import React from 'react';
import { WikiBlock, MermaidMetadata, WikiSource } from '../../types';
import { countTreeNodes } from '../../utils/treeBuilder';
import WikiBlockRenderer from '../WikiBlock';
import WikiPageNavigator from '../WikiPageNavigator';
import { Loader2, Sparkles, Zap, FileDiff, PanelLeft } from 'lucide-react';

interface WikiContentProps {
  blocks: WikiBlock[];
  selectedBlockIds: Set<string>;
  isDiffMode?: boolean;
  isLoadingPage?: boolean;

  // Event handlers
  onToggleSelect: (block: WikiBlock) => void;
  onToggleCollapse: (blockId: string) => void;
  onMermaidNodeClick?: (nodeId: string, metadata?: MermaidMetadata, blockId?: string) => void;
  onSourceClick?: (blockId: string, sourceId: string, sources: WikiSource[]) => void;
  onMermaidDoubleClick?: (chart: string, metadata?: MermaidMetadata) => void;

  // Highlighting
  highlightedBlockId?: string | null;
  highlightedMermaidNodeId?: string | null;

  // Navigation
  wikiPages?: string[];
  currentPagePath?: string;
  isNavigatorVisible?: boolean;
  onPageSwitch?: (pagePath: string) => void;
  onToggleNavigator?: () => void;
  onBlockClick?: (blockId: string) => void;

  // Header customization
  headerLabel?: string;
  headerIcon?: 'sparkles' | 'zap';
  headerBadge?: React.ReactNode;

  // Theme
  variant?: 'blue' | 'orange';
}

export const WikiContent: React.FC<WikiContentProps> = ({
  blocks,
  selectedBlockIds,
  isDiffMode = false,
  isLoadingPage = false,
  onToggleSelect,
  onToggleCollapse,
  onMermaidNodeClick,
  onSourceClick,
  onMermaidDoubleClick,
  highlightedBlockId,
  highlightedMermaidNodeId,
  wikiPages = [],
  currentPagePath = '',
  isNavigatorVisible = true,
  onPageSwitch,
  onToggleNavigator,
  onBlockClick,
  headerLabel = '交互式代码Wiki',
  headerIcon = 'sparkles',
  headerBadge,
  variant = 'blue',
}) => {
  const hasMultiplePages = wikiPages.length > 1;

  const HeaderIcon = headerIcon === 'zap' ? Zap : Sparkles;
  const accentColor = variant === 'orange' ? 'text-orange-600 bg-orange-50' : 'text-[#0071E3] bg-blue-50';

  return (
    <div className="flex gap-6">
      {/* Left: Page Navigator */}
      {hasMultiplePages && (
        <div className={`
          flex-shrink-0 transition-all duration-300 ease-in-out
          ${isNavigatorVisible ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden'}
        `}>
          <div className="sticky top-8">
            <WikiPageNavigator
              wikiPages={wikiPages}
              currentPage={currentPagePath}
              onPageSelect={onPageSwitch || (() => {})}
              onToggleVisibility={onToggleNavigator}
              blocks={blocks}
              onBlockClick={onBlockClick}
            />
          </div>
        </div>
      )}

      {/* Show navigator button (when hidden) */}
      {hasMultiplePages && !isNavigatorVisible && onToggleNavigator && (
        <div className="flex-shrink-0 w-12">
          <div className="sticky top-8">
            <button
              onClick={onToggleNavigator}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 hover:bg-gray-50 hover:shadow-xl transition-all duration-200 group"
              title="显示导航"
            >
              <PanelLeft size={18} className={`text-gray-600 group-hover:${variant === 'orange' ? 'text-orange-600' : 'text-blue-600'}`} />
            </button>
          </div>
        </div>
      )}

      {/* Right: Wiki Content */}
      <div className="flex-1 min-w-0">
        <div className={`
          bg-white rounded-[2.5rem] shadow-apple-card p-8 md:p-12 border border-white min-h-[50vh] animate-in fade-in slide-in-from-bottom-8 duration-500 mb-10
          ${isDiffMode ? 'ring-2 ring-amber-400 ring-offset-4 ring-offset-[#F5F5F7]' : ''}
          relative
        `}>
          {/* Loading Overlay */}
          {isLoadingPage && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-[2.5rem] flex items-center justify-center z-10">
              <div className={`flex items-center gap-3 ${variant === 'orange' ? 'text-orange-600' : 'text-blue-600'}`}>
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm font-medium">加载页面中...</span>
              </div>
            </div>
          )}

          {/* Wiki Header */}
          <div className="mb-8 pb-6 border-b border-[#f5f5f7] flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${accentColor} px-3 py-1 rounded-full flex items-center gap-1`}>
                <HeaderIcon size={10} /> {headerLabel}
              </span>
              {headerBadge}
              {isDiffMode && (
                <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full flex items-center gap-1 animate-pulse">
                  <FileDiff size={12} /> 审查变更中
                </span>
              )}
            </div>
            <span className="text-xs text-[#d2d2d7] font-mono">{countTreeNodes(blocks)} 个对象</span>
          </div>

          {/* Wiki Content */}
          <div className="space-y-2 wiki-root">
            {blocks.map((block) => (
              <div key={block.id}>
                <WikiBlockRenderer
                  block={block}
                  isSelected={selectedBlockIds.has(block.id)}
                  onToggleSelect={onToggleSelect}
                  onMermaidNodeClick={onMermaidNodeClick}
                  onSourceClick={onSourceClick}
                  onToggleCollapse={onToggleCollapse}
                  selectedBlockIds={selectedBlockIds}
                  highlightedBlockId={highlightedBlockId}
                  highlightedMermaidNodeId={highlightedMermaidNodeId}
                  onMermaidDoubleClick={onMermaidDoubleClick}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WikiContent;
