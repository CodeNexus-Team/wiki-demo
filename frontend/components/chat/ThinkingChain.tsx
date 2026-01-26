import React from 'react';
import { Loader2, BrainCircuit } from 'lucide-react';

interface ThinkingChainProps {
  steps: string[];
  isFinished?: boolean;
  title?: string;
  variant?: 'blue' | 'orange';
}

export const ThinkingChain: React.FC<ThinkingChainProps> = ({
  steps,
  isFinished = false,
  title,
  variant = 'blue'
}) => {
  if (!steps || steps.length === 0) return null;

  const defaultTitle = variant === 'orange' ? 'CodeNexus AI Analysis' : 'AI Thinking Process';

  return (
    <div className="mb-3 bg-gray-50/80 border border-gray-100 rounded-xl p-3 text-xs">
      <div className="flex items-center gap-2 mb-2 text-[#86868b] font-medium uppercase tracking-wider">
        <BrainCircuit size={12} />
        {title || defaultTitle}
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

export default ThinkingChain;
