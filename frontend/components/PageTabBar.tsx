import React from 'react';
import { FileText, X } from 'lucide-react';
import { PageTab } from '../types';

interface PageTabBarProps {
  tabs: PageTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  isDarkMode?: boolean;
}

const PageTabBar: React.FC<PageTabBarProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  isDarkMode = false,
}) => {
  if (tabs.length === 0) {
    return null;
  }

  const canClose = tabs.length > 1;

  return (
    <div
      className={`
        h-10 flex items-center px-3 gap-1 overflow-x-auto flex-shrink-0 border-b
        ${isDarkMode
          ? 'bg-[#161b22]/60 border-[#30363d]/60'
          : 'bg-white/30 border-[#d2d2d7]/30'}
      `}
      style={{ scrollbarWidth: 'thin' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            onClick={() => onTabClick(tab.id)}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg
              transition-all duration-200 cursor-pointer group max-w-[180px] min-w-0
              ${isActive
                ? isDarkMode
                  ? 'bg-[#21262d] text-[#e6edf3]'
                  : 'bg-white text-[#1d1d1f] shadow-sm'
                : isDarkMode
                  ? 'text-[#7d8590] hover:bg-[#21262d]/50 hover:text-[#e6edf3]'
                  : 'text-[#86868b] hover:bg-white/50 hover:text-[#1d1d1f]'}
            `}
          >
            <FileText
              size={14}
              className={`flex-shrink-0 ${
                isActive
                  ? isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'
                  : isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'
              }`}
            />

            <span className="text-xs font-medium truncate flex-1">
              {tab.title}
            </span>

            {canClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className={`
                  flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
                  transition-opacity duration-150
                  ${isDarkMode
                    ? 'hover:bg-[#30363d] text-[#7d8590] hover:text-[#e6edf3]'
                    : 'hover:bg-[#d2d2d7]/50 text-[#86868b] hover:text-[#1d1d1f]'}
                  ${isActive ? 'opacity-60' : ''}
                `}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PageTabBar;
