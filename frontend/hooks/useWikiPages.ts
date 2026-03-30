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
  /** Invalidate any in-flight page load so its result is discarded. */
  cancelPendingLoad: () => void;
}

export function useWikiPages(options: UseWikiPagesOptions = {}): UseWikiPagesReturn {
  const { onPageLoaded, mainContentRef } = options;

  const [wikiPages, setWikiPages] = useState<string[]>([]);
  const [currentPagePath, setCurrentPagePath] = useState<string>('');
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [isNavigatorVisible, setIsNavigatorVisible] = useState(true);

  // Track the latest requested page to handle rapid switches (discard stale loads)
  const latestRequestedPageRef = useRef<string>('');
  // Track currently in-flight page to deduplicate concurrent loads of the same page
  const loadingPageRef = useRef<string>('');

  const loadPage = useCallback(async (pagePath: string): Promise<WikiBlock[]> => {
    const wikiPage = await codenexusWikiService.fetchPage(pagePath);
    const parsedBlocks = parseWikiPageToBlocks(wikiPage.content, wikiPage.source);
    return parsedBlocks;
  }, []);

  const handlePageSwitch = useCallback(async (pagePath: string): Promise<WikiBlock[] | null> => {
    if (pagePath === currentPagePath) return null;
    // Deduplicate: skip if this exact page is already being loaded
    if (loadingPageRef.current === pagePath) return null;

    latestRequestedPageRef.current = pagePath;
    loadingPageRef.current = pagePath;
    setIsLoadingPage(true);
    console.log('[useWikiPages] Switching page:', { from: currentPagePath, to: pagePath });

    try {
      const parsedBlocks = await loadPage(pagePath);

      // Discard result if user already requested a different page or load was cancelled
      if (latestRequestedPageRef.current !== pagePath) {
        console.log('[useWikiPages] Discarding stale page load:', pagePath, '(latest:', latestRequestedPageRef.current, ')');
        return null;
      }

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
      if (loadingPageRef.current === pagePath) {
        loadingPageRef.current = '';
      }
      // Only clear loading if this is still the latest request
      if (latestRequestedPageRef.current === pagePath) {
        setIsLoadingPage(false);
      }
    }
  }, [currentPagePath, loadPage, onPageLoaded, mainContentRef]);

  // Invalidate any in-flight page load so its onPageLoaded / setCurrentPagePath
  // won't fire, preventing it from overwriting state set by other async operations
  // (e.g. detailedQuery entering diff mode).
  const cancelPendingLoad = useCallback(() => {
    latestRequestedPageRef.current = '';
    loadingPageRef.current = '';
    setIsLoadingPage(false);
  }, []);

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
    cancelPendingLoad,
  };
}
