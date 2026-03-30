import { useState, useCallback, useRef } from 'react';
import { WikiBlock, PageTab, PageTabState } from '../types';

interface UsePageTabsOptions {
  onTabSwitch?: (pagePath: string) => Promise<WikiBlock[]>;
  getScrollPosition?: () => number;
  setScrollPosition?: (position: number) => void;
}

interface UsePageTabsReturn {
  tabs: PageTab[];
  activeTabId: string | null;

  openTab: (pagePath: string, blocks?: WikiBlock[]) => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => Promise<void>;

  updateTabState: (tabId: string, state: Partial<PageTabState>) => void;
  getTabState: (tabId: string) => PageTabState | undefined;

  saveCurrentTabState: (blocks: WikiBlock[], selectedBlockIds: Set<string>) => void;

  clearTabs: () => void;

  /** Force-activate a tab by ID. No stale-closure checks — safe from async callbacks. */
  forceActivateTab: (tabId: string) => void;
  /** Save state for a specific tab by ID. No dependency on activeTabId — safe from async callbacks. */
  saveTabStateById: (tabId: string, blocks: WikiBlock[], selectedBlockIds: Set<string>) => void;
}

function extractTitle(pagePath: string): string {
  const fileName = pagePath.split('/').pop() || pagePath;
  return fileName.replace('.json', '');
}

export function usePageTabs(options: UsePageTabsOptions = {}): UsePageTabsReturn {
  const { onTabSwitch, getScrollPosition, setScrollPosition } = options;

  const [tabs, setTabs] = useState<PageTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const tabStatesRef = useRef<Map<string, PageTabState>>(new Map());

  const openTab = useCallback((pagePath: string, blocks?: WikiBlock[]) => {
    const existingTab = tabs.find(t => t.pagePath === pagePath);

    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    const newTab: PageTab = {
      id: pagePath,
      pagePath,
      title: extractTitle(pagePath),
    };

    if (blocks) {
      tabStatesRef.current.set(pagePath, {
        blocks,
        scrollPosition: 0,
        selectedBlockIds: new Set(),
      });
    }

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(pagePath);
  }, [tabs]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;

      const tabIndex = prev.findIndex(t => t.id === tabId);
      const newTabs = prev.filter(t => t.id !== tabId);

      if (activeTabId === tabId && newTabs.length > 0) {
        const newActiveIndex = Math.min(tabIndex, newTabs.length - 1);
        setActiveTabId(newTabs[newActiveIndex].id);
      }

      tabStatesRef.current.delete(tabId);

      return newTabs;
    });
  }, [activeTabId]);

  const switchTab = useCallback(async (tabId: string) => {
    if (tabId === activeTabId) return;

    const targetTab = tabs.find(t => t.id === tabId);
    if (!targetTab) return;

    setActiveTabId(tabId);

    const cachedState = tabStatesRef.current.get(tabId);
    if (cachedState && setScrollPosition) {
      requestAnimationFrame(() => {
        setScrollPosition(cachedState.scrollPosition);
      });
    }
  }, [activeTabId, tabs, setScrollPosition]);

  const updateTabState = useCallback((tabId: string, state: Partial<PageTabState>) => {
    const currentState = tabStatesRef.current.get(tabId);
    tabStatesRef.current.set(tabId, {
      blocks: state.blocks ?? currentState?.blocks ?? [],
      scrollPosition: state.scrollPosition ?? currentState?.scrollPosition ?? 0,
      selectedBlockIds: state.selectedBlockIds ?? currentState?.selectedBlockIds ?? new Set(),
    });
  }, []);

  const getTabState = useCallback((tabId: string): PageTabState | undefined => {
    return tabStatesRef.current.get(tabId);
  }, []);

  const saveCurrentTabState = useCallback((blocks: WikiBlock[], selectedBlockIds: Set<string>) => {
    if (!activeTabId) return;

    const scrollPosition = getScrollPosition?.() ?? 0;

    tabStatesRef.current.set(activeTabId, {
      blocks,
      scrollPosition,
      selectedBlockIds,
    });
  }, [activeTabId, getScrollPosition]);

  const clearTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    tabStatesRef.current.clear();
  }, []);

  // Force-activate a tab by ID without any stale-closure checks.
  // Safe to call from async callbacks where other values may be stale.
  const forceActivateTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  // Save arbitrary tab state by ID (no dependency on activeTabId).
  // Safe to call from async callbacks.
  const saveTabStateById = useCallback((tabId: string, blocks: WikiBlock[], selectedBlockIds: Set<string>) => {
    const scrollPosition = getScrollPosition?.() ?? 0;
    tabStatesRef.current.set(tabId, { blocks, scrollPosition, selectedBlockIds });
  }, [getScrollPosition]);

  return {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    switchTab,
    updateTabState,
    getTabState,
    saveCurrentTabState,
    clearTabs,
    forceActivateTab,
    saveTabStateById,
  };
}
