import { useState, useCallback, useRef } from 'react';
import { WikiBlock } from '../types';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { parseWikiPageToBlocks } from '../utils/wikiContentParser';

interface UseWikiPagesOptions {
  onPageLoaded?: (blocks: WikiBlock[], pagePath: string) => void;
  mainContentRef?: React.RefObject<HTMLDivElement>;
}

interface UseWikiPagesReturn {
  wikiPages: string[];
  currentPagePath: string;
  isLoadingPage: boolean;
  isNavigatorVisible: boolean;

  setWikiPages: React.Dispatch<React.SetStateAction<string[]>>;
  setCurrentPagePath: React.Dispatch<React.SetStateAction<string>>;
  setIsNavigatorVisible: React.Dispatch<React.SetStateAction<boolean>>;

  handlePageSwitch: (pagePath: string) => Promise<WikiBlock[] | null>;
  loadPage: (pagePath: string) => Promise<WikiBlock[]>;
  addPage: (pagePath: string) => void;
}

export function useWikiPages(options: UseWikiPagesOptions = {}): UseWikiPagesReturn {
  const { onPageLoaded, mainContentRef } = options;

  const [wikiPages, setWikiPages] = useState<string[]>([]);
  const [currentPagePath, setCurrentPagePath] = useState<string>('');
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [isNavigatorVisible, setIsNavigatorVisible] = useState(true);

  const loadPage = useCallback(async (pagePath: string): Promise<WikiBlock[]> => {
    const wikiPage = await codenexusWikiService.fetchPage(pagePath);
    const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
    return parsedBlocks;
  }, []);

  const handlePageSwitch = useCallback(async (pagePath: string): Promise<WikiBlock[] | null> => {
    if (pagePath === currentPagePath || isLoadingPage) return null;

    setIsLoadingPage(true);
    console.log('[useWikiPages] Switching page:', { from: currentPagePath, to: pagePath });

    try {
      const parsedBlocks = await loadPage(pagePath);

      setCurrentPagePath(pagePath);
      onPageLoaded?.(parsedBlocks, pagePath);

      console.log('[useWikiPages] Page switch successful:', {
        pagePath,
        blocksCount: parsedBlocks.length
      });

      // Scroll to top after page loads
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (mainContentRef?.current) {
          mainContentRef.current.scrollTop = 0;
        }
      });

      return parsedBlocks;

    } catch (error) {
      console.error('[useWikiPages] Page switch failed:', error);
      return null;
    } finally {
      setIsLoadingPage(false);
    }
  }, [currentPagePath, isLoadingPage, loadPage, onPageLoaded, mainContentRef]);

  const addPage = useCallback((pagePath: string) => {
    setWikiPages(prev => {
      if (prev.includes(pagePath)) return prev;
      return [...prev, pagePath];
    });
  }, []);

  return {
    wikiPages,
    currentPagePath,
    isLoadingPage,
    isNavigatorVisible,
    setWikiPages,
    setCurrentPagePath,
    setIsNavigatorVisible,
    handlePageSwitch,
    loadPage,
    addPage,
  };
}
