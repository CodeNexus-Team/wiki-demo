import React, { useState, useCallback, useEffect, useRef } from 'react';
import { WikiBlock, MermaidMetadata, WikiSource } from '../../types';
import { countTreeNodes } from '../../utils/treeBuilder';
import WikiBlockRenderer from '../WikiBlock';
import WikiPageNavigator from '../WikiPageNavigator';
import { Loader2, Sparkles, Zap, FileDiff, PanelLeft, Palette, ChevronDown, GripVertical, Sun, Moon } from 'lucide-react';
import { useWikiTheme } from '../../hooks/useWikiTheme';

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
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const { theme, themeId, setThemeId, isDarkMode, toggleDarkMode, availableThemes } = useWikiTheme();

  // Resizable navigator state
  const [navigatorWidth, setNavigatorWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const HeaderIcon = headerIcon === 'zap' ? Zap : Sparkles;

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;

      // Clamp width between min and max
      const clampedWidth = Math.min(Math.max(newWidth, 200), 500);
      setNavigatorWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return (
    <div
      ref={containerRef}
      className={`
      backdrop-blur-xl rounded-xl border min-h-[70vh] max-h-[calc(100vh-4rem)] animate-in fade-in duration-300
      ${isDarkMode
        ? 'bg-[#0d1117]/90 border-[#30363d]'
        : 'bg-white/20 border-white/30'
      }
      ${isDiffMode ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-transparent' : ''}
      relative flex overflow-hidden
    `}>
      {/* Loading Overlay */}
      {isLoadingPage && (
        <div className={`absolute inset-0 backdrop-blur-sm rounded-[2.5rem] flex items-center justify-center z-10 ${
          isDarkMode ? 'bg-[#0d1117]/80' : 'bg-white/80'
        }`}>
          <div className={`flex items-center gap-3 ${variant === 'orange' ? 'text-orange-600' : isDarkMode ? 'text-[#58a6ff]' : 'text-blue-600'}`}>
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm font-medium">加载页面中...</span>
          </div>
        </div>
      )}

      {/* Left: Page Navigator - Fixed */}
      {hasMultiplePages && (
        <div
          className={`
            flex-shrink-0
            ${isNavigatorVisible ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden'}
          `}
          style={{ width: isNavigatorVisible ? navigatorWidth : 0 }}
        >
          <div className={`p-4 h-full flex flex-col ${isDarkMode ? 'bg-[#161b22]/50' : 'bg-white/20'}`}>
            <WikiPageNavigator
              wikiPages={wikiPages}
              currentPage={currentPagePath}
              onPageSelect={onPageSwitch || (() => {})}
              onToggleVisibility={onToggleNavigator}
              blocks={blocks}
              onBlockClick={onBlockClick}
              theme={theme}
              isDarkMode={isDarkMode}
            />
          </div>
        </div>
      )}

      {/* Resizable Divider */}
      {hasMultiplePages && isNavigatorVisible && (
        <div
          onMouseDown={handleMouseDown}
          className={`
            flex-shrink-0 w-1 cursor-col-resize group relative
            ${isResizing
              ? isDarkMode ? 'bg-[#58a6ff]/30' : 'bg-[#0071E3]/30'
              : isDarkMode ? 'bg-[#30363d] hover:bg-[#58a6ff]/20' : 'bg-white/40 hover:bg-[#0071E3]/20'
            }
            transition-colors duration-150
          `}
        >
          {/* Visual indicator */}
          <div className={`
            absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
            w-1 h-12 rounded-full
            ${isResizing
              ? isDarkMode ? 'bg-[#58a6ff]' : 'bg-[#0071E3]'
              : isDarkMode
                ? 'bg-[#484f58] group-hover:bg-[#58a6ff]/60'
                : 'bg-[#d2d2d7] group-hover:bg-[#0071E3]/60'
            }
            transition-colors duration-150
          `}>
            <GripVertical size={10} className={`
              absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
              ${isResizing
                ? 'text-white'
                : isDarkMode
                  ? 'text-[#7d8590] group-hover:text-[#58a6ff]'
                  : 'text-[#86868b] group-hover:text-[#0071E3]'
              }
            `} />
          </div>
        </div>
      )}

      {/* Show navigator button (when hidden) */}
      {hasMultiplePages && !isNavigatorVisible && onToggleNavigator && (
        <div className={`flex-shrink-0 flex items-start p-4 border-r ${isDarkMode ? 'border-[#30363d]' : 'border-white/40'}`}>
          <button
            onClick={onToggleNavigator}
            className={`flex items-center justify-center w-10 h-10 rounded-2xl backdrop-blur-md border transition-all duration-200 group ${
              isDarkMode
                ? 'bg-[#21262d] border-[#30363d] hover:bg-[#30363d] hover:shadow-lg'
                : 'bg-white/40 border-white/60 hover:bg-white/60 hover:shadow-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'
            }`}
            title="显示导航"
          >
            <PanelLeft size={18} className={`${isDarkMode ? 'text-[#7d8590] group-hover:text-[#58a6ff]' : 'text-[#86868b]'} group-hover:${variant === 'orange' ? 'text-orange-600' : isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'}`} />
          </button>
        </div>
      )}

      {/* Right: Wiki Content - Scrollable */}
      <div className="flex-1 min-w-0 pt-8 px-8 md:pt-12 md:px-12 overflow-y-auto">
        {/* Wiki Header */}
        <div className={`mb-8 pb-6 border-b flex justify-between items-center ${isDarkMode ? 'border-[#30363d]' : 'border-black/[0.04]'}`}>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-1.5 border ${
              variant === 'orange'
                ? 'text-orange-600 bg-orange-500/10 border-orange-500/20'
                : isDarkMode
                  ? 'text-[#58a6ff] bg-[#58a6ff]/10 border-[#58a6ff]/20'
                  : 'text-[#0071E3] bg-[#0071E3]/10 border-[#0071E3]/20'
            }`}>
              <HeaderIcon size={12} /> {headerLabel}
            </span>
            {headerBadge}
            {isDiffMode && (
              <span className={`text-xs px-3 py-1 rounded-full flex items-center gap-1 animate-pulse ${
                isDarkMode ? 'text-amber-400 bg-amber-900/30' : 'text-amber-600 bg-amber-50'
              }`}>
                <FileDiff size={12} /> 审查变更中
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleDarkMode}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                isDarkMode
                  ? 'bg-[#30363d] text-[#e6edf3] hover:bg-[#3d444d]'
                  : 'bg-white/50 text-[#86868b] hover:bg-white/70 hover:text-[#1d1d1f]'
              }`}
              title={isDarkMode ? '切换到亮色模式' : '切换到暗色模式'}
            >
              {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            {/* Theme Selector */}
            <div className="relative">
              <button
                onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg transition-colors ${
                  isDarkMode
                    ? 'text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#30363d]'
                    : 'text-[#86868b] hover:text-[#1d1d1f] hover:bg-white/50'
                }`}
              >
                <Palette size={12} />
                <span>{theme.name}</span>
                <ChevronDown size={12} className={`transition-transform ${isThemeMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isThemeMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsThemeMenuOpen(false)} />
                  <div className={`absolute right-0 top-full mt-1 backdrop-blur-2xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border py-2 min-w-[180px] z-50 ${
                    isDarkMode
                      ? 'bg-[#161b22]/90 border-[#30363d]'
                      : 'bg-white/80 border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'
                  }`}>
                    {availableThemes.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setThemeId(t.id);
                          setIsThemeMenuOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                          themeId === t.id
                            ? isDarkMode
                              ? 'bg-[#58a6ff]/20 text-[#58a6ff]'
                              : 'bg-[#0071E3]/10 text-[#0071E3]'
                            : isDarkMode
                              ? 'text-[#e6edf3] hover:bg-[#30363d]'
                              : 'text-[#1d1d1f] hover:bg-white/60'
                        }`}
                      >
                        <div>
                          <div className="font-medium">{t.name}</div>
                          <div className={`text-[10px] ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
                            {isDarkMode ? t.dark.description : t.light.description}
                          </div>
                        </div>
                        {themeId === t.id && <span className={isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'}>✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className={`text-xs font-mono ${isDarkMode ? 'text-[#7d8590]' : 'text-[#d2d2d7]'}`}>{countTreeNodes(blocks)} 个对象</span>
          </div>
        </div>

        {/* Wiki Content */}
        <div className="space-y-1 wiki-root">
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
                theme={theme}
                isDarkMode={isDarkMode}
                wikiPages={wikiPages}
                onPageNavigate={onPageSwitch}
              />
            </div>
          ))}
        </div>

        {/* Bottom spacer for extra scroll space */}
        <div className="h-48 flex-shrink-0" />
      </div>
    </div>
  );
};

export default WikiContent;
