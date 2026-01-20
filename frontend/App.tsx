import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import AnalysisView from './components/AnalysisView';
import WikiHistoryPanel from './components/WikiHistoryPanel';
import { AnalysisType, WikiHistoryRecord } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AnalysisType>(AnalysisType.DASHBOARD);
  const [wikiHistory, setWikiHistory] = useState<WikiHistoryRecord[]>([]);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<WikiHistoryRecord | null>(null);

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
    <div className="flex h-screen bg-[#F5F5F7] text-[#1d1d1f] font-sans selection:bg-[#0071E3] selection:text-white">
      <Sidebar
        currentView={currentView}
        onNavigate={setCurrentView}
        wikiHistory={wikiHistory}
        onOpenHistory={() => setIsHistoryPanelOpen(true)}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#F5F5F7] overflow-hidden relative shadow-[-10px_0_40px_rgba(0,0,0,0.03)] z-10 rounded-l-[2rem]">
        {currentView === AnalysisType.DASHBOARD ? (
          <div className="h-full overflow-y-auto scroll-smooth">
            <Dashboard />
          </div>
        ) : (
          <AnalysisView
            type={currentView}
            wikiHistory={wikiHistory}
            setWikiHistory={setWikiHistory}
            selectedHistoryRecord={selectedHistoryRecord}
            onHistoryLoaded={() => setSelectedHistoryRecord(null)}
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
  );
};

export default App;