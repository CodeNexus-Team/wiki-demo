import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisType, WikiBlock, MermaidMetadata, ExpandedQuestion, WikiHistoryRecord } from '../types';
import { geminiService, AVAILABLE_MODELS } from '../services/geminiService';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { wikiPageCache } from '../services/wikiPageCache';
import { parseMarkdownToBlocks, parseSingleBlockUpdate } from '../utils/markdownParser';
import { parseWikiPageToBlocks } from '../utils/wikiContentParser';
import { toggleBlockCollapse, insertBlockAfter, updateBlockContent } from '../utils/blockOperations';

// Hooks
import {
  useBlockSelection,
  useDiffMode,
  useChatHistory,
  useSourcePanel,
  useWikiPages,
  useMermaidModal,
  useResizablePanel
} from '../hooks';
import { useWikiTheme } from '../hooks/useWikiTheme';

// Components
import SourceCodePanel from './SourceCodePanel';
import QuestionSelector from './QuestionSelector';
import { ChatMessage, DiffConfirmBar, SelectionBar } from './chat';
import { WikiContent } from './wiki';
import { MermaidModal } from './mermaid/MermaidModal';

import {
  Loader2,
  ArrowUp,
  Sparkles,
  Eraser,
  ChevronUp,
  Bot,
  Cpu,
  Check,
  Sun,
  Moon
} from 'lucide-react';

interface AnalysisViewProps {
  type: AnalysisType;
  wikiHistory: WikiHistoryRecord[];
  setWikiHistory: React.Dispatch<React.SetStateAction<WikiHistoryRecord[]>>;
  selectedHistoryRecord: WikiHistoryRecord | null;
  onHistoryLoaded: () => void;
  isSidebarCollapsed?: boolean;
}

const TITLE_MAP: Record<AnalysisType, string> = {
  [AnalysisType.DASHBOARD]: '仪表盘',
  [AnalysisType.ARCHITECTURE]: '架构视图',
  [AnalysisType.API_ANALYSIS]: '接口分析',
  [AnalysisType.BUSINESS_FLOW]: '业务流',
  [AnalysisType.CONTROL_FLOW]: '控制流',
  [AnalysisType.DATABASE]: '数据库模型',
};

const AnalysisView: React.FC<AnalysisViewProps> = ({ type, wikiHistory, setWikiHistory, selectedHistoryRecord, onHistoryLoaded, isSidebarCollapsed = false }) => {
  // Theme
  const { isDarkMode, toggleDarkMode } = useWikiTheme();

  // Local State
  const [isLoading, setIsLoading] = useState(false);
  const [prompt, setPrompt] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>(AVAILABLE_MODELS[0].id);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [blocks, setBlocks] = useState<WikiBlock[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // CodeNexus Workflow State
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<ExpandedQuestion[]>([]);
  const [currentUserQuery, setCurrentUserQuery] = useState<string>('');

  // Refs
  const contentEndRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const justLoadedHistoryRef = useRef(false);

  // Custom Hooks
  const blockSelection = useBlockSelection({ blocks, isDiffMode: false });
  const {
    selectedBlockIds,
    toggleBlockSelection,
    clearSelection,
    setSelectedBlockIds,
    getReferencedBlocks,
    hasSelection
  } = blockSelection;

  const chat = useChatHistory();
  const {
    chatHistory,
    isChatExpanded,
    chatScrollRef,
    addUserMessage,
    addAssistantMessage,
    updateAssistantProgress,
    finalizeAssistantMessage,
    addSimpleMessage,
    setChatHistory,
    setIsChatExpanded,
    clearHistory
  } = chat;

  const wikiPagesHook = useWikiPages({
    mainContentRef,
    onPageLoaded: (newBlocks) => {
      setBlocks(newBlocks);
      setSelectedBlockIds(new Set());
    }
  });
  const {
    wikiPages,
    currentPagePath,
    isLoadingPage,
    isNavigatorVisible,
    setWikiPages,
    setCurrentPagePath,
    setIsNavigatorVisible,
    handlePageSwitch: handlePageSwitchBase,
  } = wikiPagesHook;

  const diffMode = useDiffMode({
    blocks,
    setBlocks,
    currentPagePath,
    clearSelection,
    addChatMessage: (content) => addSimpleMessage('assistant', content)
  });
  const {
    isDiffMode,
    applyChanges: applyDiffChanges,
    discardChanges: discardDiffChanges,
    enterDiffMode,
    applyModifyPageResponse,
    setIsDiffMode
  } = diffMode;

  const sourcePanel = useSourcePanel();
  const {
    isSourcePanelOpen,
    activeSourceLocation,
    sourcePanelWidth,
    highlightedBlockId,
    highlightedMermaidNodeId,
    closeSourcePanel,
    setSourcePanelWidth,
    handleSourceClick,
    handleMermaidNodeClick: baseMermaidNodeClick,
    setHighlightedBlockId
  } = sourcePanel;

  // Mermaid Modal
  const mermaidModal = useMermaidModal();
  const {
    isOpen: mermaidModalOpen,
    chart: mermaidModalChart,
    metadata: mermaidModalMetadata,
    zoom: mermaidModalZoom,
    position: mermaidModalPosition,
    size: mermaidModalSize,
    contentRef: mermaidContentRef,
    isDraggingRef: isMermaidDraggingRef,
    open: openMermaidModal,
    close: closeMermaidModal,
    handleResizeStart: handleMermaidResizeStart,
    handleMoveStart: handleMermaidMoveStart,
    handleContentDragStart: handleMermaidContentDragStart,
    handleWheel: handleMermaidWheel,
    adjustForSourcePanel
  } = mermaidModal;

  // Chat Panel Resize
  const chatPanel = useResizablePanel({
    initialWidth: 768,
    initialHeight: typeof window !== 'undefined' ? window.innerHeight * 0.9 : 500
  });
  const {
    width: chatWidth,
    height: chatHeight,
    isDraggingRef: isChatDraggingRef,
    getResizeHandlers
  } = chatPanel;

  // Adjust mermaid modal when source panel opens
  useEffect(() => {
    if (mermaidModalOpen && isSourcePanelOpen) {
      adjustForSourcePanel(sourcePanelWidth);
    }
  }, [isSourcePanelOpen, mermaidModalOpen, sourcePanelWidth, adjustForSourcePanel]);

  // Load selected history record
  useEffect(() => {
    if (!selectedHistoryRecord) return;

    const loadHistoryRecord = async () => {
      if (selectedHistoryRecord.pagePath) {
        setCurrentPagePath(selectedHistoryRecord.pagePath);
      }
      if (selectedHistoryRecord.wikiPages) {
        setWikiPages(selectedHistoryRecord.wikiPages);
      }
      if (selectedHistoryRecord.userQuery) {
        setCurrentUserQuery(selectedHistoryRecord.userQuery);
      }

      setSelectedBlockIds(new Set());
      setIsDiffMode(false);
      setIsChatExpanded(false);

      if (selectedHistoryRecord.pagePath) {
        const pagePath = selectedHistoryRecord.pagePath;
        let wikiPage = wikiPageCache.get(pagePath);

        if (!wikiPage) {
          try {
            wikiPage = await codenexusWikiService.fetchPage(pagePath);
          } catch (error) {
            console.error('[History] Failed to fetch page:', error);
          }
        }

        if (wikiPage) {
          const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
          setBlocks(parsedBlocks);
        } else if (selectedHistoryRecord.blocks) {
          setBlocks(selectedHistoryRecord.blocks);
        } else {
          setBlocks([]);
        }
      } else if (selectedHistoryRecord.blocks) {
        setBlocks(selectedHistoryRecord.blocks);
      }

      justLoadedHistoryRef.current = true;
      onHistoryLoaded();

      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0;
        }
      });
    };

    loadHistoryRecord();
  }, [selectedHistoryRecord, onHistoryLoaded, setCurrentPagePath, setWikiPages, setSelectedBlockIds, setIsDiffMode, setIsChatExpanded]);

  // Reset state on type change
  useEffect(() => {
    if (selectedHistoryRecord) return;
    if (justLoadedHistoryRef.current) {
      justLoadedHistoryRef.current = false;
      return;
    }

    setIsLoading(false);
    setBlocks([]);
    setPrompt('');
    clearHistory();
    setSuggestions(geminiService.getSuggestions(type));
    setIsChatExpanded(true);
    setIsModelMenuOpen(false);
    closeSourcePanel();
    setSelectedBlockIds(new Set());
    setIsDiffMode(false);
  }, [type, selectedHistoryRecord, clearHistory, setIsChatExpanded, closeSourcePanel, setSelectedBlockIds, setIsDiffMode]);

  // Scroll to content end when blocks change
  useEffect(() => {
    if (blocks.length > 0 && chatHistory.length === 0) {
      contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [blocks, chatHistory.length]);

  // Scroll highlighted block into view
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

  const hasContent = blocks.length > 0 || chatHistory.length > 0 || isLoading;

  // Handlers
  const handleToggleCollapse = useCallback((blockId: string) => {
    setBlocks(prevBlocks => toggleBlockCollapse(prevBlocks, blockId));
  }, []);

  const handlePageSwitch = useCallback(async (pagePath: string) => {
    const newBlocks = await handlePageSwitchBase(pagePath);
    if (newBlocks) {
      setBlocks(newBlocks);
    }
  }, [handlePageSwitchBase]);

  const handleMermaidNodeClick = useCallback((nodeId: string, metadata?: MermaidMetadata, blockId?: string) => {
    baseMermaidNodeClick(nodeId, metadata, blockId);
    if (blockId) {
      setHighlightedBlockId(blockId);
    }
  }, [baseMermaidNodeClick, setHighlightedBlockId]);

  const handleMermaidDoubleClick = useCallback((chart: string, metadata?: MermaidMetadata) => {
    openMermaidModal(chart, metadata);
  }, [openMermaidModal]);

  const saveToHistory = useCallback((userQuery: string, generatedBlocks: WikiBlock[], overridePagePath?: string, overrideWikiPages?: string[]) => {
    const finalPagePath = overridePagePath ?? currentPagePath;
    const finalWikiPages = overrideWikiPages ?? wikiPages;

    const record: WikiHistoryRecord = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      userQuery,
      modelId: selectedModel,
      pagePath: finalPagePath || undefined,
      wikiPages: finalWikiPages.length > 0 ? finalWikiPages : undefined,
      blocksCount: generatedBlocks.length
    };
    setWikiHistory(prev => [record, ...prev].slice(0, 50));
  }, [currentPagePath, wikiPages, selectedModel, setWikiHistory]);

  const handleQuestionConfirm = useCallback(async (selectedQuestions: ExpandedQuestion[]) => {
    setShowQuestionSelector(false);
    setIsLoading(true);

    const workflowMsgId = addAssistantMessage([`开始执行工作流，已选择 ${selectedQuestions.length} 个问题...`]);

    try {
      updateAssistantProgress(workflowMsgId, '正在执行工作流分析...');
      const workflowResult = await codenexusWikiService.executeWorkflow(
        currentUserQuery,
        selectedQuestions,
        (step) => updateAssistantProgress(workflowMsgId, step)
      );

      updateAssistantProgress(workflowMsgId, `生成了 ${workflowResult.wiki_pages.length} 个 Wiki 页面，正在加载...`);

      setWikiPages(workflowResult.wiki_pages);
      const firstPage = workflowResult.wiki_pages[0];
      setCurrentPagePath(firstPage);

      const wikiPage = await codenexusWikiService.fetchPage(firstPage);
      updateAssistantProgress(workflowMsgId, '解析 Wiki 对象结构...');

      const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
      setBlocks(parsedBlocks);

      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0;
        }
      });

      saveToHistory(currentUserQuery, parsedBlocks, firstPage, workflowResult.wiki_pages);

      let contentMessage = `已生成 ${TITLE_MAP[type]} 的完整分析报告，包含 ${parsedBlocks.length} 个交互式对象。`;
      if (workflowResult.wiki_pages.length > 1) {
        contentMessage += `\n\n📚 共生成 ${workflowResult.wiki_pages.length} 个页面，当前显示: ${firstPage.split('/').pop()}`;
      }
      contentMessage += `\n\n📁 Wiki 根目录: ${workflowResult.wiki_root}`;

      finalizeAssistantMessage(workflowMsgId, contentMessage);

    } catch (error) {
      console.error("Workflow Execution Failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      finalizeAssistantMessage(workflowMsgId, `工作流执行失败：\n${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserQuery, type, addAssistantMessage, updateAssistantProgress, setWikiPages, setCurrentPagePath, finalizeAssistantMessage, saveToHistory]);

  const handleQuestionCancel = useCallback(() => {
    setShowQuestionSelector(false);
    addSimpleMessage('assistant', '您已取消问题选择。请重新输入查询或选择其他操作。');
  }, [addSimpleMessage]);

  const handleAnalyze = useCallback(async () => {
    if (!prompt.trim()) return;
    const currentPrompt = prompt.trim();
    const currentSelectedIds = new Set(selectedBlockIds);
    const hasSelectedBlocks = currentSelectedIds.size > 0;

    setPrompt('');
    setIsLoading(true);

    const referencedBlocks = hasSelectedBlocks ? getReferencedBlocks() : [];

    addUserMessage(currentPrompt, referencedBlocks.length > 0 ? referencedBlocks : undefined);
    clearSelection();
    setIsChatExpanded(true);

    const assistantMsgId = addAssistantMessage(['初始化请求...']);

    try {
      const currentModelName = AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || selectedModel;
      let finalContent = '';

      // CodeNexus Wiki model
      if (selectedModel === 'codenexus-wiki') {
        if (hasSelectedBlocks && currentPagePath) {
          updateAssistantProgress(assistantMsgId, `检测到 ${currentSelectedIds.size} 个选中的块，正在执行块级细化...`);

          const blockIds = Array.from(currentSelectedIds);
          const response = await codenexusWikiService.detailedQuery(
            currentPagePath,
            blockIds,
            currentPrompt
          );

          if ('new_page_path' in response) {
            updateAssistantProgress(assistantMsgId, 'AI 建议创建新页面...');
            const parsedBlocks = parseWikiPageToBlocks(response.new_page.content, response.new_page.source);

            setWikiPages(prev => [...prev, response.new_page_path]);
            setCurrentPagePath(response.new_page_path);
            setBlocks(parsedBlocks);

            finalContent = `已创建新页面：${response.new_page_path}\n\n包含 ${parsedBlocks.length} 个对象。`;
          } else {
            updateAssistantProgress(assistantMsgId, 'AI 正在分析并生成修改建议...');

            const modifiedBlocks = await applyModifyPageResponse(response, blocks);
            enterDiffMode(modifiedBlocks, response);

            const insertCount = response.insert_blocks.length;
            const deleteCount = response.delete_blocks.length;

            finalContent = `已生成修改建议：\n- 新增 ${insertCount} 个块\n- 删除 ${deleteCount} 个块\n\n请查看差异预览，确认后点击"应用变更"。`;
          }

          finalizeAssistantMessage(assistantMsgId, finalContent);
          setIsLoading(false);
          return;
        }

        // CodeNexus Workflow - expand query
        updateAssistantProgress(assistantMsgId, '正在使用 CodeNexus AI 分析您的问题...');
        const questions = await codenexusWikiService.expandQuery(currentPrompt);

        setCurrentUserQuery(currentPrompt);
        setExpandedQuestions(questions);
        updateAssistantProgress(assistantMsgId, `生成了 ${questions.length} 个扩展问题，等待您的选择...`);

        setShowQuestionSelector(true);
        setIsLoading(false);

        setChatHistory(prev => prev.map(msg =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: `我已经为您生成了 ${questions.length} 个扩展问题，请选择您感兴趣的分析维度。`,
                steps: [...(msg.steps || []), '等待用户选择问题...']
              }
            : msg
        ));
        return;
      }

      // Other models (Gemini, etc.)
      if (hasSelectedBlocks) {
        const operations = await geminiService.refineBlocks(referencedBlocks, currentPrompt, selectedModel, (step) => updateAssistantProgress(assistantMsgId, step));

        updateAssistantProgress(assistantMsgId, '正在构建差异预览...');

        let newBlocks = [...blocks];
        let addedCount = 0;
        let updatedCount = 0;
        let deletedCount = 0;

        operations.forEach(op => {
          if (op.action === 'DELETE') {
            newBlocks = newBlocks.map(b => b.id === op.targetId ? { ...b, status: 'deleted' as const } : b);
            deletedCount++;
          }
          if (op.action === 'UPDATE' && op.content) {
            newBlocks = updateBlockContent(newBlocks, op.targetId, op.content);
            updatedCount++;
          }
          if (op.action === 'INSERT_AFTER' && op.content) {
            const { content: cleanContent, metadata } = parseSingleBlockUpdate(op.content);
            const newBlock: WikiBlock = {
              id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
              type: op.type || 'paragraph',
              content: cleanContent,
              level: op.level,
              status: 'inserted',
              metadata: metadata
            };
            newBlocks = insertBlockAfter(newBlocks, op.targetId, newBlock);
            addedCount++;
          }
        });

        enterDiffMode(newBlocks);
        finalContent = `已生成内容变更预览。请在文档底部审查变更，点击"应用变更"以生效。`;
      } else {
        const resultText = await geminiService.analyze(type, currentPrompt, selectedModel, (step) => updateAssistantProgress(assistantMsgId, step));
        updateAssistantProgress(assistantMsgId, '解析 Wiki 对象结构...');
        const parsedBlocks = parseMarkdownToBlocks(resultText);
        setBlocks(parsedBlocks);
        setIsDiffMode(false);
        finalContent = `已生成 ${TITLE_MAP[type]} 的完整分析报告，包含 ${parsedBlocks.length} 个交互式对象。`;
        saveToHistory(currentPrompt, parsedBlocks);
      }

      finalizeAssistantMessage(assistantMsgId, finalContent);

    } catch (error) {
      console.error("Analysis Failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      finalizeAssistantMessage(assistantMsgId, `执行过程中遇到了问题：\n${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [prompt, selectedBlockIds, getReferencedBlocks, addUserMessage, clearSelection, setIsChatExpanded, addAssistantMessage, selectedModel, currentPagePath, updateAssistantProgress, applyModifyPageResponse, blocks, enterDiffMode, finalizeAssistantMessage, setWikiPages, setCurrentPagePath, setChatHistory, type, saveToHistory, setIsDiffMode]);

  return (
    <div className={`h-full relative flex flex-col transition-colors duration-300 ${isDarkMode ? 'bg-[#0d1117]' : 'bg-[#F5F5F7]'}`}>
      {/* Mermaid Modal */}
      <MermaidModal
        isOpen={mermaidModalOpen}
        chart={mermaidModalChart}
        metadata={mermaidModalMetadata}
        zoom={mermaidModalZoom}
        position={mermaidModalPosition}
        size={mermaidModalSize}
        contentRef={mermaidContentRef}
        isDragging={!!isMermaidDraggingRef.current}
        isSourcePanelOpen={isSourcePanelOpen}
        onClose={closeMermaidModal}
        onNodeClick={(nodeId: string) => handleMermaidNodeClick(nodeId, mermaidModalMetadata)}
        onResizeStart={handleMermaidResizeStart}
        onMoveStart={handleMermaidMoveStart}
        onContentDragStart={handleMermaidContentDragStart}
        onWheel={handleMermaidWheel}
      />

      <SourceCodePanel
        isOpen={isSourcePanelOpen}
        onClose={() => { closeSourcePanel(); }}
        location={activeSourceLocation}
        panelWidth={sourcePanelWidth}
        onWidthChange={setSourcePanelWidth}
      />

      {/* Main Content Area */}
      <div
        ref={mainContentRef}
        className="flex-1 overflow-hidden w-full pb-[200px]"
        style={{ paddingRight: isSourcePanelOpen ? sourcePanelWidth : 0 }}
      >
        {!hasContent && (
          <div className="min-h-[50vh] flex flex-col items-center justify-center px-6 animate-in fade-in duration-700 pt-10 relative">
            {/* Dark Mode Toggle */}
            <div className="absolute top-6 right-6">
              <button
                onClick={toggleDarkMode}
                className={`flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
                  isDarkMode
                    ? 'bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]'
                    : 'bg-white/60 text-[#86868b] hover:bg-white hover:text-[#1d1d1f] shadow-sm'
                }`}
                title={isDarkMode ? '切换到亮色模式' : '切换到暗色模式'}
              >
                {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
            <div className={`w-16 h-16 rounded-[1.5rem] shadow-xl mb-6 flex items-center justify-center text-white ${
              isDarkMode ? 'bg-gradient-to-tr from-[#58a6ff] to-[#79c0ff]' : 'bg-gradient-to-tr from-[#0071E3] to-[#5AC8FA]'
            }`}>
              <Sparkles size={32} />
            </div>
            <h2 className={`text-3xl font-semibold mb-3 tracking-tight text-center ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>
              {TITLE_MAP[type]}
            </h2>
            <p className={`text-base font-light max-w-lg text-center leading-relaxed ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
              选择下方建议或输入指令，AI 将生成可交互的 WIKI 对象。
            </p>
          </div>
        )}

        {blocks.length > 0 && (
          <div className="px-4 md:px-12 pt-8">
            <WikiContent
              blocks={blocks}
              selectedBlockIds={selectedBlockIds}
              isDiffMode={isDiffMode}
              isLoadingPage={isLoadingPage}
              onToggleSelect={toggleBlockSelection}
              onToggleCollapse={handleToggleCollapse}
              onMermaidNodeClick={handleMermaidNodeClick}
              onSourceClick={handleSourceClick}
              onMermaidDoubleClick={handleMermaidDoubleClick}
              highlightedBlockId={highlightedBlockId}
              highlightedMermaidNodeId={highlightedMermaidNodeId}
              wikiPages={wikiPages}
              currentPagePath={currentPagePath}
              isNavigatorVisible={isNavigatorVisible}
              onPageSwitch={handlePageSwitch}
              onToggleNavigator={() => setIsNavigatorVisible(!isNavigatorVisible)}
              onBlockClick={(blockId) => {
                document.getElementById(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              headerLabel="交互式代码Wiki"
              headerIcon="sparkles"
              variant="blue"
            />
            <div ref={contentEndRef} />
          </div>
        )}
      </div>

      {/* Unified Chat Deck (Bottom Sheet) */}
      <div
        className={`fixed bottom-0 ${isSidebarCollapsed ? 'left-16' : 'left-64'} z-50 flex flex-col items-center transition-all duration-300 ease-apple-ease`}
        style={{ right: isSourcePanelOpen ? sourcePanelWidth : 0 }}
      >
        {/* Diff Confirmation Bar (Floating) */}
        {isDiffMode && (
          <DiffConfirmBar
            onApply={applyDiffChanges}
            onDiscard={discardDiffChanges}
            variant="floating"
          />
        )}

        {/* Main Chat Container */}
        <div
          className={`relative backdrop-blur-xl border flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${hasContent ? 'rounded-t-[2rem]' : 'rounded-[2rem] mb-10'} ${!isChatExpanded && hasContent ? 'translate-y-[calc(100%-110px)]' : 'translate-y-0'} ${
            isDarkMode
              ? 'bg-[#161b22]/90 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] border-[#30363d]'
              : 'bg-white/85 shadow-[0_-10px_40px_rgba(0,0,0,0.08)] border-white/50'
          }`}
          style={hasContent ? { width: chatWidth, height: isChatExpanded ? chatHeight : 110, maxHeight: '90vh', minWidth: 400, willChange: isChatDraggingRef.current ? 'width, height' : 'auto' } : { width: 768 }}
        >
          {/* Resize handles */}
          {hasContent && (
            <>
              <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-200/50 z-10" {...getResizeHandlers('left')} />
              <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-200/50 z-10" {...getResizeHandlers('right')} />
              <div className="absolute top-0 left-2 right-2 h-2 cursor-ns-resize hover:bg-blue-200/50 z-10" {...getResizeHandlers('top')} />
            </>
          )}

          {/* Drag Handle for Collapse/Expand */}
          {hasContent && (
            <div
              className="w-full flex justify-center py-3 cursor-pointer hover:bg-black/5 transition-colors group"
              onClick={() => setIsChatExpanded(!isChatExpanded)}
            >
              <div className={`w-12 h-1.5 rounded-full transition-colors ${isDarkMode ? 'bg-[#484f58] group-hover:bg-[#6e7681]' : 'bg-[#d2d2d7] group-hover:bg-[#aeaeb2]'}`} />
            </div>
          )}

          {/* Chat History Area */}
          <div
            className={`flex-1 overflow-y-auto scroll-smooth px-6 transition-all duration-300 ${!isChatExpanded && hasContent ? 'h-0 opacity-0 py-0 flex-none' : 'opacity-100 py-4'}`}
            ref={chatScrollRef}
          >
            {chatHistory.map((msg) => (
              <ChatMessage key={msg.id} message={msg} isLoading={isLoading} variant="blue" />
            ))}

            {/* Question Selector */}
            {showQuestionSelector && (
              <div className="flex w-full mb-6 justify-start">
                <div className="flex flex-col items-start max-w-[90%]">
                  <div className="flex items-center gap-2 mb-1.5 ml-1">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#0071E3] to-[#5AC8FA] flex items-center justify-center text-white shadow-sm">
                      <Bot size={14} />
                    </div>
                  </div>
                  <QuestionSelector
                    questions={expandedQuestions}
                    userQuery={currentUserQuery}
                    onConfirm={handleQuestionConfirm}
                    onCancel={handleQuestionCancel}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Selection Bar */}
          {hasSelection && (
            <SelectionBar
              selectedBlockIds={selectedBlockIds}
              blocks={blocks}
              onToggleSelect={toggleBlockSelection}
              onClear={clearSelection}
              variant="chat"
            />
          )}

          {/* Input Area */}
          <div className={`relative w-full p-4 backdrop-blur-md border-t ${
            isDarkMode ? 'bg-[#0d1117]/50 border-[#30363d]' : 'bg-white/50 border-white/50'
          }`}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={hasSelection ? "针对选中的内容，请输入您的修改建议..." : "描述分析需求..."}
              className={`w-full bg-transparent outline-none resize-none font-light transition-all duration-300 ${hasContent ? 'text-base min-h-[50px] max-h-[120px]' : 'text-lg min-h-[80px]'} ${
                isDarkMode ? 'text-[#e6edf3] placeholder:text-[#7d8590]/50' : 'text-[#1d1d1f] placeholder:text-[#86868b]/50'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAnalyze();
                }
              }}
            />

            <div className="flex justify-between items-center mt-2">
              {/* Model Selector */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs transition-colors ${
                      isDarkMode
                        ? 'bg-[#21262d]/50 hover:bg-[#21262d] border-[#30363d] text-[#e6edf3]'
                        : 'bg-gray-100/50 hover:bg-gray-100 border-gray-200/50 text-[#1d1d1f]'
                    }`}
                  >
                    <Cpu size={12} className={isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'} />
                    {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}
                    <ChevronUp size={12} className={`text-gray-400 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isModelMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-[100]" onClick={() => setIsModelMenuOpen(false)} />
                      <div className={`absolute bottom-full left-0 mb-2 w-48 rounded-xl shadow-apple-hover border overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-[101] ${
                        isDarkMode ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-gray-100'
                      }`}>
                        {AVAILABLE_MODELS.map(model => (
                          <button
                            key={model.id}
                            onClick={() => {
                              setSelectedModel(model.id);
                              setIsModelMenuOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between transition-colors ${
                              selectedModel === model.id
                                ? isDarkMode
                                  ? 'text-[#58a6ff] font-medium bg-[#58a6ff]/10'
                                  : 'text-[#0071E3] font-medium bg-blue-50/50'
                                : isDarkMode
                                  ? 'text-[#e6edf3] hover:bg-[#21262d]'
                                  : 'text-[#1d1d1f] hover:bg-gray-50'
                            }`}
                          >
                            {model.name}
                            {selectedModel === model.id && <Check size={12} className={isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'} />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {prompt && !isLoading && (
                  <button
                    onClick={() => setPrompt('')}
                    className={`p-2 rounded-full transition-colors ${
                      isDarkMode
                        ? 'text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#21262d]'
                        : 'text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-100'
                    }`}
                  >
                    <Eraser size={16} />
                  </button>
                )}
                <button
                  onClick={handleAnalyze}
                  disabled={!prompt.trim() || isLoading}
                  className={`text-white rounded-full flex items-center justify-center transition-all duration-200 shadow-md w-8 h-8 ${
                    isDarkMode
                      ? 'bg-[#238636] hover:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#484f58]'
                      : 'bg-[#0071E3] hover:bg-[#0077ED] disabled:bg-[#e5e5ea] disabled:text-[#86868b]'
                  }`}
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={3} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Suggestions (Only shown when empty) */}
        {!hasContent && (
          <div className="w-full max-w-3xl mt-4 px-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setPrompt(s)}
                  className={`text-left px-4 py-3 border rounded-xl text-xs transition-all shadow-sm hover:shadow-md ${
                    isDarkMode
                      ? 'bg-[#21262d]/60 hover:bg-[#21262d] border-[#30363d] hover:border-[#58a6ff]/50 text-[#7d8590] hover:text-[#58a6ff]'
                      : 'bg-white/60 hover:bg-white border-gray-200/50 hover:border-blue-200 text-gray-600 hover:text-[#0071E3]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisView;
