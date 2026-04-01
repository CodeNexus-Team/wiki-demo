import React from 'react';
import { ChatMessage as ChatMessageType, WikiBlock } from '../../types';
import { Bot, Quote } from 'lucide-react';
import { ThinkingChain } from './ThinkingChain';

interface ChatMessageProps {
  message: ChatMessageType;
  isLoading?: boolean;
  variant?: 'blue' | 'orange';
  onClarificationSelect?: (option: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isLoading = false,
  variant = 'blue',
  onClarificationSelect
}) => {
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
            px-5 py-3.5 rounded-[1.2rem] text-sm leading-relaxed shadow-sm whitespace-pre-wrap
            ${isUser
              ? `${userBgClass} text-white rounded-br-sm`
              : 'bg-white border border-[#e5e5ea] text-[#1d1d1f] rounded-tl-sm'
            }
          `}>
            {message.content}

            {/* Clarification Options */}
            {!isUser && message.clarificationOptions && message.clarificationOptions.length > 0 && onClarificationSelect && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#e5e5ea]/60">
                {message.clarificationOptions.map((opt, i) => {
                  const isOther = opt.includes('其他');
                  return (
                    <button
                      key={i}
                      onClick={() => onClarificationSelect(opt)}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                        isOther
                          ? 'border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-600'
                          : 'bg-[#f0f5ff] text-[#0071E3] hover:bg-[#dbe8ff] border border-[#c5d9f5]'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
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
