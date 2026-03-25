import { useState, useCallback } from 'react';
import { WikiBlock, ModifyPageResponse, WikiSource } from '../types';
import { markBlockAsDeleted, insertBlockAfter, setStatusRecursively } from '../utils/blockOperations';
import { removeDeletedBlocks, clearBlockStatuses } from '../utils/treeBuilder';
import { wikiPageCache } from '../services/wikiPageCache';
import { codenexusWikiService } from '../services/codenexusWikiService';

interface UseDiffModeOptions {
  blocks: WikiBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<WikiBlock[]>>;
  currentPagePath?: string;
  clearSelection?: () => void;
  addChatMessage?: (content: string) => void;
}

interface UseDiffModeReturn {
  isDiffMode: boolean;
  originalBlocks: WikiBlock[];
  pendingPageDiff: ModifyPageResponse | null;

  enterDiffMode: (modifiedBlocks: WikiBlock[], pendingDiff?: ModifyPageResponse) => void;
  applyChanges: () => Promise<void>;
  discardChanges: () => void;
  setIsDiffMode: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingPageDiff: React.Dispatch<React.SetStateAction<ModifyPageResponse | null>>;

  applyModifyPageResponse: (response: ModifyPageResponse, currentBlocks: WikiBlock[], sources?: WikiSource[]) => Promise<WikiBlock[]>;
}

export function useDiffMode(options: UseDiffModeOptions): UseDiffModeReturn {
  const { blocks, setBlocks, currentPagePath, clearSelection, addChatMessage } = options;

  const [isDiffMode, setIsDiffMode] = useState(false);
  const [originalBlocks, setOriginalBlocks] = useState<WikiBlock[]>([]);
  const [pendingPageDiff, setPendingPageDiff] = useState<ModifyPageResponse | null>(null);

  const enterDiffMode = useCallback((modifiedBlocks: WikiBlock[], pendingDiff?: ModifyPageResponse) => {
    setOriginalBlocks([...blocks]);
    setBlocks(modifiedBlocks);
    setIsDiffMode(true);
    if (pendingDiff) {
      setPendingPageDiff(pendingDiff);
    }
  }, [blocks, setBlocks]);

  const applyChanges = useCallback(async () => {
    // If there's a pending page diff, call backend API to apply changes
    if (pendingPageDiff && currentPagePath) {
      try {
        console.log('[useDiffMode] Calling backend API to apply changes:', currentPagePath);
        const result = await codenexusWikiService.applyChanges(currentPagePath, pendingPageDiff);
        console.log('[useDiffMode] Apply changes result:', result);
      } catch (error) {
        console.error('[useDiffMode] Failed to apply changes:', error);
        addChatMessage?.(`Failed to apply changes: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    // Recursively remove all deleted nodes, then clear all status marks
    const blocksWithoutDeleted = removeDeletedBlocks(blocks);
    const appliedBlocks = clearBlockStatuses(blocksWithoutDeleted);

    setBlocks(appliedBlocks);
    setOriginalBlocks([]);
    setIsDiffMode(false);
    setPendingPageDiff(null);
    clearSelection?.();

    // Update cache: clear current page cache
    if (currentPagePath) {
      console.log('[useDiffMode] Clearing cache for modified page:', currentPagePath);
      wikiPageCache.remove(currentPagePath);
    }

    addChatMessage?.('Changes applied successfully.');
  }, [blocks, setBlocks, pendingPageDiff, currentPagePath, clearSelection, addChatMessage]);

  const discardChanges = useCallback(() => {
    setBlocks(originalBlocks);
    setOriginalBlocks([]);
    setIsDiffMode(false);
    setPendingPageDiff(null);
    clearSelection?.();

    addChatMessage?.('Changes discarded, document restored to previous version.');
  }, [originalBlocks, setBlocks, clearSelection, addChatMessage]);

  const applyModifyPageResponse = useCallback(async (
    response: ModifyPageResponse,
    currentBlocks: WikiBlock[],
    sources?: WikiSource[]
  ): Promise<WikiBlock[]> => {
    const { parseWikiPageToBlocks } = await import('../utils/wikiContentParser');

    let newBlocks = [...currentBlocks];

    // 1. Replace blocks in-place
    if (response.replace_blocks) {
      for (const replacement of response.replace_blocks) {
        const replaceInTree = (blocks: WikiBlock[]): WikiBlock[] => {
          return blocks.map(block => {
            if (block.id === replacement.target) {
              return {
                ...block,
                content: replacement.new_content.markdown,
                originalContent: block.content,
                status: 'modified' as const,
              };
            }
            if (block.children && block.children.length > 0) {
              return { ...block, children: replaceInTree(block.children) };
            }
            return block;
          });
        };
        newBlocks = replaceInTree(newBlocks);
      }
    }

    // 2. Mark blocks to delete
    response.delete_blocks.forEach(blockId => {
      newBlocks = markBlockAsDeleted(newBlocks, blockId);
    });

    // 3. Insert new blocks
    for (const insertion of response.insert_blocks) {
      const tempPage = {
        content: [insertion.block],
        source: sources || response.insert_sources
      };
      const parsedBlocks = parseWikiPageToBlocks(tempPage.content, tempPage.source);

      if (parsedBlocks.length > 0) {
        const newBlock = setStatusRecursively(parsedBlocks[0], 'inserted');
        newBlocks = insertBlockAfter(newBlocks, insertion.after_block, newBlock);
      }
    }

    return newBlocks;
  }, []);

  return {
    isDiffMode,
    originalBlocks,
    pendingPageDiff,
    enterDiffMode,
    applyChanges,
    discardChanges,
    setIsDiffMode,
    setPendingPageDiff,
    applyModifyPageResponse,
  };
}
