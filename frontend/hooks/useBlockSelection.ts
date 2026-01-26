import { useState, useCallback, useMemo } from 'react';
import { WikiBlock } from '../types';
import { collectBlocksByIds } from '../utils/treeBuilder';

interface UseBlockSelectionOptions {
  blocks: WikiBlock[];
  isDiffMode?: boolean;
}

interface UseBlockSelectionReturn {
  selectedBlockIds: Set<string>;
  toggleBlockSelection: (block: WikiBlock) => void;
  toggleBlockSelectionById: (blockId: string) => void;
  clearSelection: () => void;
  setSelectedBlockIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  getReferencedBlocks: () => WikiBlock[];
  hasSelection: boolean;
}

export function useBlockSelection(options: UseBlockSelectionOptions): UseBlockSelectionReturn {
  const { blocks, isDiffMode = false } = options;
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());

  const toggleBlockSelection = useCallback((block: WikiBlock) => {
    if (isDiffMode) return;

    setSelectedBlockIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(block.id)) {
        newSet.delete(block.id);
      } else {
        newSet.add(block.id);
      }
      return newSet;
    });
  }, [isDiffMode]);

  const toggleBlockSelectionById = useCallback((blockId: string) => {
    if (isDiffMode) return;

    setSelectedBlockIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(blockId)) {
        newSet.delete(blockId);
      } else {
        newSet.add(blockId);
      }
      return newSet;
    });
  }, [isDiffMode]);

  const clearSelection = useCallback(() => {
    setSelectedBlockIds(new Set());
  }, []);

  const getReferencedBlocks = useCallback(() => {
    return collectBlocksByIds(blocks, selectedBlockIds);
  }, [blocks, selectedBlockIds]);

  const hasSelection = useMemo(() => selectedBlockIds.size > 0, [selectedBlockIds]);

  return {
    selectedBlockIds,
    toggleBlockSelection,
    toggleBlockSelectionById,
    clearSelection,
    setSelectedBlockIds,
    getReferencedBlocks,
    hasSelection,
  };
}
