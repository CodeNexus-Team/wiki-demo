import React from 'react';
import {
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  RotateCcw,
} from 'lucide-react';
import { FlowDirection } from '../../hooks/useMermaidEditor';

interface ToolBarProps {
  direction: FlowDirection;
  nodeSpacing: number;
  rankSpacing: number;
  onDirectionChange: (direction: FlowDirection) => void;
  onNodeSpacingChange: (spacing: number) => void;
  onRankSpacingChange: (spacing: number) => void;
  onResetLayout?: () => void;
}

const directionOptions: { value: FlowDirection; label: string; icon: React.ReactNode }[] = [
  { value: 'LR', label: '左到右', icon: <ArrowRight size={16} /> },
  { value: 'RL', label: '右到左', icon: <ArrowLeft size={16} /> },
  { value: 'TB', label: '上到下', icon: <ArrowDown size={16} /> },
  { value: 'BT', label: '下到上', icon: <ArrowUp size={16} /> },
];

export const ToolBar: React.FC<ToolBarProps> = ({
  direction,
  nodeSpacing,
  rankSpacing,
  onDirectionChange,
  onNodeSpacingChange,
  onRankSpacingChange,
  onResetLayout,
}) => {
  return (
    <div className="flex flex-col gap-4 p-4 bg-white/80 backdrop-blur-xl border-b border-gray-200/60">
      {/* 方向控制 */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-gray-500 w-16">方向</span>
        <div className="flex gap-1">
          {directionOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onDirectionChange(option.value)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                transition-all duration-200
                ${
                  direction === option.value
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
              title={option.label}
            >
              {option.icon}
              <span className="hidden sm:inline">{option.value}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 间距控制 */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-gray-500 w-16">节点间距</span>
        <div className="flex items-center gap-2 flex-1">
          <input
            type="range"
            min="20"
            max="150"
            value={nodeSpacing}
            onChange={(e) => onNodeSpacingChange(Number(e.target.value))}
            className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-xs text-gray-500 w-10 text-right">{nodeSpacing}px</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-gray-500 w-16">层级间距</span>
        <div className="flex items-center gap-2 flex-1">
          <input
            type="range"
            min="20"
            max="150"
            value={rankSpacing}
            onChange={(e) => onRankSpacingChange(Number(e.target.value))}
            className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-xs text-gray-500 w-10 text-right">{rankSpacing}px</span>
        </div>
      </div>

      {/* 操作按钮 */}
      {onResetLayout && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={onResetLayout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <RotateCcw size={14} />
            重置布局
          </button>
        </div>
      )}
    </div>
  );
};

export default ToolBar;
