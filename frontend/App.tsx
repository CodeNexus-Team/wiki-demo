import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import AnalysisView from './components/AnalysisView';
import WikiHistoryPanel from './components/WikiHistoryPanel';
import { AnalysisType, WikiHistoryRecord } from './types';
import { WikiThemeContext, useWikiThemeState } from './hooks/useWikiTheme';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AnalysisType>(AnalysisType.DASHBOARD);
  const [wikiHistory, setWikiHistory] = useState<WikiHistoryRecord[]>([]);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<WikiHistoryRecord | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 主题状态
  const themeState = useWikiThemeState();
  const { isDarkMode } = themeState;

  const handleSelectHistory = (record: WikiHistoryRecord) => {
    // 设置选中的历史记录，AnalysisView 会监听并加载
    setSelectedHistoryRecord(record);
    // Switch to the appropriate view if needed
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

  return (
    <WikiThemeContext.Provider value={themeState}>
      <div className={`flex h-screen font-sans transition-colors duration-300 ${
        isDarkMode
          ? 'bg-[#010409] text-[#e6edf3] selection:bg-[#58a6ff] selection:text-white'
          : 'bg-gradient-to-br from-[#f0f4ff] via-[#F5F5F7] to-[#fff5f5] text-[#1d1d1f] selection:bg-[#0071E3] selection:text-white'
      }`}>
        <Sidebar
          currentView={currentView}
          onNavigate={setCurrentView}
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