import React from 'react';
import { FileDiff, CheckCircle2, XCircle, Check, X } from 'lucide-react';

interface DiffConfirmBarProps {
  onApply: () => void;
  onDiscard: () => void;
  variant?: 'floating' | 'inline';
  theme?: 'blue' | 'orange';
}

export const DiffConfirmBar: React.FC<DiffConfirmBarProps> = ({
  onApply,
  onDiscard,
  variant = 'floating',
  theme = 'blue'
}) => {
  if (variant === 'inline') {
    return (
      <div className="px-4 pt-3 pb-2 border-b border-orange-200 bg-orange-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-orange-700">
            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <span className="font-medium">Diff Preview Mode</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onDiscard}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <X size={14} />
              Discard
            </button>
            <button
              onClick={onApply}
              className="px-3 py-1.5 text-sm bg-gradient-to-br from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Check size={14} />
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Floating variant (default)
  return (
    <div className="w-full max-w-2xl animate-in slide-in-from-bottom-10 fade-in duration-300 mb-4 pointer-events-auto px-4">
      <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-amber-100 p-4 flex items-center justify-between ring-1 ring-amber-200">
        <div className="flex items-center gap-3">
          <div className="bg-amber-100 p-2 rounded-full text-amber-600">
            <FileDiff size={20} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#1d1d1f]">审查变更中</h3>
            <p className="text-xs text-[#86868b]">请确认是否应用 AI 生成的变更</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDiscard}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
          >
            <XCircle size={16} /> 取消
          </button>
          <button
            onClick={onApply}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 shadow-md shadow-emerald-200 transition-all"
          >
            <CheckCircle2 size={16} /> 应用变更
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiffConfirmBar;
