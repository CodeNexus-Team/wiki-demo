import React, { useRef, useEffect } from 'react';
import { ChatMessage as ChatMessageType, WikiBlock } from '../../types';
import { ChatMessage } from './ChatMessage';
import { SelectionBar } from './SelectionBar';
import { DiffConfirmBar } from './DiffConfirmBar';
import { Loader2, ArrowUp, Eraser } from 'lucide-react';

interface ChatPanelProps {
  // Chat state
  chatHistory: ChatMessageType[];
  isChatExpanded: boolean;
  isLoading: boolean;
  hasContent: boolean;

  // Input
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;

  // Selection
  selectedBlockIds?: Set<string>;
  blocks?: WikiBlock[];
  onToggleSelect?: (block: WikiBlock) => void;
  onClearSelection?: () => void;

  // Diff mode
  isDiffMode?: boolean;
  onApplyChanges?: () => void;
  onDiscardChanges?: () => void;

  // Expand/collapse
  onToggleExpand: () => void;

  // Refs
  chatScrollRef?: React.RefObject<HTMLDivElement>;

  // Custom content (for QuestionSelector, etc.)
  children?: React.ReactNode;

  // Footer left content (model selector, etc.)
  footerLeft?: React.ReactNode;

  // Theme variant
  variant?: 'blue' | 'orange';

  // Width/height for resizable mode (optional)
  width?: number;
  height?: number;

  // Resize handlers (optional)
  resizeHandles?: React.ReactNode;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  chatHistory,
  isChatExpanded,
  isLoading,
  hasContent,
  prompt,
  onPromptChange,
  onSubmit,
  placeholder = '描述您的需求...',
  selectedBlockIds,
  blocks,
  onToggleSelect,
  onClearSelection,
  isDiffMode = false,
  onApplyChanges,
  onDiscardChanges,
  onToggleExpand,
  chatScrollRef: externalScrollRef,
  children,
  footerLeft,
  variant = 'blue',
  width,
  height,
  resizeHandles,
}) => {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef || internalScrollRef;

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isChatExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, isChatExpanded, chatHistory[chatHistory.length - 1]?.steps?.length, scrollRef]);

  const hasSelection = selectedBlockIds && selectedBlockIds.size > 0;

  const buttonColorClass = variant === 'orange'
    ? 'bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700'
    : 'bg-[#0071E3] hover:bg-[#0077ED]';

  const dynamicPlaceholder = hasSelection
    ? '针对选中的内容，请输入您的修改建议...'
    : placeholder;

  return (
    <div
      className={`
        relative bg-white/85 backdrop-blur-xl shadow-[0_-10px_40px_rgba(0,0,0,0.08)] border border-white/50
        flex flex-col overflow-hidden
        transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
        ${hasContent ? 'rounded-t-[2rem]' : 'rounded-[2rem] mb-10'}
        ${!isChatExpanded && hasContent ? 'translate-y-[calc(100%-110px)]' : 'translate-y-0'}
      `}
      style={hasContent ? {
        width: width || 768,
        height: isChatExpanded ? (height || '70vh') : 110,
        maxHeight: '90vh',
        minWidth: 400,
      } : { width: 768 }}
    >
      {/* Resize handles (optional) */}
      {resizeHandles}

      {/* Drag Handle for Collapse/Expand */}
      {hasContent && (
        <div
          className="w-full flex justify-center py-3 cursor-pointer hover:bg-black/5 transition-colors group"
          onClick={onToggleExpand}
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
        ref={scrollRef}
      >
        {chatHistory.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            isLoading={isLoading}
            variant={variant}
          />
        ))}

        {/* Custom children (QuestionSelector, etc.) */}
        {children}
      </div>

      {/* Selection Bar */}
      {hasSelection && !isDiffMode && blocks && onToggleSelect && onClearSelection && (
        <SelectionBar
          selectedBlockIds={selectedBlockIds}
          blocks={blocks}
          onToggleSelect={onToggleSelect}
          onClear={onClearSelection}
          variant="chat"
        />
      )}

      {/* Input Area */}
      <div className="relative w-full p-4 bg-white/50 backdrop-blur-md border-t border-white/50">
        {/* Diff Confirmation Bar */}
        {isDiffMode && onApplyChanges && onDiscardChanges && (
          <DiffConfirmBar
            onApply={onApplyChanges}
            onDiscard={onDiscardChanges}
            variant="inline"
            theme={variant}
          />
        )}

        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={dynamicPlaceholder}
          className={`
            w-full bg-transparent outline-none resize-none text-[#1d1d1f] font-light placeholder:text-[#86868b]/50
            transition-all duration-300
            ${hasContent ? 'text-base min-h-[50px] max-h-[120px]' : 'text-lg min-h-[80px]'}
          `}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />

        <div className="flex justify-between items-center mt-2">
          {/* Left side: Custom content (model selector, etc.) */}
          <div className="flex items-center gap-2">
            {footerLeft}
          </div>

          {/* Right side: Clear and Submit buttons */}
          <div className="flex items-center gap-2">
            {prompt && !isLoading && (
              <button
                onClick={() => onPromptChange('')}
                className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-100 rounded-full transition-colors"
              >
                <Eraser size={16} />
              </button>
            )}
            <button
              onClick={onSubmit}
              disabled={!prompt.trim() || isLoading}
              className={`
                ${buttonColorClass}
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
  );
};

export default ChatPanel;
