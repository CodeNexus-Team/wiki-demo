import React, { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import WikiBrowser from './components/WikiBrowser';
import AnalysisView, { InitialWikiData } from './components/AnalysisView';
import WikiHistoryPanel from './components/WikiHistoryPanel';
import { AnalysisType, WikiHistoryRecord } from './types';
import { WikiThemeContext, useWikiThemeState } from './hooks/useWikiTheme';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AnalysisType>(AnalysisType.DASHBOARD);
  const [wikiHistory, setWikiHistory] = useState<WikiHistoryRecord[]>([]);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<WikiHistoryRecord | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // WikiBrowser 点击文件后传给 AnalysisView 的初始数据
  const [wikiBrowserInitData, setWikiBrowserInitData] = useState<InitialWikiData | null>(null);

  // 主题状态
  const themeState = useWikiThemeState();
  const { isDarkMode } = themeState;

  const handleSelectHistory = (record: WikiHistoryRecord) => {
    setSelectedHistoryRecord(record);
    if (currentView === AnalysisType.DASHBOARD && (record.pagePath || (record.blocksCount ?? 0) > 0)) {
      setCurrentView(AnalysisType.ARCHITECTURE);
    }
    setIsHistoryPanelOpen(false);
  };

  const handleDeleteHistory = (id: string) => {
    setWikiHistory(prev => prev.filter(record => record.id !== id));
  };

  const handleClearAllHistory = () => {
    setWikiHistory([]);
    setIsHistoryPanelOpen(false);
  };

  // WikiBrowser 中点击 wiki 文件 → 传入初始数据，走和 workflow 完成后一样的加载流程
  const handleOpenWikiPage = useCallback((pagePath: string, allPages: string[]) => {
    setWikiBrowserInitData({ pagePath, wikiPages: allPages });
  }, []);

  // 从 wiki 查看返回到列表
  const handleBackToWikiBrowser = useCallback(() => {
    setWikiBrowserInitData(null);
  }, []);

  // 切换侧边栏时，如果离开 WIKI_BROWSER，清除查看状态
  const handleNavigate = useCallback((view: AnalysisType) => {
    if (view !== AnalysisType.WIKI_BROWSER) {
      setWikiBrowserInitData(null);
    }
    setCurrentView(view);
  }, []);

  return (
    <WikiThemeContext.Provider value={themeState}>
      <div className={`flex h-screen font-sans transition-colors duration-300 ${
        isDarkMode
          ? 'bg-[#010409] text-[#e6edf3] selection:bg-[#58a6ff] selection:text-white'
          : 'bg-gradient-to-br from-[#f0f4ff] via-[#F5F5F7] to-[#fff5f5] text-[#1d1d1f] selection:bg-[#0071E3] selection:text-white'
      }`}>
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          wikiHistory={wikiHistory}
          onOpenHistory={() => setIsHistoryPanelOpen(true)}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isDarkMode={isDarkMode}
        />

        <main className={`flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 rounded-l-[2rem] transition-colors duration-300 ${
          isDarkMode
            ? 'bg-[#0d1117] shadow-[-10px_0_40px_rgba(0,0,0,0.3)]'
            : 'bg-gradient-to-br from-[#f0f4ff]/80 via-[#F5F5F7]/90 to-[#fff5f5]/80 shadow-[-10px_0_40px_rgba(0,0,0,0.03)]'
        }`}>
          {currentView === AnalysisType.DASHBOARD ? (
            <div className="h-full overflow-y-auto scroll-smooth">
              <Dashboard isDarkMode={isDarkMode} />
            </div>
          ) : currentView === AnalysisType.WIKI_BROWSER && !wikiBrowserInitData ? (
            <WikiBrowser isDarkMode={isDarkMode} onOpenWikiPage={handleOpenWikiPage} />
          ) : currentView === AnalysisType.WIKI_BROWSER && wikiBrowserInitData ? (
            <AnalysisView
              type={currentView}
              wikiHistory={wikiHistory}
              setWikiHistory={setWikiHistory}
              selectedHistoryRecord={null}
              onHistoryLoaded={() => setSelectedHistoryRecord(null)}
              isSidebarCollapsed={isSidebarCollapsed}
              initialWikiData={wikiBrowserInitData}
            />
          ) : (
            <AnalysisView
              type={currentView}
              wikiHistory={wikiHistory}
              setWikiHistory={setWikiHistory}
              selectedHistoryRecord={selectedHistoryRecord}
              onHistoryLoaded={() => setSelectedHistoryRecord(null)}
              isSidebarCollapsed={isSidebarCollapsed}
            />
          )}
        </main>

        <WikiHistoryPanel
          isOpen={isHistoryPanelOpen}
          onClose={() => setIsHistoryPanelOpen(false)}
          history={wikiHistory}
          onSelectHistory={handleSelectHistory}
          onDeleteHistory={handleDeleteHistory}
          onClearAll={handleClearAllHistory}
        />
      </div>
    </WikiThemeContext.Provider>
  );
};

export default App;
