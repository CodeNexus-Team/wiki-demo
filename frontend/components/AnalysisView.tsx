import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisType, WikiBlock, MermaidMetadata, ExpandedQuestion, WikiHistoryRecord, ModifyPageResponse } from '../types';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { wikiPageCache } from '../services/wikiPageCache';
import { parseWikiPageToBlocks } from '../utils/wikiContentParser';
import { toggleBlockCollapse } from '../utils/blockOperations';

// Hooks
import {
  useBlockSelection,
  useDiffMode,
  useChatHistory,
  useSourcePanel,
  useWikiPages,
  useMermaidModal,
  useResizablePanel,
  usePageTabs
} from '../hooks';
import { useWikiTheme } from '../hooks/useWikiTheme';

// Components
import SourceCodePanel from './SourceCodePanel';
import PageTabBar from './PageTabBar';
import QuestionSelector from './QuestionSelector';
import { ChatMessage, DiffConfirmBar, SelectionBar } from './chat';
import { WikiContent } from './wiki';
import { MermaidModal } from './mermaid/MermaidModal';

import {
  Loader2,
  ArrowUp,
  ArrowLeft,
  Sparkles,
  Eraser,
  Bot,
  Sun,
  Moon,
  X
} from 'lucide-react';

export interface InitialWikiData {
  pagePath: string;
  wikiPages: string[];
}

interface AnalysisViewProps {
  type: AnalysisType;
  wikiHistory: WikiHistoryRecord[];
  setWikiHistory: React.Dispatch<React.SetStateAction<WikiHistoryRecord[]>>;
  selectedHistoryRecord: WikiHistoryRecord | null;
  onHistoryLoaded: () => void;
  isSidebarCollapsed?: boolean;
  onBack?: () => void;
  initialWikiData?: InitialWikiData | null;
}

const TITLE_MAP: Record<AnalysisType, string> = {
  [AnalysisType.DASHBOARD]: '仪表盘',
  [AnalysisType.WIKI_BROWSER]: '生成Wiki',
  [AnalysisType.ARCHITECTURE]: '架构视图',
  [AnalysisType.API_ANALYSIS]: '接口分析',
  [AnalysisType.BUSINESS_FLOW]: '业务流',
  [AnalysisType.CONTROL_FLOW]: '控制流',
  [AnalysisType.DATABASE]: '数据库模型',
};

const AnalysisView: React.FC<AnalysisViewProps> = ({ type, wikiHistory, setWikiHistory, selectedHistoryRecord, onHistoryLoaded, isSidebarCollapsed = false, onBack, initialWikiData }) => {
  // Theme
  const { isDarkMode, toggleDarkMode } = useWikiTheme();

  // Local State
  const [isLoading, setIsLoading] = useState(false);
  const [prompt, setPrompt] = useState<string>('');
  const [blocks, setBlocks] = useState<WikiBlock[]>([]);

  // 澄清机制：当 Agent 需要用户回答时，存储 resolve 回调和选项列表
  const clarificationResolverRef = useRef<((answer: string) => void) | null>(null);
  const setClarificationResolver = (resolver: (answer: string) => void) => {
    clarificationResolverRef.current = resolver;
  };
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // CodeNexus Workflow State
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<ExpandedQuestion[]>([]);
  const [currentUserQuery, setCurrentUserQuery] = useState<string>('');

  // Refs
  const contentEndRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const justLoadedHistoryRef = useRef(false);
  // Agent 会话 ID：用于追问时 --resume 恢复上下文
  const agentSessionIdRef = useRef<string | null>(null);
  /** 清理 Claude CLI session 本地文件并重置 ref */
  const clearAgentSession = useCallback(() => {
    if (agentSessionIdRef.current) {
      codenexusWikiService.cleanupSession(agentSessionIdRef.current);
      agentSessionIdRef.current = null;
    }
  }, []);
  // 待自动执行的 query（来自 wiki 概览页的提问入口）
  const pendingAutoQueryRef = useRef<string | null>(null);
  // 纯 QA 模式下模型主动提出的修改建议，等待用户在气泡按钮上确认
  // key: 聊天消息 id，value: 触发 enterDiffMode 需要的快照
  const pendingSuggestEditsRef = useRef<Map<string, {
    response: ModifyPageResponse;
    queryBlocks: WikiBlock[];
    queryPagePath: string;
  }>>(new Map());

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

  /** 把某条 suggestEdit 标记为已解析，并从 ref 中移除 */
  const resolveSuggestEdit = useCallback((messageId: string, resolution: 'confirmed' | 'discarded') => {
    pendingSuggestEditsRef.current.delete(messageId);
    setChatHistory(prev => prev.map(m =>
      m.id === messageId && m.suggestEdit
        ? { ...m, suggestEdit: { ...m.suggestEdit, resolution } }
        : m
    ));
  }, [setChatHistory]);

  const wikiPagesHook = useWikiPages({
    mainContentRef,
    onPageLoaded: (newBlocks) => {
      // Don't overwrite blocks if diff mode is active (e.g. detailedQuery
      // response arrived while a page load was still in flight)
      if (isDiffModeRef.current) return;
      setBlocks(newBlocks);
      setSelectedBlockIds(new Set());
      // Wiki 页面加载后，收起对话框为浮动图标
      setIsChatOpen(false);
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
    loadPage,
    cancelPendingLoad,
  } = wikiPagesHook;

  // Always-fresh refs for values needed after async awaits (closures go stale)
  const currentPagePathRef = useRef(currentPagePath);
  currentPagePathRef.current = currentPagePath;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const isDiffModeRef = useRef(false);

  // Page Tabs
  const pageTabs = usePageTabs({
    getScrollPosition: () => mainContentRef.current?.scrollTop ?? 0,
    setScrollPosition: (pos) => {
      if (mainContentRef.current) {
        mainContentRef.current.scrollTop = pos;
      }
    },
  });
  const {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    switchTab,
    updateTabState,
    getTabState,
    saveCurrentTabState,
    clearTabs,
    forceActivateTab,
    saveTabStateById,
  } = pageTabs;

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
  isDiffModeRef.current = isDiffMode;

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
          // Create tab for loaded history page
          clearTabs();
          openTab(pagePath, parsedBlocks);
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
  }, [selectedHistoryRecord, onHistoryLoaded, setCurrentPagePath, setWikiPages, setSelectedBlockIds, setIsDiffMode, setIsChatExpanded, clearTabs, openTab]);

  // Load initial wiki data (from WikiBrowser click, same flow as post-workflow)
  useEffect(() => {
    if (!initialWikiData) return;

    const loadInitialWiki = async () => {
      setWikiPages(initialWikiData.wikiPages);
      setCurrentPagePath(initialWikiData.pagePath);
      setSelectedBlockIds(new Set());
      setIsDiffMode(false);
      setIsChatExpanded(false);
      setIsChatOpen(false);

      try {
        const wikiPage = await codenexusWikiService.fetchPage(initialWikiData.pagePath);
        const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
        setBlocks(parsedBlocks);
        clearTabs();
        openTab(initialWikiData.pagePath, parsedBlocks);
      } catch (error) {
        console.error('[InitialWiki] Failed to fetch page:', error);
        setBlocks([]);
      }
    };

    loadInitialWiki();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWikiData]);

  // Reset state on type change
  useEffect(() => {
    if (selectedHistoryRecord) return;
    if (initialWikiData) return;
    if (justLoadedHistoryRef.current) {
      justLoadedHistoryRef.current = false;
      return;
    }

    setIsLoading(false);
    setBlocks([]);
    setPrompt('');
    clearHistory();
    setSuggestions([]);
    setIsChatExpanded(true);
    closeSourcePanel();
    setSelectedBlockIds(new Set());
    setIsDiffMode(false);
    clearAgentSession();
  }, [type, selectedHistoryRecord, initialWikiData, clearHistory, setIsChatExpanded, closeSourcePanel, setSelectedBlockIds, setIsDiffMode, clearAgentSession]);

  // Scroll to content end when blocks change (skip for direct wiki loading)
  useEffect(() => {
    if (initialWikiData) return;
    if (blocks.length > 0 && chatHistory.length === 0) {
      contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [blocks, chatHistory.length, initialWikiData]);

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
  const hasChatContent = chatHistory.length > 0;
  // 默认收起为小图标，有内容时（无 wiki 页面 / 初始状态）或用户点击时展开
  const [isChatOpen, setIsChatOpen] = useState(!blocks.length);
  const [showFabTip, setShowFabTip] = useState(true);

  // Handlers
  const handleToggleCollapse = useCallback((blockId: string) => {
    setBlocks(prevBlocks => toggleBlockCollapse(prevBlocks, blockId));
  }, []);

  const handlePageSwitch = useCallback(async (pagePath: string, autoQuery?: string) => {
    // 暂存待自动执行的提问，页面加载完后由 effect 触发 handleAnalyze
    if (autoQuery) {
      pendingAutoQueryRef.current = autoQuery;
    }

    // Save current tab state before switching
    if (activeTabId) {
      saveCurrentTabState(blocks, selectedBlockIds);
    }

    // Check if tab already exists
    const existingTab = tabs.find(t => t.pagePath === pagePath);
    if (existingTab) {
      // Switch to existing tab and restore state
      await switchTab(existingTab.id);
      const cachedState = getTabState(existingTab.id);
      if (cachedState) {
        setBlocks(cachedState.blocks);
        setSelectedBlockIds(cachedState.selectedBlockIds);
        setCurrentPagePath(pagePath);
      }
      return;
    }

    // Load new page and create tab
    const newBlocks = await handlePageSwitchBase(pagePath);
    if (newBlocks) {
      setBlocks(newBlocks);
      openTab(pagePath, newBlocks);
    }
  }, [handlePageSwitchBase, activeTabId, tabs, saveCurrentTabState, switchTab, getTabState, openTab, blocks, selectedBlockIds, setCurrentPagePath, setSelectedBlockIds]);

  const handleTabClick = useCallback(async (tabId: string) => {
    if (tabId === activeTabId) return;

    // Save current tab state
    if (activeTabId) {
      saveCurrentTabState(blocks, selectedBlockIds);
    }

    // Restore target tab state
    const cachedState = getTabState(tabId);
    if (cachedState) {
      setBlocks(cachedState.blocks);
      setSelectedBlockIds(cachedState.selectedBlockIds);
      const targetTab = tabs.find(t => t.id === tabId);
      if (targetTab) {
        setCurrentPagePath(targetTab.pagePath);
      }
    }

    await switchTab(tabId);
  }, [activeTabId, tabs, saveCurrentTabState, getTabState, switchTab, blocks, selectedBlockIds, setCurrentPagePath]);

  const handleTabClose = useCallback((tabId: string) => {
    if (tabs.length <= 1) return;

    const tabIndex = tabs.findIndex(t => t.id === tabId);
    const isActiveTab = tabId === activeTabId;

    closeTab(tabId);

    // If closing active tab, switch to adjacent tab
    if (isActiveTab && tabs.length > 1) {
      const newActiveIndex = Math.min(tabIndex, tabs.length - 2);
      const newActiveTab = tabs.filter(t => t.id !== tabId)[newActiveIndex];
      if (newActiveTab) {
        const cachedState = getTabState(newActiveTab.id);
        if (cachedState) {
          setBlocks(cachedState.blocks);
          setSelectedBlockIds(cachedState.selectedBlockIds);
          setCurrentPagePath(newActiveTab.pagePath);
        }
      }
    }
  }, [tabs, activeTabId, closeTab, getTabState, setCurrentPagePath]);

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
      modelId: 'codenexus-wiki',
      pagePath: finalPagePath || undefined,
      wikiPages: finalWikiPages.length > 0 ? finalWikiPages : undefined,
      blocksCount: generatedBlocks.length
    };
    setWikiHistory(prev => [record, ...prev].slice(0, 50));
  }, [currentPagePath, wikiPages, setWikiHistory]);

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

      // Clear existing tabs and create new tab for the first page
      clearTabs();
      openTab(firstPage, parsedBlocks);

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

    // 如果有待处理的澄清问题，将用户输入作为回答提交
    if (clarificationResolverRef.current) {
      const resolver = clarificationResolverRef.current;
      clarificationResolverRef.current = null;
      addUserMessage(currentPrompt);
      setPrompt('');
      // 清除气泡中的选项按钮
      setChatHistory(prev => prev.map(m =>
        m.clarificationOptions ? { ...m, clarificationOptions: undefined } : m
      ));
      resolver(currentPrompt);
      return;
    }

    const currentSelectedIds = new Set(selectedBlockIds);
    const hasSelectedBlocks = currentSelectedIds.size > 0;

    setPrompt('');
    setIsLoading(true);

    const referencedBlocks = hasSelectedBlocks ? getReferencedBlocks() : [];

    addUserMessage(currentPrompt, referencedBlocks.length > 0 ? referencedBlocks : undefined);
    clearSelection();
    setIsChatOpen(true);
    setIsChatExpanded(true);

    const assistantMsgId = addAssistantMessage(['初始化请求...']);

    try {
      let finalContent = '';

      if (hasSelectedBlocks && currentPagePath) {
          updateAssistantProgress(assistantMsgId, `检测到 ${currentSelectedIds.size} 个选中的块，正在执行块级细化...`);

          const blockIds = Array.from(currentSelectedIds);
          // Snapshot the page and blocks at request time
          const queryPagePath = currentPagePath;
          const queryBlocks = [...blocks];

          const response = await codenexusWikiService.detailedQuery(
            queryPagePath,
            blockIds,
            currentPrompt,
            (msg) => updateAssistantProgress(assistantMsgId, msg),
            async (question, options, multiSelect) => {
              // Agent 需要澄清：在聊天气泡中展示问题和可选项
              setChatHistory(prev => prev.map(msg =>
                msg.id === assistantMsgId
                  ? { ...msg, content: `💬 ${question}`, steps: [...(msg.steps || []), 'Done'], clarificationOptions: options, clarificationMultiSelect: multiSelect }
                  : msg
              ));

              return new Promise<string>((resolve) => {
                setClarificationResolver(resolve);
              });
            }
          );

          // --- After await: all closure-captured values may be stale ---
          // Use refs (currentPagePathRef, blocksRef) for current state.
          // Use closure-free methods (forceActivateTab, saveTabStateById, setBlocks,
          // setCurrentPagePath) which are state setters / have no stale deps.

          // 保存 session_id 供后续追问
          agentSessionIdRef.current = response.session_id ?? null;

          if ('qa_answer' in response) {
            // 模型判定为提问 → 直接展示回答
            finalContent = response.qa_answer;
          } else if ('new_page_path' in response) {
            updateAssistantProgress(assistantMsgId, 'AI 建议创建新页面...');
            const parsedBlocks = parseWikiPageToBlocks(response.new_page.content, response.new_page.source);

            setWikiPages(prev => [...prev, response.new_page_path]);
            setCurrentPagePath(response.new_page_path);
            setBlocks(parsedBlocks);

            // Create tab for new page
            openTab(response.new_page_path, parsedBlocks);

            finalContent = `已创建新页面：${response.new_page_path}\n\n包含 ${parsedBlocks.length} 个对象。`;
          } else {
            updateAssistantProgress(assistantMsgId, 'AI 正在分析并生成修改建议...');

            // IMMEDIATELY cancel any in-flight page loads and mark diff mode
            // BEFORE yielding execution via await. This prevents page load
            // completions from overwriting blocks during the yield.
            cancelPendingLoad();
            isDiffModeRef.current = true;

            // If user switched away, save their current page state
            const livePagePath = currentPagePathRef.current;
            if (livePagePath !== queryPagePath) {
              saveTabStateById(livePagePath, blocksRef.current, new Set());
              setCurrentPagePath(queryPagePath);
              forceActivateTab(queryPagePath);
            }

            // Use the snapshotted blocks from request time, not current (possibly stale) blocks
            const modifiedBlocks = await applyModifyPageResponse(response, queryBlocks);

            // Enter diff mode with correct original blocks snapshot
            enterDiffMode(modifiedBlocks, response, queryBlocks);

            const replaceCount = response.replace_blocks?.length ?? 0;
            const insertCount = response.insert_blocks.length;
            const deleteCount = response.delete_blocks.length;

            const parts: string[] = [];
            if (replaceCount > 0) parts.push(`替换 ${replaceCount} 个块`);
            if (insertCount > 0) parts.push(`新增 ${insertCount} 个块`);
            if (deleteCount > 0) parts.push(`删除 ${deleteCount} 个块`);

            finalContent = parts.length > 0
              ? `已生成修改建议：\n- ${parts.join('\n- ')}\n\n请查看差异预览，确认后点击"应用变更"。`
              : `未检测到需要修改的内容。`;
          }

          finalizeAssistantMessage(assistantMsgId, finalContent);
          setIsLoading(false);
          return;
        }

        // 有页面时 → 追问/自由问答；无页面时 → 生成 Wiki 工作流
        if (currentPagePath) {
          const hasSession = !!agentSessionIdRef.current;
          updateAssistantProgress(assistantMsgId, hasSession ? '正在追问...' : '正在分析您的问题...');

          if (hasSession) {
            // 有上次会话 → 通过 detailedQuery + resume 保持上下文
            const queryPagePath = currentPagePath;
            const queryBlocks = [...blocks];

            const response = await codenexusWikiService.detailedQuery(
              queryPagePath,
              [],
              currentPrompt,
              (msg) => updateAssistantProgress(assistantMsgId, msg),
              async (question, options, multiSelect) => {
                // 追问中触发澄清：复用同一聊天气泡展示选项
                setChatHistory(prev => prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: `💬 ${question}`, steps: [...(msg.steps || []), 'Done'], clarificationOptions: options, clarificationMultiSelect: multiSelect }
                    : msg
                ));
                return new Promise<string>((resolve) => {
                  setClarificationResolver(resolve);
                });
              },
              agentSessionIdRef.current!
            );
            agentSessionIdRef.current = response.session_id ?? null;

            if ('qa_answer' in response) {
              finalContent = response.qa_answer;
            } else if ('new_page_path' in response) {
              const parsedBlocks = parseWikiPageToBlocks(response.new_page.content, response.new_page.source);
              setWikiPages(prev => [...prev, response.new_page_path]);
              setCurrentPagePath(response.new_page_path);
              setBlocks(parsedBlocks);
              openTab(response.new_page_path, parsedBlocks);
              finalContent = `已创建新页面：${response.new_page_path}\n\n包含 ${parsedBlocks.length} 个对象。`;
            } else {
              // 模型在追问中输出了修改指令 → 进入 diff 模式
              cancelPendingLoad();
              isDiffModeRef.current = true;
              const livePagePath = currentPagePathRef.current;
              if (livePagePath !== queryPagePath) {
                saveTabStateById(livePagePath, blocksRef.current, new Set());
                setCurrentPagePath(queryPagePath);
                forceActivateTab(queryPagePath);
              }
              const modifiedBlocks = await applyModifyPageResponse(response, queryBlocks);
              enterDiffMode(modifiedBlocks, response, queryBlocks);
              clearAgentSession(); // 进入 diff 后清除 session

              const replaceCount = response.replace_blocks?.length ?? 0;
              const insertCount = response.insert_blocks.length;
              const deleteCount = response.delete_blocks.length;
              const parts: string[] = [];
              if (replaceCount > 0) parts.push(`替换 ${replaceCount} 个块`);
              if (insertCount > 0) parts.push(`新增 ${insertCount} 个块`);
              if (deleteCount > 0) parts.push(`删除 ${deleteCount} 个块`);
              finalContent = parts.length > 0
                ? `已生成修改建议：\n- ${parts.join('\n- ')}\n\n请查看差异预览，确认后点击"应用变更"。`
                : `未检测到需要修改的内容。`;
            }
            finalizeAssistantMessage(assistantMsgId, finalContent);
            setIsLoading(false);
            return;
          } else {
            // 无上次会话 → 走原有 qaQuery
            const queryPagePathQa = currentPagePath;
            const queryBlocksQa = [...blocks];

            const qaResult = await codenexusWikiService.qaQuery(
              queryPagePathQa,
              currentPrompt,
              (msg) => updateAssistantProgress(assistantMsgId, msg),
              async (question, options, multiSelect) => {
                setChatHistory(prev => prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: `💬 ${question}`, steps: [...(msg.steps || []), 'Done'], clarificationOptions: options, clarificationMultiSelect: multiSelect }
                    : msg
                ));
                return new Promise<string>((resolve) => {
                  setClarificationResolver(resolve);
                });
              }
            );
            agentSessionIdRef.current = qaResult.session_id ?? null;

            // 判断模型输出的两种修改路径:
            //   A. 纯修改 (intent=modify): qaResult.answer 为空 + 有 edit ops → 直接进 diff 模式
            //   B. QA + 顺手建议 (intent=question 且通过工具发现 wiki 不准): answer 有文字 + 有 edit ops
            //      → 在气泡上挂"应用"按钮,等用户点击
            const replaceCountQa = qaResult.replace_blocks?.length ?? 0;
            const insertCountQa = qaResult.insert_blocks?.length ?? 0;
            const deleteCountQa = qaResult.delete_blocks?.length ?? 0;
            const hasEditOps = replaceCountQa + insertCountQa + deleteCountQa > 0;
            const hasAnswerText = (qaResult.answer ?? '').trim().length > 0;

            if (hasEditOps && !hasAnswerText) {
              // 纯修改: 直接进 diff 模式
              cancelPendingLoad();
              isDiffModeRef.current = true;
              const livePagePath = currentPagePathRef.current;
              if (livePagePath !== queryPagePathQa) {
                saveTabStateById(livePagePath, blocksRef.current, new Set());
                setCurrentPagePath(queryPagePathQa);
                forceActivateTab(queryPagePathQa);
              }
              const modifyResponse: ModifyPageResponse = {
                insert_blocks: qaResult.insert_blocks,
                delete_blocks: qaResult.delete_blocks,
                replace_blocks: qaResult.replace_blocks,
                insert_sources: qaResult.insert_sources,
                delete_sources: qaResult.delete_sources,
              };
              const modifiedBlocks = await applyModifyPageResponse(modifyResponse, queryBlocksQa);
              enterDiffMode(modifiedBlocks, modifyResponse, queryBlocksQa);
              clearAgentSession();

              const summaryParts: string[] = [];
              if (replaceCountQa > 0) summaryParts.push(`替换 ${replaceCountQa} 个块`);
              if (insertCountQa > 0) summaryParts.push(`新增 ${insertCountQa} 个块`);
              if (deleteCountQa > 0) summaryParts.push(`删除 ${deleteCountQa} 个块`);
              const summary = summaryParts.length > 0
                ? `已生成修改建议:\n- ${summaryParts.join('\n- ')}\n\n请查看差异预览,确认后点击"应用变更"。`
                : '未检测到需要修改的内容。';
              finalizeAssistantMessage(assistantMsgId, summary);
              setIsLoading(false);
              return;
            }

            if (hasEditOps) {
              // QA + 顺手建议: 答案有正文 + 模型主动提议的修改 → 挂"应用"按钮
              const suggestResponse: ModifyPageResponse = {
                insert_blocks: qaResult.insert_blocks,
                delete_blocks: qaResult.delete_blocks,
                replace_blocks: qaResult.replace_blocks,
                insert_sources: qaResult.insert_sources,
                delete_sources: qaResult.delete_sources,
              };
              pendingSuggestEditsRef.current.set(assistantMsgId, {
                response: suggestResponse,
                queryBlocks: queryBlocksQa,
                queryPagePath: queryPagePathQa,
              });
              setChatHistory(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: qaResult.answer,
                      steps: [...(m.steps || []), 'Done'],
                      suggestEdit: {
                        replaceCount: replaceCountQa,
                        insertCount: insertCountQa,
                        deleteCount: deleteCountQa,
                        resolution: 'pending',
                      },
                    }
                  : m
              ));
              setIsLoading(false);
              return;
            }

            finalizeAssistantMessage(assistantMsgId, qaResult.answer);
          }
        } else {
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
        }
        return;

    } catch (error) {
      console.error("Analysis Failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      finalizeAssistantMessage(assistantMsgId, `执行过程中遇到了问题：\n${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [prompt, selectedBlockIds, getReferencedBlocks, addUserMessage, clearSelection, setIsChatExpanded, addAssistantMessage, currentPagePath, updateAssistantProgress, applyModifyPageResponse, blocks, enterDiffMode, finalizeAssistantMessage, setWikiPages, setCurrentPagePath, setChatHistory, type, saveToHistory, setIsDiffMode, openTab, clearTabs, forceActivateTab, saveTabStateById, cancelPendingLoad]);

  // 自动执行待处理的 query：页面加载完成后从 ref 取出，写入 prompt 并触发 handleAnalyze
  useEffect(() => {
    if (!pendingAutoQueryRef.current) return;
    if (isLoadingPage) return;

    const queryToRun = pendingAutoQueryRef.current;
    pendingAutoQueryRef.current = null;
    // 打开聊天面板，预填 prompt，下一帧触发 handleAnalyze
    setIsChatOpen(true);
    setIsChatExpanded(true);
    setPrompt(queryToRun);
    // 用 setTimeout 让 React 把 prompt 状态先 flush 进去
    setTimeout(() => handleAnalyze(), 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPagePath, isLoadingPage, blocks]);

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
        isDarkMode={isDarkMode}
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
          <div className="flex flex-col flex-1 min-h-0 px-2 md:px-4 pt-2">
            {/* 返回按钮（从 WikiBrowser 进入时显示） */}
            {onBack && (
              <div className="mb-3 flex-shrink-0">
                <button
                  onClick={onBack}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                    isDarkMode
                      ? 'hover:bg-[#21262d] text-[#7d8590] hover:text-[#e6edf3]'
                      : 'hover:bg-[rgba(0,0,0,0.04)] text-[#86868b] hover:text-[#1d1d1f]'
                  }`}
                >
                  <ArrowLeft size={16} />
                  返回 Wiki 列表
                </button>
              </div>
            )}
            {/* Unified Card Container */}
            <div className={`
              relative flex flex-col flex-1 min-h-0 rounded-xl border backdrop-blur-xl overflow-hidden
              ${isDarkMode
                ? 'bg-[#0d1117]/90 border-[#30363d]'
                : 'bg-white/20 border-white/30'
              }
            `}>
              {/* AI 助手按钮 — 固定在卡片右上角，不随内容滚动 */}
              {!isChatOpen && hasContent && (
                <div className="absolute z-20 flex items-center gap-1.5" style={{ top: '7%', right: '18%' }}>
                  {showFabTip && (
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap ${
                      isDarkMode
                        ? 'bg-[#161b22] text-[#7d8590] border border-[#30363d]'
                        : 'bg-white/80 text-[#86868b] border border-gray-200/60 backdrop-blur-sm'
                    }`}>
                      <span>
                        {hasSelection
                          ? `已选 ${selectedBlockIds.size} 个块`
                          : hasChatContent ? '继续对话' : '选中块后提问'}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowFabTip(false); }}
                        className={`p-0.5 rounded-full transition-colors ${
                          isDarkMode
                            ? 'text-[#484f58] hover:text-[#e6edf3]'
                            : 'text-[#d2d2d7] hover:text-[#1d1d1f]'
                        }`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => setIsChatOpen(true)}
                    className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 ${
                      isDarkMode
                        ? 'bg-gradient-to-br from-[#1f6feb] to-[#58a6ff] text-white shadow-sm'
                        : 'bg-gradient-to-br from-[#0071E3] to-[#5AC8FA] text-white shadow-sm'
                    }`}
                    title="打开 AI 助手"
                  >
                    {hasChatContent && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                        {chatHistory.filter(m => m.role === 'assistant').length}
                      </span>
                    )}
                    <Bot size={20} />
                  </button>
                </div>
              )}
              {/* Page Tab Bar - Card Header */}
              {tabs.length > 0 && (
                <PageTabBar
                  tabs={tabs}
                  activeTabId={activeTabId}
                  onTabClick={handleTabClick}
                  onTabClose={handleTabClose}
                  isDarkMode={isDarkMode}
                />
              )}

              {/* Wiki Content - Card Body */}
              <div className="flex-1 overflow-auto">
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
                  noBorder
                />
                <div ref={contentEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Unified Chat Deck (Bottom Sheet) */}
      <div
        className={`fixed bottom-0 ${isSidebarCollapsed ? 'left-16' : 'left-64'} z-50 flex flex-col items-center transition-all duration-500 ease-apple-ease ${
          !isChatOpen && hasContent ? 'translate-y-full pointer-events-none opacity-0' : 'translate-y-0 opacity-100'
        }`}
        style={{ right: isSourcePanelOpen ? sourcePanelWidth : 0 }}
      >
        {/* Diff Confirmation Bar (Floating) */}
        {isDiffMode && (
          <DiffConfirmBar
            onApply={() => { applyDiffChanges(); clearAgentSession(); }}
            onDiscard={() => { discardDiffChanges(); }}
            variant="floating"
          />
        )}

        {/* Main Chat Container */}
        <div
          className={`relative backdrop-blur-xl border flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] rounded-[2rem] mb-4 ${!isChatExpanded && hasChatContent ? 'translate-y-[calc(100%-110px)]' : 'translate-y-0'} ${
            isDarkMode
              ? 'bg-[#161b22]/90 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] border-[#30363d]'
              : 'bg-white/85 shadow-[0_-10px_40px_rgba(0,0,0,0.08)] border-white/50'
          }`}
          style={hasChatContent ? { width: chatWidth, height: isChatExpanded ? chatHeight : 110, maxHeight: 'calc(90vh - 1rem)', minWidth: 400, willChange: isChatDraggingRef.current ? 'width, height' : 'auto' } : { width: 768 }}
        >
          {/* Resize handles */}
          {hasChatContent && (
            <>
              <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-200/50 z-10" {...getResizeHandlers('left')} />
              <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-200/50 z-10" {...getResizeHandlers('right')} />
              <div className="absolute top-0 left-2 right-2 h-2 cursor-ns-resize hover:bg-blue-200/50 z-10" {...getResizeHandlers('top')} />
            </>
          )}

          {/* Drag Handle for Collapse/Expand */}
          {hasChatContent && (
            <div
              className="w-full flex justify-center py-3 cursor-pointer hover:bg-black/5 transition-colors group"
              onClick={() => setIsChatExpanded(!isChatExpanded)}
            >
              <div className={`w-12 h-1.5 rounded-full transition-colors ${isDarkMode ? 'bg-[#484f58] group-hover:bg-[#6e7681]' : 'bg-[#d2d2d7] group-hover:bg-[#aeaeb2]'}`} />
            </div>
          )}

          {/* Chat History Area */}
          <div
            className={`flex-1 overflow-y-auto scroll-smooth px-6 transition-all duration-300 ${!isChatExpanded && hasChatContent ? 'h-0 opacity-0 py-0 flex-none' : 'opacity-100 py-4'}`}
            ref={chatScrollRef}
          >
            {chatHistory.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isLoading={isLoading}
                variant="blue"
                isDarkMode={isDarkMode}
                onClarificationSelect={msg.clarificationOptions && clarificationResolverRef.current ? (opt) => {
                  const resolver = clarificationResolverRef.current;
                  if (resolver) {
                    clarificationResolverRef.current = null;
                    setChatHistory(prev => prev.map(m =>
                      m.id === msg.id ? { ...m, clarificationOptions: undefined } : m
                    ));
                    addUserMessage(opt);
                    resolver(opt);
                  }
                } : undefined}
                onClarificationMultiSubmit={msg.clarificationMultiSelect && clarificationResolverRef.current ? (opts) => {
                  const resolver = clarificationResolverRef.current;
                  if (resolver) {
                    clarificationResolverRef.current = null;
                    const joined = opts.join('、');
                    setChatHistory(prev => prev.map(m =>
                      m.id === msg.id ? { ...m, clarificationOptions: undefined } : m
                    ));
                    addUserMessage(joined);
                    resolver(joined);
                  }
                } : undefined}
                onSuggestEditConfirm={msg.suggestEdit?.resolution === 'pending' ? async (messageId) => {
                  const pending = pendingSuggestEditsRef.current.get(messageId);
                  if (!pending) return;
                  const { response, queryBlocks, queryPagePath } = pending;

                  cancelPendingLoad();
                  isDiffModeRef.current = true;

                  // 如果用户切到了别的页，先切回来
                  const livePagePath = currentPagePathRef.current;
                  if (livePagePath !== queryPagePath) {
                    saveTabStateById(livePagePath, blocksRef.current, new Set());
                    setCurrentPagePath(queryPagePath);
                    forceActivateTab(queryPagePath);
                  }

                  const modifiedBlocks = await applyModifyPageResponse(response, queryBlocks);
                  enterDiffMode(modifiedBlocks, response, queryBlocks);
                  resolveSuggestEdit(messageId, 'confirmed');
                  clearAgentSession();
                } : undefined}
                onSuggestEditDiscard={msg.suggestEdit?.resolution === 'pending' ? (messageId) => {
                  resolveSuggestEdit(messageId, 'discarded');
                } : undefined}
                onWikiPageClick={(pagePath) => {
                  handlePageSwitch(pagePath);
                }}
              />
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
              placeholder={hasSelection ? "针对选中的内容，请输入您的修改建议..." : currentPagePath ? "选择内容以修改，或直接提问..." : "描述分析需求..."}
              className={`w-full bg-transparent outline-none resize-none font-light transition-all duration-300 ${hasContent ? 'text-base min-h-[50px] max-h-[120px]' : 'text-lg min-h-[80px]'} ${
                isDarkMode ? 'text-[#e6edf3] placeholder:text-[#7d8590]/50' : 'text-[#1d1d1f] placeholder:text-[#86868b]/50'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleAnalyze();
                }
              }}
            />

            <div className="flex justify-between items-center mt-2">
              {/* 最小化按钮（有 wiki 内容时显示） */}
              {hasContent ? (
                <button
                  onClick={() => setIsChatOpen(false)}
                  className={`p-2 rounded-full transition-colors text-xs flex items-center gap-1 ${
                    isDarkMode
                      ? 'text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#21262d]'
                      : 'text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-100'
                  }`}
                  title="最小化对话框"
                >
                  <X size={14} />
                  <span>收起</span>
                </button>
              ) : <div />}
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
