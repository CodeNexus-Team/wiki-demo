
import React from 'react';
import {
  LayoutDashboard,
  Network,
  Server,
  GitBranch,
  Activity,
  Database,
  History
} from 'lucide-react';
import { AnalysisType, NavItem, WikiHistoryRecord } from '../types';

interface SidebarProps {
  currentView: AnalysisType;
  onNavigate: (view: AnalysisType) => void;
  wikiHistory: WikiHistoryRecord[];
  onOpenHistory: () => void;
}

const NAV_ITEMS: NavItem[] = [
  { id: AnalysisType.DASHBOARD, label: '仪表盘', icon: <LayoutDashboard size={18} />, description: '概览' },
  { id: AnalysisType.ARCHITECTURE, label: '架构视图', icon: <Network size={18} />, description: '系统模块' },
  { id: AnalysisType.API_ANALYSIS, label: '接口分析', icon: <Server size={18} />, description: 'API 契约' },
  { id: AnalysisType.BUSINESS_FLOW, label: '业务流', icon: <GitBranch size={18} />, description: '核心流程' },
  { id: AnalysisType.CONTROL_FLOW, label: '控制流', icon: <Activity size={18} />, description: '逻辑算法' },
  { id: AnalysisType.DATABASE, label: '数据模型', icon: <Database size={18} />, description: 'ER 关系' },
];

const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate, wikiHistory, onOpenHistory }) => {
  return (
    <div className="w-64 bg-[#F5F5F7]/80 backdrop-blur-xl h-full flex flex-col flex-shrink-0 border-r border-[#d2d2d7]/50 pt-6 pb-4 select-none">
      <div className="px-6 mb-8 flex items-center">
        <div className="logo-font text-2xl font-black tracking-tighter flex items-center select-none cursor-default">
            <span className="logo-text-main">CodeNexus</span>
            <span className="logo-dot">.</span>
            <span className="logo-text-ai">AI</span>
            <span className="logo-cursor"></span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 space-y-1">
        <div className="text-xs font-medium text-[#86868b] px-3 mb-2 uppercase tracking-wider">分析模块</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group text-left relative
              ${currentView === item.id
                ? 'bg-white shadow-sm text-[#0071E3] font-medium'
                : 'hover:bg-[rgba(0,0,0,0.04)] text-[#1d1d1f]'
              }`}
          >
            <span className={`${currentView === item.id ? 'text-[#0071E3]' : 'text-[#86868b] group-hover:text-[#1d1d1f]'}`}>
              {item.icon}
            </span>
            <span className="text-[13px]">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="px-4 mt-auto space-y-3">
        <button
          onClick={onOpenHistory}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group text-left relative hover:bg-[rgba(0,0,0,0.04)] text-[#1d1d1f]"
        >
          <span className="text-[#86868b] group-hover:text-[#1d1d1f]">
            <History size={18} />
          </span>
          <span className="text-[13px]"> 历史wiki</span>
          {wikiHistory.length > 0 && (
            <span className="ml-auto text-[10px] bg-[#0071E3] text-white rounded-full w-5 h-5 flex items-center justify-center">
              {wikiHistory.length}
            </span>
          )}
        </button>

        <div className="bg-white/60 border border-white/50 rounded-xl p-3 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]"></span>
            <span className="text-[11px] font-medium text-[#1d1d1f]">cloudmart-backend</span>
          </div>
          <div className="text-[10px] text-[#86868b]">Branch: main (v2.4.0)</div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
