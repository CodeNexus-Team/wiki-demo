
import React, { useState, useEffect, useRef } from 'react';
import { AnalysisType, WikiBlock, BlockOperation, ChatMessage, MermaidMetadata, SourceLocation, ExpandedQuestion, WikiHistoryRecord, ModifyPageResponse } from '../types';
import { geminiService, AVAILABLE_MODELS } from '../services/geminiService';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { wikiPageCache } from '../services/wikiPageCache';
import { parseMarkdownToBlocks, parseSingleBlockUpdate } from '../utils/markdownParser';
import { parseWikiPageToBlocks } from '../utils/wikiContentParser';
import { toggleBlockCollapse, markBlockAsDeleted, insertBlockAfter, updateBlockContent } from '../utils/blockOperations';
import { findBlockById, collectBlocksByIds, removeDeletedBlocks, clearBlockStatuses, countTreeNodes } from '../utils/treeBuilder';
import WikiBlockRenderer from './WikiBlock';
import SourceCodePanel from './SourceCodePanel';
import QuestionSelector from './QuestionSelector';
import WikiPageNavigator from './WikiPageNavigator';
import Mermaid from './Mermaid';
import { MOCK_REPO_FILES } from '../mock/sourceCode';
import {
  Loader2,
  ArrowUp,
  Sparkles,
  Eraser,
  X,
  Quote,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
  Bot,
  User,
  Cpu,
  FileText,
  CheckCircle2,
  XCircle,
  FileDiff,
  Check,
  PanelLeft
} from 'lucide-react';

interface AnalysisViewProps {
  type: AnalysisType;
  wikiHistory: WikiHistoryRecord[];
  setWikiHistory: React.Dispatch<React.SetStateAction<WikiHistoryRecord[]>>;
  selectedHistoryRecord: WikiHistoryRecord | null;
  onHistoryLoaded: () => void;
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
                AI Thinking Process
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

const AnalysisView: React.FC<AnalysisViewProps> = ({ type, wikiHistory, setWikiHistory, selectedHistoryRecord, onHistoryLoaded }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [prompt, setPrompt] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>(AVAILABLE_MODELS[0].id);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  
  // Wiki Content State
  const [blocks, setBlocks] = useState<WikiBlock[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  
  // Diff System State
  const [originalBlocks, setOriginalBlocks] = useState<WikiBlock[]>([]);
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [pendingPageDiff, setPendingPageDiff] = useState<ModifyPageResponse | null>(null);

  // Chat & History State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatExpanded, setIsChatExpanded] = useState(true); 
  
  // Source Code Navigation State
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(false);
  const [activeSourceLocation, setActiveSourceLocation] = useState<SourceLocation | null>(null);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(600);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const [highlightedMermaidNodeId, setHighlightedMermaidNodeId] = useState<string | null>(null);

  // CodeNexus Workflow State
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<ExpandedQuestion[]>([]);
  const [currentUserQuery, setCurrentUserQuery] = useState<string>('');

  // Wiki Pages Navigation State
  const [wikiPages, setWikiPages] = useState<string[]>([]);
  const [currentPagePath, setCurrentPagePath] = useState<string>('');
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [isNavigatorVisible, setIsNavigatorVisible] = useState(true);

  // Mermaid Modal State
  const [mermaidModalOpen, setMermaidModalOpen] = useState(false);
  const [mermaidModalChart, setMermaidModalChart] = useState<string>('');
  const [mermaidModalMetadata, setMermaidModalMetadata] = useState<MermaidMetadata | undefined>();
  const [mermaidModalZoom, setMermaidModalZoom] = useState(1);
  const [mermaidModalWidth, setMermaidModalWidth] = useState(window.innerWidth * 0.95);
  const [mermaidModalHeight, setMermaidModalHeight] = useState(window.innerHeight * 0.95);
  const [mermaidModalLeft, setMermaidModalLeft] = useState(window.innerWidth * 0.025);
  const [mermaidModalTop, setMermaidModalTop] = useState(window.innerHeight * 0.025);
  const isMermaidModalDraggingRef = useRef<'left' | 'right' | 'top' | 'bottom' | 'move' | null>(null);
  const modalDragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const mermaidContentDraggingRef = useRef(false);
  const mermaidScrollStartRef = useRef<{ scrollLeft: number; scrollTop: number; clientX: number; clientY: number } | null>(null);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const mermaidContentRef = useRef<HTMLDivElement>(null);

  // Chat dialog resize state
  const [chatWidth, setChatWidth] = useState(768); // 48rem = 768px
  const [chatHeight, setChatHeight] = useState(() => typeof window !== 'undefined' ? window.innerHeight * 0.9 : 500);
  const isDraggingRef = useRef<'left' | 'right' | 'top' | null>(null);

  // 标记是否刚刚完成历史记录加载，防止 type useEffect 清空刚加载的内容
  const justLoadedHistoryRef = useRef(false);

  // 加载选中的历史记录
  useEffect(() => {
    if (!selectedHistoryRecord) return;

    const loadHistoryRecord = async () => {
      // 恢复页面路径
      if (selectedHistoryRecord.pagePath) {
        setCurrentPagePath(selectedHistoryRecord.pagePath);
      }
      // 恢复 wikiPages（导航栏数据）
      if (selectedHistoryRecord.wikiPages) {
        setWikiPages(selectedHistoryRecord.wikiPages);
      }
      // 恢复用户查询
      if (selectedHistoryRecord.userQuery) {
        setCurrentUserQuery(selectedHistoryRecord.userQuery);
      }
      // 清除选中状态和 diff 模式
      setSelectedBlockIds(new Set());
      setIsDiffMode(false);
      setOriginalBlocks([]);
      // 聊天框默认收起
      setIsChatExpanded(false);

      // 从缓存或后端获取页面数据
      if (selectedHistoryRecord.pagePath) {
        const pagePath = selectedHistoryRecord.pagePath;

        // 先尝试从缓存获取
        let wikiPage = wikiPageCache.get(pagePath);

        // 缓存未命中，从后端获取
        if (!wikiPage) {
          try {
            wikiPage = await codenexusWikiService.fetchPage(pagePath);
          } catch (error) {
            console.error('[History] 从后端获取页面失败:', error);
          }
        }

        if (wikiPage) {
          const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
          setBlocks(parsedBlocks);
        } else {
          // 兼容旧的历史记录格式（直接存储了 blocks）
          if (selectedHistoryRecord.blocks) {
            setBlocks(selectedHistoryRecord.blocks);
          } else {
            setBlocks([]);
          }
        }
      } else {
        // 没有 pagePath，使用旧格式的 blocks（兼容性）
        if (selectedHistoryRecord.blocks) {
          setBlocks(selectedHistoryRecord.blocks);
        }
      }

      // 标记刚刚完成历史记录加载，防止 type useEffect 清空内容
      justLoadedHistoryRef.current = true;

      // 通知父组件已加载完成
      onHistoryLoaded();

      // 等待渲染完成后滚动到页面顶部
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0;
        }
      });
    };

    loadHistoryRecord();
  }, [selectedHistoryRecord, onHistoryLoaded]);

  // Drag resize handlers
  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      // Use requestAnimationFrame for smooth updates
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        if (isDraggingRef.current === 'left' || isDraggingRef.current === 'right') {
          const centerX = window.innerWidth / 2;
          const newHalfWidth = Math.abs(e.clientX - centerX);
          const newWidth = Math.max(400, Math.min(newHalfWidth * 2, window.innerWidth - 300));
          setChatWidth(newWidth);
        } else if (isDraggingRef.current === 'top') {
          const newHeight = Math.max(200, Math.min(window.innerHeight - e.clientY, window.innerHeight - 100));
          setChatHeight(newHeight);
        }
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = null;
      document.body.classList.remove('select-none');
      if (rafId) cancelAnimationFrame(rafId);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Mermaid modal resize handlers
  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      // Handle mermaid content dragging
      if (mermaidContentDraggingRef.current && mermaidScrollStartRef.current && mermaidContentRef.current) {
        const deltaX = e.clientX - mermaidScrollStartRef.current.clientX;
        const deltaY = e.clientY - mermaidScrollStartRef.current.clientY;
        mermaidContentRef.current.scrollLeft = mermaidScrollStartRef.current.scrollLeft - deltaX;
        mermaidContentRef.current.scrollTop = mermaidScrollStartRef.current.scrollTop - deltaY;
        return;
      }

      if (!isMermaidModalDraggingRef.current) return;

      // Use requestAnimationFrame for smooth updates
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const direction = isMermaidModalDraggingRef.current;

        if (direction === 'move') {
          // Move the entire modal
          if (modalDragStartRef.current) {
            const deltaX = e.clientX - modalDragStartRef.current.x;
            const deltaY = e.clientY - modalDragStartRef.current.y;
            setMermaidModalLeft(modalDragStartRef.current.left + deltaX);
            setMermaidModalTop(modalDragStartRef.current.top + deltaY);
          }
        } else if (direction === 'right') {
          // Adjust width from right edge
          const newWidth = Math.max(300, e.clientX - mermaidModalLeft);
          setMermaidModalWidth(newWidth);
        } else if (direction === 'left') {
          // Adjust width and left position from left edge
          const delta = e.clientX - mermaidModalLeft;
          const newLeft = Math.max(0, e.clientX);
          const newWidth = Math.max(300, mermaidModalWidth - delta);
          setMermaidModalLeft(newLeft);
          setMermaidModalWidth(newWidth);
        } else if (direction === 'bottom') {
          // Adjust height from bottom edge
          const newHeight = Math.max(200, e.clientY - mermaidModalTop);
          setMermaidModalHeight(newHeight);
        } else if (direction === 'top') {
          // Adjust height and top position from top edge
          const delta = e.clientY - mermaidModalTop;
          const newTop = Math.max(0, e.clientY);
          const newHeight = Math.max(200, mermaidModalHeight - delta);
          setMermaidModalTop(newTop);
          setMermaidModalHeight(newHeight);
        }
      });
    };

    const handleMouseUp = () => {
      isMermaidModalDraggingRef.current = null;
      modalDragStartRef.current = null;
      mermaidContentDraggingRef.current = false;
      mermaidScrollStartRef.current = null;
      document.body.classList.remove('select-none');
      if (rafId) cancelAnimationFrame(rafId);
      // Remove grabbing cursor
      if (mermaidContentRef.current) {
        mermaidContentRef.current.style.cursor = 'grab';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [mermaidModalLeft, mermaidModalTop, mermaidModalWidth, mermaidModalHeight]);

  useEffect(() => {
    // 如果有选中的历史记录需要加载，跳过状态重置
    // 让 selectedHistoryRecord 的 useEffect 来处理状态恢复
    if (selectedHistoryRecord) return;

    // 如果刚刚完成历史记录加载，跳过清空（防止清空刚加载的内容）
    if (justLoadedHistoryRef.current) {
      justLoadedHistoryRef.current = false;
      return;
    }

    setIsLoading(false);
    setBlocks([]);
    setOriginalBlocks([]);
    setIsDiffMode(false);
    setSelectedBlockIds(new Set());
    setPrompt('');
    setChatHistory([]);
    setSuggestions(geminiService.getSuggestions(type));
    setIsChatExpanded(true);
    setIsModelMenuOpen(false);
    setIsSourcePanelOpen(false);
    setActiveSourceLocation(null);
  }, [type, selectedHistoryRecord]);

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

  // 源代码面板打开时，滚动高亮的 block 到视图中心
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

  const toggleBlockSelection = (block: WikiBlock) => {
    if (isDiffMode) return; 
    const newSet = new Set(selectedBlockIds);
    if (newSet.has(block.id)) {
      newSet.delete(block.id);
    } else {
      newSet.add(block.id);
    }
    setSelectedBlockIds(newSet);
  };

  const clearSelection = () => setSelectedBlockIds(new Set());

  // Handle collapse/expand for tree structure
  const handleToggleCollapse = (blockId: string) => {
    setBlocks(prevBlocks => toggleBlockCollapse(prevBlocks, blockId));
  };

  const handleMermaidNodeClick = (nodeId: string, metadata?: MermaidMetadata, blockId?: string) => {
    let location = metadata?.sourceMapping?.[nodeId];

    if (!location) {
        console.log(`No strict mapping for node ${nodeId}, using demo fallback.`);
        const files = Object.keys(MOCK_REPO_FILES);
        const randomFile = files[Math.floor(Math.random() * files.length)];
        const fileContent = MOCK_REPO_FILES[randomFile];
        const lineCount = fileContent.split('\n').length;
        const randomLine = Math.floor(Math.random() * Math.max(1, lineCount - 10)) + 5;

        location = {
            file: randomFile,
            line: randomLine
        };
    }

    setActiveSourceLocation(location);
    setIsSourcePanelOpen(true);
    setHighlightedMermaidNodeId(nodeId);
    // Also set highlighted block to center the chart
    if (blockId) {
      setHighlightedBlockId(blockId);
    }
  };

  // Handle Mermaid double click
  const handleMermaidDoubleClick = (chart: string, metadata?: MermaidMetadata) => {
    setMermaidModalChart(chart);
    setMermaidModalMetadata(metadata);
    setMermaidModalZoom(1);
    const initialWidth = window.innerWidth * 0.95;
    const initialHeight = window.innerHeight * 0.95;
    setMermaidModalWidth(initialWidth);
    setMermaidModalHeight(initialHeight);
    setMermaidModalLeft(window.innerWidth * 0.025);
    setMermaidModalTop(window.innerHeight * 0.025);
    setMermaidModalOpen(true);
  };

  // Adjust modal size when source panel opens
  useEffect(() => {
    if (mermaidModalOpen && isSourcePanelOpen) {
      // Shrink modal width to leave space for source panel
      const targetWidth = window.innerWidth * 0.6;
      setMermaidModalWidth(targetWidth);
    }
  }, [isSourcePanelOpen, mermaidModalOpen]);

  // Handle source code click from any block
  const handleSourceClick = (blockId: string, sourceId: string, sources: any[]) => {
    // Find the source by ID
    const source = sources.find(s => s.source_id === sourceId);

    if (source) {
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

      setActiveSourceLocation(location);
      setIsSourcePanelOpen(true);
      setHighlightedBlockId(blockId);
    }
  };

  // 切换到指定页面
  const handlePageSwitch = async (pagePath: string) => {
    if (pagePath === currentPagePath || isLoadingPage) return;

    setIsLoadingPage(true);
    console.log('[CodeNexus Debug] 切换页面:', { from: currentPagePath, to: pagePath });

    try {
      const wikiPage = await codenexusWikiService.fetchPage(pagePath);
      const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);

      setBlocks(parsedBlocks);
      setCurrentPagePath(pagePath);
      // 折叠状态已在树形结构的 isCollapsed 字段中管理
      setSelectedBlockIds(new Set()); // 重置选择状态

      console.log('[CodeNexus Debug] 页面切换成功:', {
        pagePath,
        blocksCount: parsedBlocks.length
      });

      // 等待渲染完成后滚动到页面顶部
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0;
        }
      });

    } catch (error) {
      console.error('页面切换失败:', error);
    } finally {
      setIsLoadingPage(false);
    }
  };

  const handleApplyChanges = async () => {
    // 如果有 pending page diff，调用后端 API 应用变更
    if (pendingPageDiff && currentPagePath) {
      try {
        console.log('[AnalysisView] 调用后端 API 应用变更:', currentPagePath);
        const result = await codenexusWikiService.applyChanges(currentPagePath, pendingPageDiff);
        console.log('[AnalysisView] 应用变更结果:', result);
      } catch (error) {
        console.error('[AnalysisView] 应用变更失败:', error);
        setChatHistory(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `❌ 应用变更失败: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now()
        }]);
        return;
      }
    }

    // 递归删除所有标记为 deleted 的节点，然后清除所有状态标记
    const blocksWithoutDeleted = removeDeletedBlocks(blocks);
    const appliedBlocks = clearBlockStatuses(blocksWithoutDeleted);

    setBlocks(appliedBlocks);
    setOriginalBlocks([]);
    setIsDiffMode(false);
    setPendingPageDiff(null);

    // ✅ 更新缓存：清除当前页面的缓存，下次访问时会重新从后端获取最新内容
    if (currentPagePath) {
      console.log('[AnalysisView] 清除已修改页面的缓存:', currentPagePath);
      wikiPageCache.remove(currentPagePath);
    }

    setChatHistory(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '✅ 已应用所有变更。',
        timestamp: Date.now()
    }]);
  };

  const handleDiscardChanges = () => {
    setBlocks(originalBlocks);
    setOriginalBlocks([]);
    setIsDiffMode(false);
    setPendingPageDiff(null);

    setChatHistory(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '已放弃变更，文档恢复到上一版本。',
        timestamp: Date.now()
    }]);
  };

  const handleQuestionConfirm = async (selectedQuestions: ExpandedQuestion[]) => {
    setShowQuestionSelector(false);
    setIsLoading(true);

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
      console.log('[CodeNexus Debug] 开始执行工作流:', {
        userQuery: currentUserQuery,
        selectedQuestions: selectedQuestions.map(q => ({
          id: q.id,
          query: q.query
        }))
      });

      updateProgress('正在执行工作流分析...');
      const workflowResult = await codenexusWikiService.executeWorkflow(
        currentUserQuery,
        selectedQuestions,
        updateProgress
      );

      console.log('[CodeNexus Debug] 工作流执行响应:', {
        wiki_root: workflowResult.wiki_root,
        wiki_pages: workflowResult.wiki_pages,
        pagesCount: workflowResult.wiki_pages.length
      });

      updateProgress(`生成了 ${workflowResult.wiki_pages.length} 个 Wiki 页面，正在加载...`);

      // 保存页面列表到状态
      setWikiPages(workflowResult.wiki_pages);

      // 加载第一个页面（通常是 summary 或主页面）
      const firstPage = workflowResult.wiki_pages[0];
      setCurrentPagePath(firstPage);
      console.log('[CodeNexus Debug] 准备加载第一个页面:', firstPage);

      const wikiPage = await codenexusWikiService.fetchPage(firstPage);
      console.log('[CodeNexus Debug] Wiki 页面内容:', {
        contentBlocksCount: wikiPage.content.length,
        sourcesCount: wikiPage.source.length,
        contentStructure: wikiPage.content.map(c => ({
          type: c.type,
          id: c.id,
          title: c.title,
          content: c.content,  // 完整内容
          source_id: c.source_id,
          hasSourceId: !!c.source_id
        })),
        sources: wikiPage.source.map(s => ({
          source_id: s.source_id,
          name: s.name,
          lines: s.lines
        }))
      });

      updateProgress('解析 Wiki 对象结构...');

      // 使用新的解析器将结构化内容转换为 WikiBlock
      const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
      console.log('[CodeNexus Debug] 解析后的 WikiBlock:', {
        blocksCount: parsedBlocks.length,
        blockTypes: parsedBlocks.map(b => b.type),
        blocks: parsedBlocks.map(b => ({
          id: b.id,
          type: b.type,
          content: b.content,  // 完整内容
          contentLength: b.content?.length || 0,
          level: b.level,
          language: (b.type === 'code' || b.type === 'mermaid') ? (b as any).language : undefined  // 代码块语言
        }))
      });

      setBlocks(parsedBlocks);

      // 等待渲染完成后滚动到页面顶部
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0;
        }
      });

      // Save to history - 直接传入 firstPage 和 wiki_pages，避免 React 状态异步更新的问题
      saveToHistory(currentUserQuery, parsedBlocks, firstPage, workflowResult.wiki_pages);

      // 如果有多个页面，提示用户
      let contentMessage = `已生成 ${TITLE_MAP[type]} 的完整分析报告，包含 ${parsedBlocks.length} 个交互式对象。`;
      if (workflowResult.wiki_pages.length > 1) {
        contentMessage += `\n\n📚 共生成 ${workflowResult.wiki_pages.length} 个页面，当前显示: ${firstPage.split('/').pop()}`;
      }
      contentMessage += `\n\n📁 Wiki 根目录: ${workflowResult.wiki_root}`;

      console.log('[CodeNexus Debug] 工作流完成，最终消息:', contentMessage);

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

  // History handlers
  const saveToHistory = (userQuery: string, generatedBlocks: WikiBlock[], overridePagePath?: string, overrideWikiPages?: string[]) => {
    // 使用传入的参数或当前状态值（解决 React 状态异步更新的问题）
    const finalPagePath = overridePagePath ?? currentPagePath;
    const finalWikiPages = overrideWikiPages ?? wikiPages;

    const record: WikiHistoryRecord = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      userQuery,
      modelId: selectedModel,
      pagePath: finalPagePath || undefined,
      wikiPages: finalWikiPages.length > 0 ? finalWikiPages : undefined,
      blocksCount: generatedBlocks.length // 只存储数量用于显示
      // 不再存储 blocks，改为从缓存中获取
    };
    setWikiHistory(prev => [record, ...prev].slice(0, 50)); // Keep last 50 records
  };


  const handleAnalyze = async () => {
    if (!prompt.trim()) return;
    const currentPrompt = prompt.trim();
    setPrompt('');
    setIsLoading(true);

    const currentSelectedIds = new Set(selectedBlockIds);
    // Use collectBlocksByIds to recursively find all selected blocks in tree structure
    const referencedBlocks = collectBlocksByIds(blocks, currentSelectedIds);
    
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: currentPrompt,
      timestamp: Date.now(),
      references: referencedBlocks.length > 0 ? referencedBlocks : undefined
    };
    setChatHistory(prev => [...prev, userMsg]);
    
    clearSelection();
    setIsChatExpanded(true);

    // Placeholder for assistant message to stream steps
    const assistantMsgId = (Date.now() + 1).toString();
    setChatHistory(prev => [...prev, {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        steps: ['初始化请求...'],
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
      const currentModelName = AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || selectedModel;
      let finalContent = '';

      // Check if CodeNexus Wiki model is selected
      if (selectedModel === 'codenexus-wiki') {
        // 如果有选中的 blocks，执行块级细化
        if (referencedBlocks.length > 0 && currentPagePath) {
          updateProgress(`检测到 ${referencedBlocks.length} 个选中的块，正在执行块级细化...`);
          console.log('[CodeNexus Debug] 调用 detailedQuery:', {
            pagePath: currentPagePath,
            blockIds: Array.from(currentSelectedIds),
            userQuery: currentPrompt
          });

          const blockIds = Array.from(currentSelectedIds);
          const response = await codenexusWikiService.detailedQuery(
            currentPagePath,
            blockIds,
            currentPrompt
          );

          // 判断响应类型
          if ('new_page_path' in response) {
            // 新增页面
            updateProgress('AI 建议创建新页面...');

            const parsedBlocks = parseWikiPageToBlocks(response.new_page.content, response.new_page.source);

            // 将新页面添加到页面列表
            setWikiPages(prev => [...prev, response.new_page_path]);
            setCurrentPagePath(response.new_page_path);
            setBlocks(parsedBlocks);

            finalContent = `已创建新页面：${response.new_page_path}\n\n包含 ${parsedBlocks.length} 个对象。`;
          } else {
            // 修改当前页面
            updateProgress('AI 正在分析并生成修改建议...');

            // 保存原始状态
            setOriginalBlocks([...blocks]);

            // 应用修改操作 - 使用树形结构操作
            let newBlocks = [...blocks];

            // 1. 标记要删除的 blocks (使用树形结构函数)
            response.delete_blocks.forEach(blockId => {
              newBlocks = markBlockAsDeleted(newBlocks, blockId);
            });

            // 2. 插入新的 blocks (使用树形结构函数)
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

            setBlocks(newBlocks);
            setIsDiffMode(true);
            // 保存 page_diff 供后续应用变更时使用
            setPendingPageDiff(response);

            const insertCount = response.insert_blocks.length;
            const deleteCount = response.delete_blocks.length;

            finalContent = `已生成修改建议：\n- 新增 ${insertCount} 个块\n- 删除 ${deleteCount} 个块\n\n请查看差异预览，确认后点击"应用变更"。`;
          }

          setChatHistory(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, content: finalContent, steps: [...(msg.steps || []), '完成'] }
              : msg
          ));
          setIsLoading(false);
          return;
        }

        // CodeNexus Workflow - 扩展查询
        updateProgress('正在使用 CodeNexus AI 分析您的问题...');
        console.log('[CodeNexus Debug] 开始扩展查询:', { userQuery: currentPrompt });

        const questions = await codenexusWikiService.expandQuery(currentPrompt);
        console.log('[CodeNexus Debug] 扩展查询响应:', {
          questionsCount: questions.length,
          questions: questions.map(q => ({
            id: q.id,
            query: q.query,
            keywords_cn: q.search_keywords_cn,
            keywords_en: q.search_keywords_en,
            targets: q.targets
          }))
        });

        setCurrentUserQuery(currentPrompt);
        setExpandedQuestions(questions);
        updateProgress(`生成了 ${questions.length} 个扩展问题，等待您的选择...`);

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

      if (referencedBlocks.length > 0) {
        const operations = await geminiService.refineBlocks(referencedBlocks, currentPrompt, selectedModel, updateProgress);

        updateProgress('正在构建差异预览...');
        setOriginalBlocks(blocks);

        // 使用树形结构操作函数
        let newBlocks = [...blocks];
        let addedCount = 0;
        let updatedCount = 0;
        let deletedCount = 0;

        operations.forEach(op => {
            if (op.action === 'DELETE') {
                newBlocks = markBlockAsDeleted(newBlocks, op.targetId);
                deletedCount++;
            }
            if (op.action === 'UPDATE' && op.content) {
                newBlocks = updateBlockContent(newBlocks, op.targetId, op.content);
                updatedCount++;
            }
            if (op.action === 'INSERT_AFTER' && op.content) {
                const { content: cleanContent, metadata } = parseSingleBlockUpdate(op.content);
                const newBlock: WikiBlock = {
                   id: `block-${Date.now()}-${Math.random().toString(36).substr(2,6)}`,
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

        setBlocks(newBlocks);
        setIsDiffMode(true);
        finalContent = `已生成内容变更预览。请在文档底部审查变更，点击"应用变更"以生效。`;
      } else {
        const resultText = await geminiService.analyze(type, currentPrompt, selectedModel, updateProgress);
        updateProgress('解析 Wiki 对象结构...');
        const parsedBlocks = parseMarkdownToBlocks(resultText);
        setBlocks(parsedBlocks);
        setOriginalBlocks([]);
        setIsDiffMode(false);
        finalContent = `已生成 ${TITLE_MAP[type]} 的完整分析报告，包含 ${parsedBlocks.length} 个交互式对象。`;
        // Save to history
        saveToHistory(currentPrompt, parsedBlocks);
      }
      
      // Finalize assistant message
      setChatHistory(prev => prev.map(msg => 
        msg.id === assistantMsgId 
            ? { ...msg, content: finalContent, steps: [...(msg.steps || []), '完成'] } 
            : msg
      ));

    } catch (error) {
      console.error("Analysis Failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setChatHistory(prev => prev.map(msg => 
        msg.id === assistantMsgId 
            ? { ...msg, content: `执行过程中遇到了问题：\n${errorMessage}`, steps: [...(msg.steps || []), '错误: 执行中断'] } 
            : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full relative flex flex-col bg-[#F5F5F7]">
      {/* Mermaid Modal */}
      {mermaidModalOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/20 pointer-events-none">
          <div
            className="absolute bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
            style={{
              left: `${mermaidModalLeft}px`,
              top: `${mermaidModalTop}px`,
              width: `${mermaidModalWidth}px`,
              height: `${mermaidModalHeight}px`,
              transition: isSourcePanelOpen ? 'width 0.3s ease-in-out' : 'none',
              willChange: isMermaidModalDraggingRef.current ? 'width, height, left, top' : 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setMermaidModalZoom(prev => {
                  const delta = e.deltaY > 0 ? -0.1 : 0.1;
                  return Math.max(0.5, Math.min(3, prev + delta));
                });
              }
            }}
          >
            {/* Resize handles */}
            <div
              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/30 z-10"
              onMouseDown={(e) => {
                e.stopPropagation();
                isMermaidModalDraggingRef.current = 'left';
                document.body.classList.add('select-none');
              }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/30 z-10"
              onMouseDown={(e) => {
                e.stopPropagation();
                isMermaidModalDraggingRef.current = 'right';
                document.body.classList.add('select-none');
              }}
            />
            <div
              className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/30 z-10"
              onMouseDown={(e) => {
                e.stopPropagation();
                isMermaidModalDraggingRef.current = 'top';
                document.body.classList.add('select-none');
              }}
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/30 z-10"
              onMouseDown={(e) => {
                e.stopPropagation();
                isMermaidModalDraggingRef.current = 'bottom';
                document.body.classList.add('select-none');
              }}
            />

            <div
              className="flex items-center justify-between p-4 border-b border-gray-200 cursor-move"
              onMouseDown={(e) => {
                // Don't initiate drag if clicking on the close button
                if ((e.target as HTMLElement).closest('button')) {
                  return;
                }
                e.stopPropagation();
                isMermaidModalDraggingRef.current = 'move';
                document.body.classList.add('select-none');
                modalDragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  left: mermaidModalLeft,
                  top: mermaidModalTop
                };
              }}
            >
              <h3 className="text-lg font-semibold text-gray-900">Mermaid 图表</h3>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500 mr-2">拖拽此处移动</div>
                <button
                  onClick={() => setMermaidModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div
              ref={mermaidContentRef}
              className="flex-1 overflow-auto p-6 cursor-grab active:cursor-grabbing"
              style={{
                overflow: 'auto',
                position: 'relative'
              }}
              onMouseDown={(e) => {
                // Start dragging the mermaid content
                if (mermaidContentRef.current) {
                  mermaidContentDraggingRef.current = true;
                  mermaidScrollStartRef.current = {
                    scrollLeft: mermaidContentRef.current.scrollLeft,
                    scrollTop: mermaidContentRef.current.scrollTop,
                    clientX: e.clientX,
                    clientY: e.clientY
                  };
                  mermaidContentRef.current.style.cursor = 'grabbing';
                  e.preventDefault();
                }
              }}
            >
              <div style={{
                transform: `scale(${mermaidModalZoom})`,
                transformOrigin: 'top left',
                transition: 'transform 0.2s',
                display: 'inline-block',
                minWidth: '100%'
              }}>
                <Mermaid
                  chart={mermaidModalChart}
                  metadata={mermaidModalMetadata}
                  onNodeClick={(nodeId: string) => {
                    handleMermaidNodeClick(nodeId, mermaidModalMetadata);
                  }}
                />
              </div>
            </div>
            <div className="p-3 border-t border-gray-200 text-center text-xs text-gray-500">
              按住 Ctrl + 滚轮可调整大小 (当前: {Math.round(mermaidModalZoom * 100)}%) | 拖拽图表内容查看不同区域 | 右键点击节点可查看源代码 | 拖拽边缘调整窗口大小
            </div>
          </div>
        </div>
      )}

      <SourceCodePanel
        isOpen={isSourcePanelOpen}
        onClose={() => { setIsSourcePanelOpen(false); setHighlightedBlockId(null); setHighlightedMermaidNodeId(null); }}
        location={activeSourceLocation}
        panelWidth={sourcePanelWidth}
        onWidthChange={setSourcePanelWidth}
      />

      {/* Main Content Area */}
      <div
        ref={mainContentRef}
        className="flex-1 overflow-y-auto scroll-smooth no-scrollbar w-full pb-[200px]"
        style={{ paddingRight: isSourcePanelOpen ? sourcePanelWidth : 0 }}
      >
        {!hasContent && (
          <div className="min-h-[50vh] flex flex-col items-center justify-center px-6 animate-in fade-in duration-700 pt-10">
             <div className="w-16 h-16 bg-gradient-to-tr from-[#0071E3] to-[#5AC8FA] rounded-[1.5rem] shadow-xl mb-6 flex items-center justify-center text-white">
                <Sparkles size={32} />
             </div>
             <h2 className="text-3xl font-semibold text-[#1d1d1f] mb-3 tracking-tight text-center">
               {TITLE_MAP[type]}
             </h2>
             <p className="text-[#86868b] text-base font-light max-w-lg text-center leading-relaxed">
               选择下方建议或输入指令，AI 将生成可交互的 WIKI 对象。
             </p>
          </div>
        )}

        {blocks.length > 0 && (
          <div className="px-4 md:px-12 pt-8">
            <div className="flex gap-6">
              {/* 左侧：页面导航 */}
              {wikiPages.length > 1 && (
                <div className={`
                  flex-shrink-0 transition-all duration-300 ease-in-out
                  ${isNavigatorVisible ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden'}
                `}>
                  <div className="sticky top-8">
                    <WikiPageNavigator
                      wikiPages={wikiPages}
                      currentPage={currentPagePath}
                      onPageSelect={handlePageSwitch}
                      onToggleVisibility={() => setIsNavigatorVisible(false)}
                      blocks={blocks}
                      onBlockClick={(blockId) => {
                        document.getElementById(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
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
                <div className={`
                  bg-white rounded-[2.5rem] shadow-apple-card p-8 md:p-12 border border-white min-h-[50vh] animate-in fade-in slide-in-from-bottom-8 duration-500 mb-10
                  ${isDiffMode ? 'ring-2 ring-amber-400 ring-offset-4 ring-offset-[#F5F5F7]' : ''}
                  relative
                `}>
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
                        <span className="text-xs font-medium text-[#0071E3] bg-blue-50 px-3 py-1 rounded-full flex items-center gap-1">
                            <Sparkles size={10} /> 交互式代码Wiki
                        </span>
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
                              onToggleSelect={toggleBlockSelection}
                              onMermaidNodeClick={handleMermaidNodeClick}
                              onSourceClick={handleSourceClick}
                              onToggleCollapse={handleToggleCollapse}
                              selectedBlockIds={selectedBlockIds}
                              highlightedBlockId={highlightedBlockId}
                              highlightedMermaidNodeId={highlightedMermaidNodeId}
                              onMermaidDoubleClick={handleMermaidDoubleClick}
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
      <div
        className={`
         fixed bottom-0 left-64 z-50
         flex flex-col items-center
         transition-all duration-300 ease-apple-ease
         ${hasContent ? 'translate-y-0' : 'translate-y-0'}
      `}
        style={{ right: isSourcePanelOpen ? sourcePanelWidth : 0 }}
      >
        {/* Diff Confirmation Bar (Floating) */}
        {isDiffMode && (
            <div className="w-full max-w-2xl animate-in slide-in-from-bottom-10 fade-in duration-300 mb-4 pointer-events-auto px-4">
                <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-amber-100 p-4 flex items-center justify-between ring-1 ring-amber-200">
                    <div className="flex items-center gap-3">
                        <div className="bg-amber-100 p-2 rounded-full text-amber-600">
                            <FileDiff size={20} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-[#1d1d1f]">审查变更</h3>
                            <p className="text-xs text-[#86868b]">请确认是否应用 AI 生成的修改</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={handleDiscardChanges}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                        >
                            <XCircle size={16} /> 放弃
                        </button>
                        <button 
                            onClick={handleApplyChanges}
                            className="flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 shadow-md shadow-emerald-200 transition-all"
                        >
                            <CheckCircle2 size={16} /> 应用变更
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Main Chat Container (Unified) */}
        <div className={`
            relative bg-white/85 backdrop-blur-xl shadow-[0_-10px_40px_rgba(0,0,0,0.08)] border border-white/50
            flex flex-col overflow-hidden
            transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
            ${hasContent ? 'rounded-t-[2rem]' : 'rounded-[2rem] mb-10'}
            ${!isChatExpanded && hasContent ? 'translate-y-[calc(100%-110px)]' : 'translate-y-0'}
        `}
        style={hasContent ? { width: chatWidth, height: isChatExpanded ? chatHeight : 110, maxHeight: '90vh', minWidth: 400, willChange: isDraggingRef.current ? 'width, height' : 'auto' } : { width: 768 }}
        >
            {/* Resize handles - only show when has content */}
            {hasContent && (
              <>
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-200/50 z-10"
                  onMouseDown={() => {
                    isDraggingRef.current = 'left';
                    document.body.classList.add('select-none');
                  }}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-200/50 z-10"
                  onMouseDown={() => {
                    isDraggingRef.current = 'right';
                    document.body.classList.add('select-none');
                  }}
                />
                <div
                  className="absolute top-0 left-2 right-2 h-2 cursor-ns-resize hover:bg-blue-200/50 z-10"
                  onMouseDown={() => {
                    isDraggingRef.current = 'top';
                    document.body.classList.add('select-none');
                  }}
                />
              </>
            )}
            {/* Drag Handle for Collapse/Expand */}
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

                            {/* References */}
                            {msg.role === 'user' && msg.references && msg.references.length > 0 && (
                                <div className="mb-2 flex flex-wrap gap-2 justify-end">
                                {msg.references.map(ref => (
                                    <div key={ref.id} className="bg-blue-50/50 border border-blue-100/50 pl-2 pr-3 py-1.5 rounded-xl text-xs text-[#0071E3] flex items-center gap-2 max-w-[220px] shadow-sm">
                                    <div className="bg-blue-100 p-1 rounded-md">
                                        <Quote size={10} className="text-blue-600" />
                                    </div>
                                    <div className="flex flex-col overflow-hidden">
                                        <span className="font-bold uppercase text-[9px] tracking-wider text-blue-400 mb-0.5 leading-none">{ref.type}</span>
                                        <span className="truncate leading-none opacity-90">{ref.content.substring(0, 25).replace(/\n/g, ' ')}...</span>
                                    </div>
                                    </div>
                                ))}
                                </div>
                            )}

                            {/* Assistant Icon */}
                            {msg.role === 'assistant' && (
                                <div className="flex items-center gap-2 mb-1.5 ml-1">
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#0071E3] to-[#5AC8FA] flex items-center justify-center text-white shadow-sm">
                                        <Bot size={14} />
                                    </div>
                                </div>
                            )}

                            {/* Thinking Chain (Streaming Steps) */}
                            {msg.role === 'assistant' && (
                                <ThinkingChain steps={msg.steps || []} isFinished={!!msg.content && msg.content.length > 0 && !isLoading} />
                            )}

                            {/* Message Content */}
                            {msg.content && (
                                <div className={`
                                    px-5 py-3.5 rounded-[1.2rem] text-sm leading-relaxed shadow-sm whitespace-pre-wrap
                                    ${msg.role === 'user'
                                        ? 'bg-[#0071E3] text-white rounded-br-sm shadow-blue-200/50'
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

            {/* Selection Bar (Inside Deck) */}
            {selectedBlockIds.size > 0 && (
                <div className="w-full flex flex-wrap gap-2 px-6 py-2 bg-gray-50/50 border-t border-gray-100 items-center">
                     <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mr-1">References:</span>
                    {Array.from(selectedBlockIds).map(id => {
                    // Use findBlockById to recursively search in tree structure
                    const block = findBlockById(blocks, id);
                    return (
                        <div key={id} className="bg-white text-[#0071E3] border border-blue-100 pl-2 pr-1 py-1 rounded-md text-xs font-medium shadow-sm flex items-center max-w-[180px]">
                        <span className="truncate mr-1">{block?.type}: {block?.content.substring(0, 10)}...</span>
                        <button onClick={() => toggleBlockSelection(block!)} className="hover:bg-gray-100 rounded p-0.5 text-gray-400 hover:text-red-500">
                            <X size={10} />
                        </button>
                        </div>
                    );
                    })}
                    <button onClick={clearSelection} className="ml-auto text-[10px] text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
                    Clear
                    </button>
                </div>
            )}

            {/* Input Area (Fixed at bottom of deck) */}
            <div className="relative w-full p-4 bg-white/50 backdrop-blur-md border-t border-white/50">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={selectedBlockIds.size > 0 ? "针对选中的内容，请输入您的修改建议..." : "描述分析需求..."}
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
                     {/* Left side: Model Selector */}
                     <div className="flex items-center gap-2">
                       {/* Model Selector */}
                       <div className="relative">
                          <button
                              onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gray-100/50 hover:bg-gray-100 border border-gray-200/50 text-xs text-[#1d1d1f] transition-colors"
                          >
                              <Cpu size={12} className="text-[#0071E3]" />
                              {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}
                              <ChevronUp size={12} className={`text-gray-400 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`} />
                          </button>

                           {/* Model Menu Overlay */}
                          {isModelMenuOpen && (
                              <>
                                  <div className="fixed inset-0 z-[100]" onClick={() => setIsModelMenuOpen(false)} />
                                  <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-xl shadow-apple-hover border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-[101]">
                                  {AVAILABLE_MODELS.map(model => (
                                      <button
                                      key={model.id}
                                      onClick={() => {
                                          setSelectedModel(model.id);
                                          setIsModelMenuOpen(false);
                                      }}
                                      className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-gray-50 transition-colors ${selectedModel === model.id ? 'text-[#0071E3] font-medium bg-blue-50/50' : 'text-[#1d1d1f]'}`}
                                      >
                                      {model.name}
                                      {selectedModel === model.id && <Check size={12} className="text-[#0071E3]" />}
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
                            className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <Eraser size={16} />
                        </button>
                        )}
                        <button
                        onClick={handleAnalyze}
                        disabled={!prompt.trim() || isLoading}
                        className={`
                            bg-[#0071E3] hover:bg-[#0077ED] disabled:bg-[#e5e5ea] disabled:text-[#86868b] 
                            text-white rounded-full flex items-center justify-center transition-all duration-200 shadow-md w-8 h-8
                        `}
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
                    className="text-left px-4 py-3 bg-white/60 hover:bg-white border border-gray-200/50 hover:border-blue-200 rounded-xl text-xs text-gray-600 hover:text-[#0071E3] transition-all shadow-sm hover:shadow-md"
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
