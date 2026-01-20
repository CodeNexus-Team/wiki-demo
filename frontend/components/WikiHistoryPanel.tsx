import React from 'react';
import { WikiHistoryRecord } from '../types';
import { Clock, Trash2, X, FileText } from 'lucide-react';

interface WikiHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  history: WikiHistoryRecord[];
  onSelectHistory: (record: WikiHistoryRecord) => void;
  onDeleteHistory: (id: string) => void;
  onClearAll: () => void;
}

const WikiHistoryPanel: React.FC<WikiHistoryPanelProps> = ({
  isOpen,
  onClose,
  history,
  onSelectHistory,
  onDeleteHistory,
  onClearAll
}) => {
  if (!isOpen) return null;

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;

    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-[60] backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-white shadow-2xl z-[70] flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-[#0071E3]" />
            <h2 className="text-lg font-semibold text-[#1d1d1f]">生成历史</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
              <Clock size={48} className="mb-3 opacity-30" />
              <p className="text-sm">暂无生成历史</p>
            </div>
          ) : (
            history.map((record) => (
              <div
                key={record.id}
                className="group bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-xl p-3 cursor-pointer transition-all"
                onClick={() => onSelectHistory(record)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileText size={14} className="text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
                    <span className="text-xs text-gray-500 group-hover:text-blue-600">
                      {formatTime(record.timestamp)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteHistory(record.id);
                    }}
                    className="p-1 hover:bg-red-100 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} className="text-red-500" />
                  </button>
                </div>

                <p className="text-sm text-[#1d1d1f] font-medium mb-2 line-clamp-2">
                  {record.userQuery}
                </p>

                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="bg-white px-2 py-0.5 rounded border border-gray-200">
                    {record.wikiPages?.length ?? 1} 个页面
                  </span>
                  {record.pagePath && (
                    <span className="bg-white px-2 py-0.5 rounded border border-gray-200 truncate max-w-[150px]">
                      {record.pagePath.split('/').pop()}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div className="p-4 border-t border-gray-200">
            <button
              onClick={onClearAll}
              className="w-full py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              清空所有历史
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default WikiHistoryPanel;
