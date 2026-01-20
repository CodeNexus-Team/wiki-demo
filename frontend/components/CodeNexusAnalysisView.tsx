import React, { useState, useEffect, useRef } from 'react';
import { AnalysisType, WikiBlock, ChatMessage, MermaidMetadata, SourceLocation, ExpandedQuestion, ModifyPageResponse, NewPageResponse, WikiPageContent } from '../types';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { wikiPageCache } from '../services/wikiPageCache';
import { toggleBlockCollapse, markBlockAsDeleted, insertBlockAfter } from '../utils/blockOperations';
import { collectBlocksByIds, removeDeletedBlocks, clearBlockStatuses } from '../utils/treeBuilder';
import WikiBlockRenderer from './WikiBlock';
import SourceCodePanel from './SourceCodePanel';
import QuestionSelector from './QuestionSelector';
import WikiPageNavigator from './WikiPageNavigator';
import {
  Loader2,
  ArrowUp,
  Eraser,
  BrainCircuit,
  Bot,
  Zap,
  Check,
  X,
  PanelLeft
} from 'lucide-react';

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

// --- Thinking Chain Component ---
const ThinkingChain: React.FC<{ steps: string[], isFinished?: boolean }> = ({ steps, isFinished }) => {
    if (!steps || steps.length === 0) return null;

    return (
        <div className="mb-3 bg-gray-50/80 border border-gray-100 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-2 mb-2 text-[#86868b] font-medium uppercase tracking-wider">
                <BrainCircuit size={12} />
                CodeNexus AI 分析过程
            </div>
            <div className="space-y-1.5 pl-1">
                {steps.map((step, index) => (
                    <div key={index} className="flex items-start gap-2">
                         {isFinished || index < steps.length - 1 ? (
                             <div className="mt-0.5 w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                         ) : (
                             <Loader2 size={10} className="mt-0.5 animate-spin text-blue-500 flex-shrink-0" />
                         )}
                         <span className={`font-mono leading-relaxed ${index === steps.length - 1 && !isFinished ? 'text-[#1d1d1f]' : 'text-[#86868b]'}`}>
                             {step}
                         </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const CodeNexusAnalysisView: React.FC<CodeNexusAnalysisViewProps> = ({ type }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [prompt, setPrompt] = useState<string>('');

  // Wiki Content State
  const [blocks, setBlocks] = useState<WikiBlock[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());

  // Diff System State
  const [originalBlocks, setOriginalBlocks] = useState<WikiBlock[]>([]);
  const [isDiffMode, setIsDiffMode] = useState(false);

  // Chat & History State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatExpanded, setIsChatExpanded] = useState(true);

  // Source Code Navigation State
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(false);
  const [activeSourceLocation, setActiveSourceLocation] = useState<SourceLocation | null>(null);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(600);

  // CodeNexus Specific State
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<ExpandedQuestion[]>([]);
  const [currentUserQuery, setCurrentUserQuery] = useState<string>('');

  // Wiki Pages Navigation State
  const [wikiPages, setWikiPages] = useState<string[]>([]);
  const [currentPagePath, setCurrentPagePath] = useState<string>('');
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [isNavigatorVisible, setIsNavigatorVisible] = useState(true);

  const contentEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsLoading(false);
    setBlocks([]);
    setPrompt('');
    setChatHistory([]);
    setIsChatExpanded(true);
    setShowQuestionSelector(false);
    setIsSourcePanelOpen(false);
    setActiveSourceLocation(null);
    setSelectedBlockIds(new Set());
    setIsDiffMode(false);
    setOriginalBlocks([]);
    // 不要重置 wikiPages 和 currentPagePath，它们应该保留
    // setWikiPages([]);  // ❌ 这会导致导航消失
    // setCurrentPagePath('');
  }, [type]);

  useEffect(() => {
    if (chatScrollRef.current && isChatExpanded) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, isChatExpanded, chatHistory[chatHistory.length-1]?.steps?.length]);

  useEffect(() => {
    if (blocks.length > 0 && chatHistory.length === 0) {
         contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [blocks]);

  const hasContent = blocks.length > 0 || chatHistory.length > 0 || isLoading;

  const handleMermaidNodeClick = (nodeId: string, metadata?: MermaidMetadata) => {
    const location = metadata?.sourceMapping?.[nodeId];

    if (location) {
      setActiveSourceLocation(location);
      setIsSourcePanelOpen(true);
    }
  };

  // Handle source code click from any block
  const handleSourceClick = (blockId: string, sourceId: string, sources: any[]) => {
    console.log('[CodeNexus] handleSourceClick 被调用:', {
      blockId,
      sourceId,
      sourcesCount: sources.length,
      sources: sources
    });

    // Find the source by ID
    const source = sources.find(s => s.source_id === sourceId);

    if (source) {
      console.log('[CodeNexus] 找到匹配的 source:', {
        source_id: source.source_id,
        name: source.name,
        lines: source.lines
      });

      // Parse the first line range to get the line number
      const lineRange = source.lines[0];
      let line = 1;
      let endLine: number | undefined;

      if (lineRange) {
        // Handle formats like "10-20" or "10"
        const rangeMatch = lineRange.match(/^(\d+)-(\d+)$/);
        const singleMatch = lineRange.match(/^(\d+)$/);

        if (rangeMatch) {
          line = parseInt(rangeMatch[1], 10);
          endLine = parseInt(rangeMatch[2], 10);
        } else if (singleMatch) {
          line = parseInt(singleMatch[1], 10);
        }
      }

      const location: SourceLocation = {
        file: source.name,
        line: line,
        endLine: endLine
      };

      console.log('[CodeNexus] 构造的 SourceLocation:', location);

      setActiveSourceLocation(location);
      setIsSourcePanelOpen(true);
    } else {
      console.warn('[CodeNexus] ⚠️ 未找到匹配的 source，sourceId:', sourceId);
    }
  };

  // Toggle block selection
  const toggleBlockSelection = (blockId: string) => {
    setSelectedBlockIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(blockId)) {
        newSet.delete(blockId);
      } else {
        newSet.add(blockId);
      }
      return newSet;
    });
  };

  // Handle collapse/expand for tree structure
  const handleToggleCollapse = (blockId: string) => {
    setBlocks(prevBlocks => toggleBlockCollapse(prevBlocks, blockId));
  };

  // Apply changes in diff mode
  const applyChanges = () => {
    // 递归删除所有标记为 deleted 的节点，然后清除所有状态标记
    const blocksWithoutDeleted = removeDeletedBlocks(blocks);
    const cleanedBlocks = clearBlockStatuses(blocksWithoutDeleted);

    setBlocks(cleanedBlocks);
    setIsDiffMode(false);
    setOriginalBlocks([]);
    setSelectedBlockIds(new Set());

    // ✅ 更新缓存：清除当前页面的缓存，下次访问时会重新从后端获取最新内容
    if (currentPagePath) {
      console.log('[CodeNexusAnalysisView] 清除已修改页面的缓存:', currentPagePath);
      wikiPageCache.remove(currentPagePath);
    }

    // 添加确认消息
    setChatHistory(prev => [...prev, {
      id: Date.now().toString(),
      role: 'assistant',
      content: '✅ 已应用所有变更。',
      timestamp: Date.now()
    }]);
  };

  // Discard changes in diff mode
  const discardChanges = () => {
    setBlocks(originalBlocks);
    setIsDiffMode(false);
    setOriginalBlocks([]);
    setSelectedBlockIds(new Set());
  };

  // 将 WikiPageContent 转换为 WikiBlock
  const convertContentToWikiBlock = async (content: WikiPageContent, sources: any[]): Promise<WikiBlock> => {
    const { parseWikiPageToBlocks } = await import('../utils/wikiContentParser');

    // 创建一个临时的 WikiPage 结构
    const tempPage = {
      content: [content],
      source: sources
    };

    const blocks = parseWikiPageToBlocks(tempPage.content, tempPage.source);
    return blocks[0]; // 返回第一个 block
  };

  // 处理 ModifyPageResponse
  const applyModifyPageResponse = async (response: ModifyPageResponse, currentBlocks: WikiBlock[]) => {
    let newBlocks = [...currentBlocks];
    const { parseWikiPageToBlocks } = await import('../utils/wikiContentParser');

    // 标记要删除的 blocks (使用树形结构函数)
    response.delete_blocks.forEach(blockId => {
      newBlocks = markBlockAsDeleted(newBlocks, blockId);
    });

    // 插入新的 blocks (使用树形结构函数)
    for (const insertion of response.insert_blocks) {
      // 将 WikiPageContent 转换为 WikiBlock
      const tempPage = {
        content: [insertion.block],
        source: response.insert_sources
      };
      const parsedBlocks = parseWikiPageToBlocks(tempPage.content, tempPage.source);

      if (parsedBlocks.length > 0) {
        const newBlock: WikiBlock = {
          ...parsedBlocks[0],
          status: 'inserted'
        };
        // 使用树形结构的插入函数
        newBlocks = insertBlockAfter(newBlocks, insertion.after_block, newBlock);
      }
    }

    return newBlocks;
  };

  // 处理 NewPageResponse
  const handleNewPageResponse = async (response: NewPageResponse) => {
    const { parseWikiPageToBlocks } = await import('../utils/wikiContentParser');
    const parsedBlocks = parseWikiPageToBlocks(response.new_page.content, response.new_page.source);

    // 将新页面添加到页面列表
    setWikiPages(prev => [...prev, response.new_page_path]);
    setCurrentPagePath(response.new_page_path);
    setBlocks(parsedBlocks);
  };

  // 切换到指定页面
  const handlePageSwitch = async (pagePath: string) => {
    if (pagePath === currentPagePath || isLoadingPage) return;

    setIsLoadingPage(true);

    try {
      const wikiPage = await codenexusWikiService.fetchPage(pagePath);

      const { parseWikiPageToBlocks } = await import('../utils/wikiContentParser');
      const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);

      setBlocks(parsedBlocks);
      setCurrentPagePath(pagePath);
      //setCollapsedSections(new Set());

      contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
      console.error('页面切换失败:', error);
    } finally {
      setIsLoadingPage(false);
    }
  };

  const handleAnalyze = async () => {
    if (!prompt.trim()) return;
    const currentPrompt = prompt.trim();
    const currentSelectedIds = new Set(selectedBlockIds);
    const hasSelectedBlocks = currentSelectedIds.size > 0;

    // 调试日志
    console.log('[CodeNexus Debug] handleAnalyze 执行开始:', {
      selectedBlockIdsSize: selectedBlockIds.size,
      currentSelectedIdsSize: currentSelectedIds.size,
      hasSelectedBlocks,
      currentPagePath,
      wikiPagesLength: wikiPages.length,
      prompt: currentPrompt
    });

    setPrompt('');
    setIsLoading(true);

    // Use collectBlocksByIds to recursively find all selected blocks in tree structure
    const referencedBlocks = hasSelectedBlocks ? collectBlocksByIds(blocks, currentSelectedIds) : [];

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: currentPrompt,
      timestamp: Date.now(),
      references: referencedBlocks.length > 0 ? referencedBlocks : undefined,
    };
    setChatHistory(prev => [...prev, userMsg]);
    setIsChatExpanded(true);

    // Placeholder for assistant message
    const assistantMsgId = (Date.now() + 1).toString();
    setChatHistory(prev => [...prev, {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        steps: ['初始化 CodeNexus AI 分析...'],
        timestamp: Date.now()
    }]);

    const updateProgress = (step: string) => {
        setChatHistory(prev => prev.map(msg =>
            msg.id === assistantMsgId
                ? { ...msg, steps: [...(msg.steps || []), step] }
                : msg
        ));
    };

    try {
      // 如果有选中的 blocks，执行块级细化
      if (hasSelectedBlocks) {
        // 如果 currentPagePath 为空，检查是否可以从 wikiPages 中获取
        let effectivePagePath = currentPagePath;

        if (!effectivePagePath && wikiPages.length > 0) {
          // 使用第一个页面路径作为默认值
          effectivePagePath = wikiPages[0];
          setCurrentPagePath(effectivePagePath);
          console.log('[CodeNexus] currentPagePath 为空，使用第一个页面:', effectivePagePath);
        }

        if (effectivePagePath) {
          updateProgress(`检测到 ${currentSelectedIds.size} 个选中的块，正在执行块级细化...`);

          const blockIds = Array.from(currentSelectedIds);
          const response = await codenexusWikiService.detailedQuery(
            effectivePagePath,
            blockIds,
            currentPrompt
          );

          // 判断响应类型
          if ('new_page_path' in response) {
            // 新增页面
            updateProgress('AI 建议创建新页面...');
            await handleNewPageResponse(response);

            setChatHistory(prev => prev.map(msg =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content: `已创建新页面：${response.new_page_path}\n\n包含 ${blocks.length} 个对象。`,
                    steps: [...(msg.steps || []), '完成']
                  }
                : msg
            ));
          } else {
            // 修改当前页面
            updateProgress('AI 正在分析并生成修改建议...');

            // 保存原始状态
            setOriginalBlocks([...blocks]);

            // 应用修改
            const modifiedBlocks = await applyModifyPageResponse(response, blocks);
            setBlocks(modifiedBlocks);
            setIsDiffMode(true);

            const insertCount = response.insert_blocks.length;
            const deleteCount = response.delete_blocks.length;

            setChatHistory(prev => prev.map(msg =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content: `已生成修改建议：\n- 新增 ${insertCount} 个块\n- 删除 ${deleteCount} 个块\n\n请查看差异预览，确认后点击"应用变更"。`,
                    steps: [...(msg.steps || []), '完成']
                  }
                : msg
            ));
          }

          setIsLoading(false);
          return;
        } else {
          // 如果 effectivePagePath 仍然为空，警告用户并终止
          updateProgress('⚠️ 错误：无法获取页面路径');

          setChatHistory(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: '⚠️ 无法执行块级细化：缺少页面路径信息。\n\n请先执行一次完整查询生成 Wiki 页面后，再尝试选中块进行细化。',
                  steps: [...(msg.steps || []), '错误：缺少页面路径']
                }
              : msg
          ));

          // 清除选中状态
          setSelectedBlockIds(new Set());
          setIsLoading(false);
          return; // ✅ 关键修复：阻止代码继续执行
        }
      }

      // 否则，执行扩展查询
      updateProgress('正在分析您的问题，生成扩展查询...');

      const questions = await codenexusWikiService.expandQuery(currentPrompt);

      // 保存用户查询和扩展问题
      setCurrentUserQuery(currentPrompt);
      setExpandedQuestions(questions);

      updateProgress(`生成了 ${questions.length} 个扩展问题，等待您的选择...`);

      // 显示问题选择器
      setShowQuestionSelector(true);
      setIsLoading(false);

      // 更新助手消息
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
      setChatHistory(prev => prev.map(msg =>
        msg.id === assistantMsgId
            ? {
                ...msg,
                content: `执行过程中遇到了问题：\n${errorMessage}`,
                steps: [...(msg.steps || []), '错误: 执行中断']
              }
            : msg
      ));
      setIsLoading(false);
    }
  };

  const handleQuestionConfirm = async (selectedQuestions: ExpandedQuestion[]) => {
    setShowQuestionSelector(false);
    setIsLoading(true);

    // 创建新的助手消息用于工作流执行
    const workflowMsgId = Date.now().toString();
    setChatHistory(prev => [...prev, {
        id: workflowMsgId,
        role: 'assistant',
        content: '',
        steps: [`开始执行工作流，已选择 ${selectedQuestions.length} 个问题...`],
        timestamp: Date.now()
    }]);

    const updateProgress = (step: string) => {
        setChatHistory(prev => prev.map(msg =>
            msg.id === workflowMsgId
                ? { ...msg, steps: [...(msg.steps || []), step] }
                : msg
        ));
    };

    try {
      // Step 2: 执行工作流
      updateProgress('正在执行工作流分析...');
      const workflowResult = await codenexusWikiService.executeWorkflow(
        currentUserQuery,
        selectedQuestions,
        updateProgress
      );

      updateProgress(`生成了 ${workflowResult.wiki_pages.length} 个 Wiki 页面，正在加载...`);

      // 保存页面列表到状态
      setWikiPages(workflowResult.wiki_pages);

      // Step 3: 加载第一个页面
      const firstPage = workflowResult.wiki_pages[0];
      setCurrentPagePath(firstPage);

      const wikiPage = await codenexusWikiService.fetchPage(firstPage);

      updateProgress('解析 Wiki 对象结构...');

      // 使用 wikiContentParser 解析结构化内容
      const { parseWikiPageToBlocks } = await import('../utils/wikiContentParser');
      const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);

      setBlocks(parsedBlocks);

      // 如果有多个页面，提示用户
      let contentMessage = `已生成 ${TITLE_MAP[type]} 的完整分析报告，包含 ${parsedBlocks.length} 个交互式对象。`;
      if (workflowResult.wiki_pages.length > 1) {
        contentMessage += `\n\n📚 共生成 ${workflowResult.wiki_pages.length} 个页面，当前显示: ${firstPage.split('/').pop()}`;
      }
      contentMessage += `\n\n📁 Wiki 根目录: ${workflowResult.wiki_root}`;

      // 更新助手消息
      setChatHistory(prev => prev.map(msg =>
        msg.id === workflowMsgId
            ? {
                ...msg,
                content: contentMessage,
                steps: [...(msg.steps || []), '完成']
              }
            : msg
      ));

    } catch (error) {
      console.error("Workflow Execution Failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setChatHistory(prev => prev.map(msg =>
        msg.id === workflowMsgId
            ? {
                ...msg,
                content: `工作流执行失败：\n${errorMessage}`,
                steps: [...(msg.steps || []), '错误: 工作流中断']
              }
            : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuestionCancel = () => {
    setShowQuestionSelector(false);
    setChatHistory(prev => [...prev, {
      id: Date.now().toString(),
      role: 'assistant',
      content: '您已取消问题选择。请重新输入查询或选择其他操作。',
      timestamp: Date.now()
    }]);
  };

  return (
    <div className="h-full relative flex flex-col bg-[#F5F5F7]">
      <SourceCodePanel
        isOpen={isSourcePanelOpen}
        onClose={() => setIsSourcePanelOpen(false)}
        location={activeSourceLocation}
        panelWidth={sourcePanelWidth}
        onWidthChange={setSourcePanelWidth}
      />


      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto scroll-smooth no-scrollbar w-full pb-[200px]">
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
            <div className="flex gap-6">
              {/* 左侧：页面导航 */}
              {wikiPages.length > 1 && (
                <div className={`
                  flex-shrink-0 transition-all duration-300 ease-in-out
                  ${isNavigatorVisible ? 'w-64 opacity-100' : 'w-0 opacity-0 overflow-hidden'}
                `}>
                  <div className="sticky top-8">
                    <WikiPageNavigator
                      wikiPages={wikiPages}
                      currentPage={currentPagePath}
                      onPageSelect={handlePageSwitch}
                      onToggleVisibility={() => setIsNavigatorVisible(false)}
                    />
                  </div>
                </div>
              )}

              {/* 显示导航按钮（当导航隐藏时） */}
              {wikiPages.length > 1 && !isNavigatorVisible && (
                <div className="flex-shrink-0 w-12">
                  <div className="sticky top-8">
                    <button
                      onClick={() => setIsNavigatorVisible(true)}
                      className={`
                        flex items-center justify-center
                        w-10 h-10 rounded-full
                        bg-white shadow-lg border border-gray-200
                        hover:bg-gray-50 hover:shadow-xl
                        transition-all duration-200
                        group
                      `}
                      title="显示导航"
                    >
                      <PanelLeft size={18} className="text-gray-600 group-hover:text-orange-600" />
                    </button>
                  </div>
                </div>
              )}

              {/* 右侧：Wiki 内容 */}
              <div className="flex-1 min-w-0">
                <div className="bg-white rounded-[2.5rem] shadow-apple-card p-8 md:p-12 border border-white min-h-[50vh] animate-in fade-in slide-in-from-bottom-8 duration-500 mb-10">
                  {/* Loading Overlay */}
                  {isLoadingPage && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-[2.5rem] flex items-center justify-center z-10">
                      <div className="flex items-center gap-3 text-orange-600">
                        <Loader2 size={20} className="animate-spin" />
                        <span className="text-sm font-medium">加载页面中...</span>
                      </div>
                    </div>
                  )}

                  {/* Wiki Header */}
                  <div className="mb-8 pb-6 border-b border-[#f5f5f7] flex justify-between items-center">
                     <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[#86868b] bg-[#F5F5F7] px-3 py-1 rounded-full uppercase tracking-wide">
                            Wiki Object Mode
                        </span>
                        <span className="text-xs text-orange-600 bg-orange-50 px-3 py-1 rounded-full flex items-center gap-1">
                            <Zap size={10} /> CodeNexus AI
                        </span>
                     </div>
                     <span className="text-xs text-[#d2d2d7] font-mono">{blocks.length} Objects</span>
                  </div>

                  {/* Wiki Content */}
                  <div className="space-y-2 wiki-root">{blocks.map((block) => (
                        <div key={block.id}>
                          <WikiBlockRenderer
                              block={block}
                              isSelected={selectedBlockIds.has(block.id)}
                              onToggleSelect={() => toggleBlockSelection(block.id)}
                              onMermaidNodeClick={handleMermaidNodeClick}
                              onSourceClick={handleSourceClick}
                              onToggleCollapse={handleToggleCollapse}
                              selectedBlockIds={selectedBlockIds}
                          />
                        </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div ref={contentEndRef} />
          </div>
        )}
      </div>

      {/* Unified Chat Deck (Bottom Sheet) */}
      <div className="fixed bottom-0 left-64 right-0 z-50 flex flex-col items-center transition-all duration-500 ease-apple-ease">
        {/* Main Chat Container */}
        <div className={`
            w-full max-w-3xl bg-white/85 backdrop-blur-xl shadow-[0_-10px_40px_rgba(0,0,0,0.08)] border border-white/50
            flex flex-col overflow-hidden
            transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
            ${hasContent ? 'rounded-t-[2rem]' : 'rounded-[2rem] mb-10'}
            ${!isChatExpanded && hasContent ? 'max-h-[110px] translate-y-[calc(100%-110px)]' : 'max-h-[70vh] translate-y-0'}
        `}>
            {/* Drag Handle */}
            {hasContent && (
                <div
                    className="w-full flex justify-center py-3 cursor-pointer hover:bg-black/5 transition-colors group"
                    onClick={() => setIsChatExpanded(!isChatExpanded)}
                >
                    <div className="w-12 h-1.5 rounded-full bg-[#d2d2d7] group-hover:bg-[#aeaeb2] transition-colors" />
                </div>
            )}

            {/* Chat History Area */}
            <div
                className={`
                    flex-1 overflow-y-auto scroll-smooth px-6 transition-all duration-300
                    ${!isChatExpanded && hasContent ? 'h-0 opacity-0 py-0 flex-none' : 'opacity-100 py-4'}
                `}
                ref={chatScrollRef}
            >
                {chatHistory.map((msg) => (
                    <div key={msg.id} className={`flex w-full mb-6 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex flex-col max-w-[90%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>

                            {/* Assistant Icon */}
                            {msg.role === 'assistant' && (
                                <div className="flex items-center gap-2 mb-1.5 ml-1">
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white shadow-sm">
                                        <Bot size={14} />
                                    </div>
                                </div>
                            )}

                            {/* Thinking Chain */}
                            {msg.role === 'assistant' && (
                                <ThinkingChain steps={msg.steps || []} isFinished={!!msg.content && msg.content.length > 0 && !isLoading} />
                            )}

                            {/* Message Content */}
                            {msg.content && (
                                <div className={`
                                    px-5 py-3.5 rounded-[1.2rem] text-sm leading-relaxed shadow-sm whitespace-pre-wrap
                                    ${msg.role === 'user'
                                        ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-br-sm shadow-orange-200/50'
                                        : 'bg-white border border-[#e5e5ea] text-[#1d1d1f] rounded-tl-sm'
                                    }
                                `}>
                                    {msg.content}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

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
            </div>

            {/* Input Area */}
            <div className="relative w-full bg-white/50 backdrop-blur-md border-t border-white/50">
                {/* Diff Mode Control Bar */}
                {isDiffMode && (
                  <div className="px-4 pt-3 pb-2 border-b border-orange-200 bg-orange-50/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-orange-700">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                        <span className="font-medium">差异预览模式</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={discardChanges}
                          className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-1.5 transition-colors"
                        >
                          <X size={14} />
                          放弃变更
                        </button>
                        <button
                          onClick={applyChanges}
                          className="px-3 py-1.5 text-sm bg-gradient-to-br from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                        >
                          <Check size={14} />
                          应用变更
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Selected Blocks Indicator */}
                {selectedBlockIds.size > 0 && !isDiffMode && (
                  <div className="px-4 pt-3 pb-2 border-b border-blue-200 bg-blue-50/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-blue-700">
                        <span className="font-medium">已选择 {selectedBlockIds.size} 个块</span>
                      </div>
                      <button
                        onClick={() => setSelectedBlockIds(new Set())}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        清除选择
                      </button>
                    </div>
                  </div>
                )}

                <div className="p-4">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={selectedBlockIds.size > 0 ? "针对选中的内容，请输入您的修改建议..." : "描述您的代码分析需求（使用 CodeNexus AI）..."}
                    className={`
                    w-full bg-transparent outline-none resize-none text-[#1d1d1f] font-light placeholder:text-[#86868b]/50
                    transition-all duration-300
                    ${hasContent ? 'text-base min-h-[50px] max-h-[120px]' : 'text-lg min-h-[80px]'}
                    `}
                    onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAnalyze();
                    }
                    }}
                />

                <div className="flex justify-between items-center mt-2">
                     <div className="flex items-center gap-2 text-xs text-[#86868b]">
                        <Zap size={12} className="text-orange-500" />
                        <span>CodeNexus AI Engine</span>
                     </div>

                     <div className="flex items-center gap-2">
                        {prompt && !isLoading && (
                        <button
                            onClick={() => setPrompt('')}
                            className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <Eraser size={16} />
                        </button>
                        )}
                        <button
                        onClick={handleAnalyze}
                        disabled={!prompt.trim() || isLoading}
                        className={`
                            bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700
                            disabled:bg-[#e5e5ea] disabled:text-[#86868b]
                            text-white rounded-full flex items-center justify-center transition-all duration-200 shadow-md w-8 h-8
                        `}
                        >
                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={3} />}
                        </button>
                     </div>
                </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default CodeNexusAnalysisView;
