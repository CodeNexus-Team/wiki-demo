import React from 'react';
import { X } from 'lucide-react';
import { WikiBlock } from '../../types';
import { findBlockById } from '../../utils/treeBuilder';

interface SelectionBarProps {
  selectedBlockIds: Set<string>;
  blocks: WikiBlock[];
  onToggleSelect: (block: WikiBlock) => void;
  onClear: () => void;
  variant?: 'chat' | 'standalone';
}

export const SelectionBar: React.FC<SelectionBarProps> = ({
  selectedBlockIds,
  blocks,
  onToggleSelect,
  onClear,
  variant = 'chat'
}) => {
  if (selectedBlockIds.size === 0) return null;

  if (variant === 'standalone') {
    return (
      <div className="px-4 pt-3 pb-2 border-b border-blue-200 bg-blue-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <span className="font-medium">Selected {selectedBlockIds.size} blocks</span>
          </div>
          <button
            onClick={onClear}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            Clear Selection
          </button>
        </div>
      </div>
    );
  }

  // Chat variant (default)
  return (
    <div className="w-full flex flex-wrap gap-2 px-6 py-2 bg-gray-50/50 border-t border-gray-100 items-center">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mr-1">
        References:
      </span>
      {Array.from(selectedBlockIds).map(id => {
        const block = findBlockById(blocks, id);
        if (!block) return null;

        return (
          <div
            key={id}
            className="bg-white text-[#0071E3] border border-blue-100 pl-2 pr-1 py-1 rounded-md text-xs font-medium shadow-sm flex items-center max-w-[180px]"
          >
            <span className="truncate mr-1">
              {block.type}: {block.content.substring(0, 10)}...
            </span>
            <button
              onClick={() => onToggleSelect(block)}
              className="hover:bg-gray-100 rounded p-0.5 text-gray-400 hover:text-red-500"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
      <button
        onClick={onClear}
        className="ml-auto text-[10px] text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
      >
        Clear
      </button>
    </div>
  );
};

export default SelectionBar;
