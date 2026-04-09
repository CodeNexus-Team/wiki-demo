import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { ghcolors, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ChatMessage as ChatMessageType, WikiBlock } from '../../types';
import { Bot, Quote } from 'lucide-react';
import { ThinkingChain } from './ThinkingChain';

interface ChatMessageProps {
  message: ChatMessageType;
  isLoading?: boolean;
  variant?: 'blue' | 'orange';
  isDarkMode?: boolean;
  onClarificationSelect?: (option: string) => void;
  onClarificationMultiSubmit?: (options: string[]) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isLoading = false,
  variant = 'blue',
  isDarkMode = false,
  onClarificationSelect,
  onClarificationMultiSubmit
}) => {
  const [multiSelected, setMultiSelected] = React.useState<Set<string>>(new Set());
  const [showCustomInput, setShowCustomInput] = React.useState(false);
  const [customText, setCustomText] = React.useState('');
  const customInputRef = React.useRef<HTMLInputElement>(null);
  const isUser = message.role === 'user';
  const isFinished = !!message.content && message.content.length > 0 && !isLoading;

  const userBgClass = variant === 'orange'
    ? 'bg-gradient-to-br from-orange-500 to-orange-600 shadow-orange-200/50'
    : 'bg-[#0071E3] shadow-blue-200/50';

  const botGradientClass = variant === 'orange'
    ? 'bg-gradient-to-br from-orange-500 to-orange-600'
    : 'bg-gradient-to-br from-[#0071E3] to-[#5AC8FA]';

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col max-w-[90%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* References */}
        {isUser && message.references && message.references.length > 0 && (
          <MessageReferences references={message.references} />
        )}

        {/* Assistant Icon */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-1.5 ml-1">
            <div className={`w-6 h-6 rounded-full ${botGradientClass} flex items-center justify-center text-white shadow-sm`}>
              <Bot size={14} />
            </div>
          </div>
        )}

        {/* Thinking Chain */}
        {!isUser && message.steps && (
          <ThinkingChain
            steps={message.steps}
            isFinished={isFinished}
            variant={variant}
          />
        )}

        {/* Message Content */}
        {message.content && (
          <div className={`
            px-5 py-3.5 rounded-[1.2rem] text-sm leading-relaxed shadow-sm
            ${isUser
              ? `${userBgClass} text-white rounded-br-sm whitespace-pre-wrap`
              : isDarkMode
                ? 'bg-[#161b22] border border-[#30363d] text-[#e6edf3] rounded-tl-sm'
                : 'bg-white border border-[#e5e5ea] text-[#1d1d1f] rounded-tl-sm'
            }
          `}>
            {isUser ? message.content : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({node, ...props}) => <p {...props} className="mb-2 last:mb-0" />,
                  a: ({node, ...props}) => <a {...props} className={isDarkMode ? 'text-[#58a6ff] underline' : 'text-[#0071E3] underline'} />,
                  strong: ({node, ...props}) => <strong {...props} className="font-semibold" />,
                  ul: ({node, ...props}) => <ul {...props} className="list-disc pl-5 mb-2" />,
                  ol: ({node, ...props}) => <ol {...props} className="list-decimal pl-5 mb-2" />,
                  li: ({node, ...props}) => <li {...props} className="mb-0.5" />,
                  h1: ({node, ...props}) => <h1 {...props} className="text-base font-bold mb-2 mt-3 first:mt-0" />,
                  h2: ({node, ...props}) => <h2 {...props} className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0" />,
                  h3: ({node, ...props}) => <h3 {...props} className="text-sm font-semibold mb-1 mt-2 first:mt-0" />,
                  code: ({node, className, children, ...props}) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const inline = !match;
                    return inline ? (
                      <code {...props} className={`px-1 py-0.5 rounded text-[13px] font-mono ${
                        isDarkMode ? 'bg-[#30363d] text-[#f0883e]' : 'bg-gray-100 text-[#d63384]'
                      }`}>{children}</code>
                    ) : (
                      <SyntaxHighlighter
                        language={match![1]}
                        style={isDarkMode ? vscDarkPlus : ghcolors}
                        customStyle={{
                          margin: '0.5rem 0', padding: '0.75rem', borderRadius: '0.5rem', fontSize: '13px',
                          backgroundColor: isDarkMode ? '#0d1117' : undefined,
                        }}
                        wrapLongLines
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    );
                  },
                  table: ({node, ...props}) => (
                    <div className="overflow-x-auto my-2">
                      <table {...props} className="w-full border-collapse text-xs" />
                    </div>
                  ),
                  thead: ({node, ...props}) => <thead {...props} className={isDarkMode ? 'bg-[#21262d]' : 'bg-gray-50'} />,
                  th: ({node, ...props}) => <th {...props} className={`px-2 py-1 text-left font-semibold border ${isDarkMode ? 'border-[#30363d]' : 'border-gray-200'}`} />,
                  td: ({node, ...props}) => <td {...props} className={`px-2 py-1 border ${isDarkMode ? 'border-[#30363d]' : 'border-gray-200'}`} />,
                  blockquote: ({node, ...props}) => <blockquote {...props} className={`border-l-3 pl-3 my-2 italic ${isDarkMode ? 'border-[#30363d] text-[#7d8590]' : 'border-gray-300 text-gray-600'}`} />,
                  hr: () => <hr className={`my-3 ${isDarkMode ? 'border-[#30363d]' : 'border-gray-200'}`} />,
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}

            {/* Clarification Options */}
            {!isUser && message.clarificationOptions && message.clarificationOptions.length > 0 && onClarificationSelect && (
              <div className={`flex flex-col gap-1.5 mt-3 pt-3 border-t ${isDarkMode ? 'border-[#30363d]/60' : 'border-[#e5e5ea]/60'}`}>
                {message.clarificationOptions.filter(opt => !opt.includes('其他')).map((opt, i) => {
                  const isChecked = multiSelected.has(opt);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (message.clarificationMultiSelect) {
                          setMultiSelected(prev => {
                            const next = new Set(prev);
                            next.has(opt) ? next.delete(opt) : next.add(opt);
                            return next;
                          });
                        } else {
                          onClarificationSelect(opt);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-all text-left ${
                        isChecked
                          ? isDarkMode
                            ? 'bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff] ring-1 ring-[#58a6ff]/30'
                            : 'bg-[#dbe8ff] text-[#0071E3] border border-[#0071E3] ring-1 ring-[#0071E3]/30'
                          : isDarkMode
                            ? 'bg-[#21262d] text-[#58a6ff] hover:bg-[#30363d] border border-[#30363d]'
                            : 'bg-[#f0f5ff] text-[#0071E3] hover:bg-[#dbe8ff] border border-[#c5d9f5]'
                      }`}
                    >
                      {message.clarificationMultiSelect && <span className="mr-1.5">{isChecked ? '☑' : '☐'}</span>}
                      {opt}
                    </button>
                  );
                })}
                {/* 自定义输入 */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setShowCustomInput(!showCustomInput);
                      if (!showCustomInput) {
                        setTimeout(() => customInputRef.current?.focus(), 50);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-all text-left border border-dashed ${
                      showCustomInput || customText
                        ? isDarkMode
                          ? 'border-[#58a6ff] text-[#58a6ff] bg-[#58a6ff]/10'
                          : 'border-blue-400 text-blue-600 bg-blue-50/50'
                        : isDarkMode
                          ? 'border-[#30363d] text-[#7d8590] hover:border-[#58a6ff] hover:text-[#58a6ff]'
                          : 'border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-600'
                    }`}
                  >
                    {message.clarificationMultiSelect && <span className="mr-1.5">{customText ? '☑' : '☐'}</span>}
                    其他
                  </button>
                  {showCustomInput && (
                    <input
                      ref={customInputRef}
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customText.trim()) {
                          if (!message.clarificationMultiSelect) {
                            onClarificationSelect(customText.trim());
                          }
                        }
                      }}
                      placeholder="请输入..."
                      className={`flex-1 px-2 py-1 rounded-lg text-xs border outline-none ${
                        isDarkMode
                          ? 'bg-[#0d1117] border-[#30363d] text-[#e6edf3] focus:border-[#58a6ff] placeholder:text-[#7d8590]'
                          : 'bg-white border-gray-200 text-[#1d1d1f] focus:border-[#0071E3]'
                      }`}
                    />
                  )}
                </div>
                {/* 确认按钮 */}
                {message.clarificationMultiSelect && (multiSelected.size > 0 || customText.trim()) && (
                  <button
                    onClick={() => {
                      const selected = Array.from(multiSelected);
                      if (customText.trim()) selected.push(customText.trim());
                      onClarificationMultiSubmit?.(selected);
                      setMultiSelected(new Set());
                      setCustomText('');
                      setShowCustomInput(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs text-white transition-all mt-1 ${
                      isDarkMode ? 'bg-[#238636] hover:bg-[#2ea043]' : 'bg-[#0071E3] hover:bg-[#005bb5]'
                    }`}
                  >
                    确认选择 ({multiSelected.size + (customText.trim() ? 1 : 0)})
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface MessageReferencesProps {
  references: WikiBlock[];
}

const MessageReferences: React.FC<MessageReferencesProps> = ({ references }) => {
  return (
    <div className="mb-2 flex flex-wrap gap-2 justify-end">
      {references.map(ref => (
        <div
          key={ref.id}
          className="bg-blue-50/50 border border-blue-100/50 pl-2 pr-3 py-1.5 rounded-xl text-xs text-[#0071E3] flex items-center gap-2 max-w-[220px] shadow-sm"
        >
          <div className="bg-blue-100 p-1 rounded-md">
            <Quote size={10} className="text-blue-600" />
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="font-bold uppercase text-[9px] tracking-wider text-blue-400 mb-0.5 leading-none">
              {ref.type}
            </span>
            <span className="truncate leading-none opacity-90">
              {ref.content.substring(0, 25).replace(/\n/g, ' ')}...
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ChatMessage;
