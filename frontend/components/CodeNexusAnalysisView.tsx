import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisType, WikiBlock, ExpandedQuestion } from '../types';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { toggleBlockCollapse } from '../utils/blockOperations';
import { parseWikiPageToBlocks } from '../utils/wikiContentParser';

// Hooks
import {
  useBlockSelection,
  useDiffMode,
  useChatHistory,
  useSourcePanel,
  useWikiPages
} from '../hooks';

// Components
import SourceCodePanel from './SourceCodePanel';
import QuestionSelector from './QuestionSelector';
import { ChatPanel } from './chat';
import { WikiContent } from './wiki';
import { Bot, Zap } from 'lucide-react';

interface CodeNexusAnalysisViewProps {
  type: AnalysisType;
}

const TITLE_MAP: Record<AnalysisType, string> = {
  [AnalysisType.DASHBOARD]: '仪表盘',
  [AnalysisType.ARCHITECTURE]: '架构视图',
  [AnalysisType.API_ANALYSIS]: '接口分析',
  [AnalysisType.BUSINESS_FLOW]: '业务流',
  [AnalysisType.CONTROL_FLOW]: '控制流',
  [AnalysisType.DATABASE]: '数据库模型',
};

const CodeNexusAnalysisView: React.FC<CodeNexusAnalysisViewProps> = ({ type }) => {
  // Local state
  const [isLoading, setIsLoading] = useState(false);
  const [prompt, setPrompt] = useState<string>('');
  const [blocks, setBlocks] = useState<WikiBlock[]>([]);
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<ExpandedQuestion[]>([]);
  const [currentUserQuery, setCurrentUserQuery] = useState<string>('');

  const contentEndRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Custom Hooks
  const blockSelection = useBlockSelection({ blocks, isDiffMode: false });
  const {
    selectedBlockIds,
    toggleBlockSelection,
    clearSelection,
    setSelectedBlockIds,
    getReferencedBlocks
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
    applyModifyPageResponse
  } = diffMode;

  const sourcePanel = useSourcePanel();
  const {
    isSourcePanelOpen,
    activeSourceLocation,
    sourcePanelWidth,
    closeSourcePanel,
    setSourcePanelWidth,
    handleSourceClick,
    handleMermaidNodeClick
  } = sourcePanel;

  // Reset state when type changes
  useEffect(() => {
    setIsLoading(false);
    setBlocks([]);
    setPrompt('');
    clearHistory();
    setIsChatExpanded(true);
    setShowQuestionSelector(false);
    closeSourcePanel();
    setSelectedBlockIds(new Set());
  }, [type, clearHistory, setIsChatExpanded, closeSourcePanel, setSelectedBlockIds]);

  // Scroll to content end when blocks change
  useEffect(() => {
    if (blocks.length > 0 && chatHistory.length === 0) {
      contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [blocks, chatHistory.length]);

  const hasContent = blocks.length > 0 || chatHistory.length > 0 || isLoading;

  // Handle collapse/expand for tree structure
  const handleToggleCollapse = useCallback((blockId: string) => {
    setBlocks(prevBlocks => toggleBlockCollapse(prevBlocks, blockId));
  }, []);

  // Handle page switch
  const handlePageSwitch = useCallback(async (pagePath: string) => {
    const newBlocks = await handlePageSwitchBase(pagePath);
    if (newBlocks) {
      setBlocks(newBlocks);
    }
  }, [handlePageSwitchBase]);

  // Main analysis handler
  const handleAnalyze = useCallback(async () => {
    if (!prompt.trim()) return;
    const currentPrompt = prompt.trim();
    const currentSelectedIds = new Set(selectedBlockIds);
    const hasSelectedBlocks = currentSelectedIds.size > 0;

    setPrompt('');
    setIsLoading(true);

    const referencedBlocks = hasSelectedBlocks ? getReferencedBlocks() : [];

    addUserMessage(currentPrompt, referencedBlocks.length > 0 ? referencedBlocks : undefined);
    setIsChatExpanded(true);

    const assistantMsgId = addAssistantMessage(['初始化 CodeNexus AI 分析...']);

    try {
      // If blocks are selected, execute block-level refinement
      if (hasSelectedBlocks) {
        let effectivePagePath = currentPagePath;

        if (!effectivePagePath && wikiPages.length > 0) {
          effectivePagePath = wikiPages[0];
          setCurrentPagePath(effectivePagePath);
        }

        if (effectivePagePath) {
          updateAssistantProgress(assistantMsgId, `检测到 ${currentSelectedIds.size} 个选中的块，正在执行块级细化...`);

          const blockIds = Array.from(currentSelectedIds);
          const response = await codenexusWikiService.detailedQuery(
            effectivePagePath,
            blockIds,
            currentPrompt
          );

          if ('new_page_path' in response) {
            updateAssistantProgress(assistantMsgId, 'AI 建议创建新页面...');
            const parsedBlocks = parseWikiPageToBlocks(response.new_page.content, response.new_page.source);

            setWikiPages(prev => [...prev, response.new_page_path]);
            setCurrentPagePath(response.new_page_path);
            setBlocks(parsedBlocks);

            finalizeAssistantMessage(assistantMsgId, `已创建新页面：${response.new_page_path}\n\n包含 ${parsedBlocks.length} 个对象。`);
          } else {
            updateAssistantProgress(assistantMsgId, 'AI 正在分析并生成修改建议...');

            const modifiedBlocks = await applyModifyPageResponse(response, blocks);
            enterDiffMode(modifiedBlocks, response);

            const insertCount = response.insert_blocks.length;
            const deleteCount = response.delete_blocks.length;

            finalizeAssistantMessage(assistantMsgId, `已生成修改建议：\n- 新增 ${insertCount} 个块\n- 删除 ${deleteCount} 个块\n\n请查看差异预览，确认后点击"应用变更"。`);
          }

          setIsLoading(false);
          return;
        } else {
          updateAssistantProgress(assistantMsgId, '⚠️ 错误：无法获取页面路径');
          finalizeAssistantMessage(assistantMsgId, '⚠️ 无法执行块级细化：缺少页面路径信息。\n\n请先执行一次完整查询生成 Wiki 页面后，再尝试选中块进行细化。');
          setSelectedBlockIds(new Set());
          setIsLoading(false);
          return;
        }
      }

      // Execute expand query
      updateAssistantProgress(assistantMsgId, '正在分析您的问题，生成扩展查询...');

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

    } catch (error) {
      console.error("Analysis Failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      finalizeAssistantMessage(assistantMsgId, `执行过程中遇到了问题：\n${errorMessage}`);
      setIsLoading(false);
    }
  }, [prompt, selectedBlockIds, getReferencedBlocks, addUserMessage, setIsChatExpanded, addAssistantMessage, currentPagePath, wikiPages, updateAssistantProgress, applyModifyPageResponse, blocks, enterDiffMode, finalizeAssistantMessage, setWikiPages, setCurrentPagePath, setSelectedBlockIds, setChatHistory]);

  // Handle question confirm
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
  }, [currentUserQuery, type, addAssistantMessage, updateAssistantProgress, setWikiPages, setCurrentPagePath, finalizeAssistantMessage]);

  // Handle question cancel
  const handleQuestionCancel = useCallback(() => {
    setShowQuestionSelector(false);
    addSimpleMessage('assistant', '您已取消问题选择。请重新输入查询或选择其他操作。');
  }, [addSimpleMessage]);

  return (
    <div className="h-full relative flex flex-col bg-[#F5F5F7]">
      <SourceCodePanel
        isOpen={isSourcePanelOpen}
        onClose={closeSourcePanel}
        location={activeSourceLocation}
        panelWidth={sourcePanelWidth}
        onWidthChange={setSourcePanelWidth}
      />

      {/* Main Content Area */}
      <div
        ref={mainContentRef}
        className="flex-1 overflow-y-auto scroll-smooth no-scrollbar w-full pb-[200px]"
      >
        {!hasContent && (
          <div className="min-h-[50vh] flex flex-col items-center justify-center px-6 animate-in fade-in duration-700 pt-10">
            <div className="w-16 h-16 bg-gradient-to-tr from-[#FF6B00] to-[#FF9500] rounded-[1.5rem] shadow-xl mb-6 flex items-center justify-center text-white">
              <Zap size={32} />
            </div>
            <h2 className="text-3xl font-semibold text-[#1d1d1f] mb-3 tracking-tight text-center">
              {TITLE_MAP[type]} - CodeNexus AI
            </h2>
            <p className="text-[#86868b] text-base font-light max-w-lg text-center leading-relaxed">
              使用自研 AI 组件，提供更精准的代码分析和 Wiki 生成。
            </p>
          </div>
        )}

        {blocks.length > 0 && (
          <div className="px-4 md:px-12 pt-8 max-w-7xl mx-auto">
            <WikiContent
              blocks={blocks}
              selectedBlockIds={selectedBlockIds}
              isDiffMode={isDiffMode}
              isLoadingPage={isLoadingPage}
              onToggleSelect={toggleBlockSelection}
              onToggleCollapse={handleToggleCollapse}
              onMermaidNodeClick={handleMermaidNodeClick}
              onSourceClick={handleSourceClick}
              wikiPages={wikiPages}
              currentPagePath={currentPagePath}
              isNavigatorVisible={isNavigatorVisible}
              onPageSwitch={handlePageSwitch}
              onToggleNavigator={() => setIsNavigatorVisible(!isNavigatorVisible)}
              headerLabel="Wiki Object Mode"
              headerIcon="zap"
              headerBadge={
                <span className="text-xs text-orange-600 bg-orange-50 px-3 py-1 rounded-full flex items-center gap-1">
                  <Zap size={10} /> CodeNexus AI
                </span>
              }
              variant="orange"
            />
            <div ref={contentEndRef} />
          </div>
        )}
      </div>

      {/* Unified Chat Deck (Bottom Sheet) */}
      <div className="fixed bottom-0 left-64 right-0 z-50 flex flex-col items-center transition-all duration-500 ease-apple-ease">
        <ChatPanel
          chatHistory={chatHistory}
          isChatExpanded={isChatExpanded}
          isLoading={isLoading}
          hasContent={hasContent}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={handleAnalyze}
          placeholder="描述您的代码分析需求（使用 CodeNexus AI）..."
          selectedBlockIds={selectedBlockIds}
          blocks={blocks}
          onToggleSelect={toggleBlockSelection}
          onClearSelection={clearSelection}
          isDiffMode={isDiffMode}
          onApplyChanges={applyDiffChanges}
          onDiscardChanges={discardDiffChanges}
          onToggleExpand={() => setIsChatExpanded(!isChatExpanded)}
          chatScrollRef={chatScrollRef}
          variant="orange"
          footerLeft={
            <div className="flex items-center gap-2 text-xs text-[#86868b]">
              <Zap size={12} className="text-orange-500" />
              <span>CodeNexus AI Engine</span>
            </div>
          }
        >
          {/* Question Selector - Integrated in chat */}
          {showQuestionSelector && (
            <div className="flex w-full mb-6 justify-start">
              <div className="flex flex-col items-start max-w-[90%]">
                <div className="flex items-center gap-2 mb-1.5 ml-1">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white shadow-sm">
                    <Bot size={14} />
                  </div>
                </div>
                <QuestionSelector
                  questions={expandedQuestions}
                  onConfirm={handleQuestionConfirm}
                  onCancel={handleQuestionCancel}
                />
              </div>
            </div>
          )}
        </ChatPanel>
      </div>
    </div>
  );
};

export default CodeNexusAnalysisView;
