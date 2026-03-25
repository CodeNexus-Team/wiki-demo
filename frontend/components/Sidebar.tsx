
import React from 'react';
import {
  LayoutDashboard,
  BookOpen,
  Network,
  Server,
  GitBranch,
  Activity,
  Database,
  History,
  PanelLeftClose,
  PanelLeft
} from 'lucide-react';
import { AnalysisType, NavItem, WikiHistoryRecord } from '../types';

interface SidebarProps {
  currentView: AnalysisType;
  onNavigate: (view: AnalysisType) => void;
  wikiHistory: WikiHistoryRecord[];
  onOpenHistory: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isDarkMode?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: AnalysisType.DASHBOARD, label: '仪表盘', icon: <LayoutDashboard size={18} />, description: '概览' },
  { id: AnalysisType.WIKI_BROWSER, label: '生成Wiki', icon: <BookOpen size={18} />, description: '浏览Wiki' },
  { id: AnalysisType.ARCHITECTURE, label: '架构视图', icon: <Network size={18} />, description: '系统模块' },
  { id: AnalysisType.API_ANALYSIS, label: '接口分析', icon: <Server size={18} />, description: 'API 契约' },
  { id: AnalysisType.BUSINESS_FLOW, label: '业务流', icon: <GitBranch size={18} />, description: '核心流程' },
  { id: AnalysisType.CONTROL_FLOW, label: '控制流', icon: <Activity size={18} />, description: '逻辑算法' },
  { id: AnalysisType.DATABASE, label: '数据模型', icon: <Database size={18} />, description: 'ER 关系' },
];

const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate, wikiHistory, onOpenHistory, isCollapsed = false, onToggleCollapse, isDarkMode = false }) => {
  return (
    <div className={`
      ${isCollapsed ? 'w-16' : 'w-64'}
      backdrop-blur-xl h-full flex flex-col flex-shrink-0 border-r pt-6 pb-4 select-none
      transition-all duration-300 ease-in-out
      ${isDarkMode
        ? 'bg-[#010409]/80 border-[#30363d]'
        : 'bg-[#F5F5F7]/80 border-[#d2d2d7]/50'
      }
    `}>
      {/* Header with Logo and Collapse Button */}
      <div className={`${isCollapsed ? 'px-3' : 'px-6'} mb-8 flex items-center justify-between`}>
        {!isCollapsed && (
          <div className="logo-font text-2xl font-black tracking-tighter flex items-center select-none cursor-default">
            <span className="logo-text-main">CodeNexus</span>
            <span className="logo-dot">.</span>
            <span className="logo-text-ai">AI</span>
            <span className="logo-cursor"></span>
          </div>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`
              p-2 rounded-lg transition-colors
              ${isDarkMode
                ? 'hover:bg-[#21262d] text-[#7d8590] hover:text-[#e6edf3]'
                : 'hover:bg-[rgba(0,0,0,0.04)] text-[#86868b] hover:text-[#1d1d1f]'
              }
              ${isCollapsed ? 'mx-auto' : ''}
            `}
            title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {isCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto ${isCollapsed ? 'px-2' : 'px-4'} space-y-1`}>
        {!isCollapsed && (
          <div className={`text-xs font-medium px-3 mb-2 uppercase tracking-wider ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>分析模块</div>
        )}
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`
              w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-lg transition-all duration-200 group text-left relative
              ${currentView === item.id
                ? isDarkMode
                  ? 'bg-[#21262d] shadow-sm text-[#58a6ff] font-medium'
                  : 'bg-white shadow-sm text-[#0071E3] font-medium'
                : isDarkMode
                  ? 'hover:bg-[#21262d] text-[#e6edf3]'
                  : 'hover:bg-[rgba(0,0,0,0.04)] text-[#1d1d1f]'
              }
            `}
            title={isCollapsed ? item.label : undefined}
          >
            <span className={`${currentView === item.id
              ? isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'
              : isDarkMode ? 'text-[#7d8590] group-hover:text-[#e6edf3]' : 'text-[#86868b] group-hover:text-[#1d1d1f]'
            }`}>
              {item.icon}
            </span>
            {!isCollapsed && <span className="text-[13px]">{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className={`${isCollapsed ? 'px-2' : 'px-4'} mt-auto space-y-3`}>
        <button
          onClick={onOpenHistory}
          className={`
            w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-lg transition-all duration-200 group text-left relative
            ${isDarkMode
              ? 'hover:bg-[#21262d] text-[#e6edf3]'
              : 'hover:bg-[rgba(0,0,0,0.04)] text-[#1d1d1f]'
            }
          `}
          title={isCollapsed ? '历史wiki' : undefined}
        >
          <span className={`relative ${isDarkMode ? 'text-[#7d8590] group-hover:text-[#e6edf3]' : 'text-[#86868b] group-hover:text-[#1d1d1f]'}`}>
            <History size={18} />
            {isCollapsed && wikiHistory.length > 0 && (
              <span className={`absolute -top-1 -right-1 text-[8px] text-white rounded-full w-4 h-4 flex items-center justify-center ${isDarkMode ? 'bg-[#58a6ff]' : 'bg-[#0071E3]'}`}>
                {wikiHistory.length}
              </span>
            )}
          </span>
          {!isCollapsed && (
            <>
              <span className="text-[13px]">历史wiki</span>
              {wikiHistory.length > 0 && (
                <span className={`ml-auto text-[10px] text-white rounded-full w-5 h-5 flex items-center justify-center ${isDarkMode ? 'bg-[#58a6ff]' : 'bg-[#0071E3]'}`}>
                  {wikiHistory.length}
                </span>
              )}
            </>
          )}
        </button>

        {!isCollapsed && (
          <div className={`rounded-xl p-3 shadow-sm backdrop-blur-sm ${
            isDarkMode
              ? 'bg-[#21262d]/60 border border-[#30363d]'
              : 'bg-white/60 border border-white/50'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]"></span>
              <span className={`text-[11px] font-medium ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>cloudmart-backend</span>
            </div>
            <div className={`text-[10px] ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>Branch: main (v2.4.0)</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
