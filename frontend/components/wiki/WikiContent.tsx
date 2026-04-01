import React, { useState, useCallback, useEffect, useRef } from 'react';
import { WikiBlock, MermaidMetadata, WikiSource } from '../../types';
import { countTreeNodes } from '../../utils/treeBuilder';
import WikiBlockRenderer from '../WikiBlock';
import WikiPageNavigator from '../WikiPageNavigator';
import { codenexusWikiService } from '../../services/codenexusWikiService';
import { Loader2, Sparkles, Zap, FileDiff, PanelLeft, Palette, ChevronDown, GripVertical, Sun, Moon, Search, X, ArrowUp, ArrowDown } from 'lucide-react';
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

  // Layout
  noBorder?: boolean;
}

const WikiContentInner: React.FC<WikiContentProps> = ({
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
  noBorder = false,
}) => {
  const hasMultiplePages = wikiPages.length > 1;
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const { theme, themeId, setThemeId, isDarkMode, toggleDarkMode, availableThemes } = useWikiTheme();

  // Search
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ page_path: string; block_id: string; preview: string }>>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search via backend API
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setCurrentResultIndex(0);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      const results = await codenexusWikiService.searchWiki(searchQuery.trim());
      setSearchResults(results);
      setCurrentResultIndex(0);
      setIsSearching(false);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  const goToResult = useCallback((index: number) => {
    if (searchResults.length === 0) return;
    const wrapped = ((index % searchResults.length) + searchResults.length) % searchResults.length;
    setCurrentResultIndex(wrapped);
    const result = searchResults[wrapped];
    // If different page, navigate first
    if (result.page_path !== currentPagePath && onPageSwitch) {
      onPageSwitch(result.page_path);
      // Scroll after page loads
      setTimeout(() => {
        document.getElementById(result.block_id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 500);
    } else {
      document.getElementById(result.block_id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [searchResults, currentPagePath, onPageSwitch]);

  // CSS Custom Highlight API for search matches.
  // Uses MutationObserver to re-apply highlights when DOM changes (React re-renders,
  // Mermaid async rendering, block collapse, etc.) so highlights don't go stale.
  useEffect(() => {
    // @ts-ignore - CSS Custom Highlight API
    if (!CSS.highlights) return;

    // @ts-ignore
    CSS.highlights.delete('wiki-search');

    if (!searchQuery) return;

    const applyHighlights = () => {
      // @ts-ignore
      CSS.highlights.delete('wiki-search');

      const container = containerRef.current;
      if (!container) return;

      const wikiRoot = container.querySelector('.wiki-root');
      if (!wikiRoot) return;

      const ranges: Range[] = [];
      const walker = document.createTreeWalker(wikiRoot, NodeFilter.SHOW_TEXT);

      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.nodeValue || '';
        let idx = text.indexOf(searchQuery);
        while (idx !== -1) {
          const range = new Range();
          range.setStart(textNode, idx);
          range.setEnd(textNode, idx + searchQuery.length);
          ranges.push(range);
          idx = text.indexOf(searchQuery, idx + searchQuery.length);
        }
      }

      if (ranges.length > 0) {
        // @ts-ignore
        const highlight = new Highlight(...ranges);
        // @ts-ignore
        CSS.highlights.set('wiki-search', highlight);
      }
    };

    // Initial apply after DOM settles
    const timer = setTimeout(applyHighlights, 100);

    // Re-apply when DOM mutates (React re-renders, Mermaid async render, etc.)
    const container = containerRef.current;
    const wikiRoot = container?.querySelector('.wiki-root');
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;

    if (wikiRoot) {
      observer = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyHighlights, 50);
      });
      observer.observe(wikiRoot, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      clearTimeout(timer);
      if (debounceTimer) clearTimeout(debounceTimer);
      observer?.disconnect();
    };
  }, [searchQuery, blocks]);

  // Ctrl/Cmd+F shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSearchOpen]);

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
      backdrop-blur-xl min-h-[70vh] max-h-[calc(100vh-4rem)] animate-in fade-in duration-300
      ${noBorder ? '' : 'rounded-xl border'}
      ${isDarkMode
        ? noBorder ? 'bg-transparent' : 'bg-[#0d1117]/90 border-[#30363d]'
        : noBorder ? 'bg-transparent' : 'bg-white/20 border-white/30'
      }
      ${isDiffMode ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-transparent' : ''}
      relative flex overflow-hidden flex-1
    `}>
      {/* Loading Overlay - does not block tab bar or navigator interaction */}
      {isLoadingPage && (
        <div className={`absolute inset-0 backdrop-blur-sm rounded-[2.5rem] flex items-center justify-center z-10 pointer-events-none ${
          isDarkMode ? 'bg-[#0d1117]/60' : 'bg-white/60'
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
            {/* Search Button */}
            <button
              onClick={() => { setIsSearchOpen(!isSearchOpen); setTimeout(() => searchInputRef.current?.focus(), 50); }}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                isSearchOpen
                  ? isDarkMode ? 'bg-[#58a6ff]/20 text-[#58a6ff]' : 'bg-[#0071E3]/10 text-[#0071E3]'
                  : isDarkMode ? 'bg-[#30363d] text-[#7d8590] hover:text-[#e6edf3]' : 'bg-white/50 text-[#86868b] hover:text-[#1d1d1f]'
              }`}
              title="搜索 (Ctrl+F)"
            >
              <Search size={14} />
            </button>
            <span className={`text-xs font-mono ${isDarkMode ? 'text-[#7d8590]' : 'text-[#d2d2d7]'}`}>{countTreeNodes(blocks)} 个对象</span>
          </div>
        </div>

        {/* Search Bar */}
        {isSearchOpen && (
          <div className={`mb-4 flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
            isDarkMode
              ? 'bg-[#161b22] border-[#30363d]'
              : 'bg-white/60 border-gray-200/60 backdrop-blur-sm'
          }`}>
            <Search size={14} className={isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  goToResult(e.shiftKey ? currentResultIndex - 1 : currentResultIndex + 1);
                }
              }}
              placeholder="搜索内容..."
              className={`flex-1 bg-transparent outline-none text-sm ${
                isDarkMode ? 'text-[#e6edf3] placeholder:text-[#7d8590]' : 'text-[#1d1d1f] placeholder:text-[#86868b]'
              }`}
            />
            {searchQuery && (
              <span className={`text-xs whitespace-nowrap ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
                {isSearching ? '搜索中...' : searchResults.length > 0 ? `${currentResultIndex + 1}/${searchResults.length}` : '无匹配'}
              </span>
            )}
            <button onClick={() => goToResult(currentResultIndex - 1)} disabled={searchResults.length === 0}
              className={`p-1 rounded transition-colors disabled:opacity-30 ${isDarkMode ? 'hover:bg-[#30363d]' : 'hover:bg-gray-100'}`}>
              <ArrowUp size={14} />
            </button>
            <button onClick={() => goToResult(currentResultIndex + 1)} disabled={searchResults.length === 0}
              className={`p-1 rounded transition-colors disabled:opacity-30 ${isDarkMode ? 'hover:bg-[#30363d]' : 'hover:bg-gray-100'}`}>
              <ArrowDown size={14} />
            </button>
            <button onClick={() => { setIsSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
              className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-[#30363d] text-[#7d8590]' : 'hover:bg-gray-100 text-[#86868b]'}`}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Search Results Preview */}
        {isSearchOpen && searchResults.length > 0 && (
          <div className={`mb-4 rounded-xl border overflow-hidden max-h-64 overflow-y-auto ${
            isDarkMode ? 'bg-[#161b22] border-[#30363d]' : 'bg-white/60 border-gray-200/60 backdrop-blur-sm'
          }`}>
            {searchResults.map((result, i) => {
              const fileName = result.page_path.replace(/\.json$/, '').split('/').pop() || result.page_path;
              const isCurrent = i === currentResultIndex;
              return (
                <button
                  key={`${result.page_path}-${result.block_id}-${i}`}
                  onClick={() => goToResult(i)}
                  className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors border-b last:border-b-0 ${
                    isCurrent
                      ? isDarkMode ? 'bg-[#58a6ff]/10 border-[#30363d]' : 'bg-blue-50/80 border-gray-100'
                      : isDarkMode ? 'hover:bg-[#21262d] border-[#30363d]' : 'hover:bg-white/80 border-gray-100'
                  }`}
                >
                  <span className={`text-[10px] font-medium truncate ${
                    isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'
                  }`}>
                    {fileName}
                  </span>
                  <span className={`text-xs truncate ${
                    isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'
                  }`}>
                    {(() => {
                      const idx = result.preview.indexOf(searchQuery);
                      if (idx === -1) return result.preview;
                      return (<>
                        {result.preview.slice(0, idx)}
                        <mark className={`rounded px-0.5 ${isDarkMode ? 'bg-yellow-500/30 text-yellow-200' : 'bg-yellow-200 text-yellow-900'}`}>
                          {result.preview.slice(idx, idx + searchQuery.length)}
                        </mark>
                        {result.preview.slice(idx + searchQuery.length)}
                      </>);
                    })()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

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

// React.memo 包装，避免 AnalysisView 因 prompt 输入等无关状态变化导致整棵 block 树重渲染
export const WikiContent = React.memo(WikiContentInner);

export default WikiContent;
