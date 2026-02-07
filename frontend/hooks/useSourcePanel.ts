import { useState, useCallback } from 'react';
import { SourceLocation, MermaidMetadata, WikiSource } from '../types';

interface UseSourcePanelReturn {
  isSourcePanelOpen: boolean;
  activeSourceLocation: SourceLocation | null;
  sourcePanelWidth: number;
  highlightedBlockId: string | null;
  highlightedMermaidNodeId: string | null;

  openSourcePanel: (location: SourceLocation, blockId?: string, mermaidNodeId?: string) => void;
  closeSourcePanel: () => void;
  setSourcePanelWidth: React.Dispatch<React.SetStateAction<number>>;
  setHighlightedBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  setHighlightedMermaidNodeId: React.Dispatch<React.SetStateAction<string | null>>;

  handleSourceClick: (blockId: string, sourceId: string, sources: WikiSource[]) => void;
  handleMermaidNodeClick: (nodeId: string, metadata?: MermaidMetadata, blockId?: string) => void;
}

interface UseSourcePanelOptions {
  initialWidth?: number;
}

export function useSourcePanel(options: UseSourcePanelOptions = {}): UseSourcePanelReturn {
  const { initialWidth = 600 } = options;

  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(false);
  const [activeSourceLocation, setActiveSourceLocation] = useState<SourceLocation | null>(null);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(initialWidth);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const [highlightedMermaidNodeId, setHighlightedMermaidNodeId] = useState<string | null>(null);

  const openSourcePanel = useCallback((location: SourceLocation, blockId?: string, mermaidNodeId?: string) => {
    setActiveSourceLocation(location);
    setIsSourcePanelOpen(true);
    if (blockId) {
      setHighlightedBlockId(blockId);
    }
    if (mermaidNodeId) {
      setHighlightedMermaidNodeId(mermaidNodeId);
    }
  }, []);

  const closeSourcePanel = useCallback(() => {
    setIsSourcePanelOpen(false);
    setHighlightedBlockId(null);
    setHighlightedMermaidNodeId(null);
  }, []);

  const handleSourceClick = useCallback((blockId: string, sourceId: string, sources: WikiSource[]) => {
    const source = sources.find(s => s.source_id === sourceId);

    if (source) {
      const lineRange = source.lines[0];
      let line = 1;
      let endLine: number | undefined;

      if (lineRange) {
        const rangeMatch = lineRange.match(/^(\d+)-(\d+)$/);
        const singleMatch = lineRange.match(/^(\d+)$/);

        if (rangeMatch) {
          line = parseInt(rangeMatch[1], 10);
          endLine = parseInt(rangeMatch[2], 10);
        } else if (singleMatch) {
          line = parseInt(singleMatch[1], 10);
        }
      }

      const location: SourceLocation = {
        file: source.name,
        line,
        endLine
      };

      openSourcePanel(location, blockId);
    }
  }, [openSourcePanel]);

  const handleMermaidNodeClick = useCallback((nodeId: string, metadata?: MermaidMetadata, blockId?: string) => {
    const location = metadata?.sourceMapping?.[nodeId];

    if (location) {
      openSourcePanel(location, blockId, nodeId);
    }
  }, [openSourcePanel]);

  return {
    isSourcePanelOpen,
    activeSourceLocation,
    sourcePanelWidth,
    highlightedBlockId,
    highlightedMermaidNodeId,
    openSourcePanel,
    closeSourcePanel,
    setSourcePanelWidth,
    setHighlightedBlockId,
    setHighlightedMermaidNodeId,
    handleSourceClick,
    handleMermaidNodeClick,
  };
}
