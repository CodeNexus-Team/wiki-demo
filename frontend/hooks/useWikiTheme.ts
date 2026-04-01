import { useState, useCallback, createContext, useContext } from 'react';
import { WikiTheme, themePairs, getThemeByPairAndMode, notionTheme } from '../config/wikiThemes';

interface WikiThemeContextType {
  theme: WikiTheme;
  themeId: string;           // 主题对 ID (apple, github, notion, technical)
  isDarkMode: boolean;       // 是否暗色模式
  setThemeId: (id: string) => void;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;
  availableThemes: typeof themePairs;
}

// 创建 Context
export const WikiThemeContext = createContext<WikiThemeContextType | null>(null);

// Hook 用于组件内访问主题
export const useWikiTheme = (): WikiThemeContextType => {
  const context = useContext(WikiThemeContext);
  if (!context) {
    // 如果没有 Provider，返回默认主题
    return {
      theme: notionTheme,
      themeId: 'notion',
      isDarkMode: false,
      setThemeId: () => {},
      toggleDarkMode: () => {},
      setDarkMode: () => {},
      availableThemes: themePairs
    };
  }
  return context;
};

// Hook 用于创建主题状态（在顶层组件使用）
export const useWikiThemeState = (initialThemeId: string = 'notion', initialDarkMode: boolean = false) => {
  const [themeId, setThemeIdState] = useState<string>(() => {
    // 尝试从 localStorage 读取
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('wiki-theme-id');
      if (saved && themePairs.find(t => t.id === saved)) {
        return saved;
      }
    }
    return initialThemeId;
  });

  const [isDarkMode, setIsDarkModeState] = useState<boolean>(() => {
    // 尝试从 localStorage 读取
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('wiki-dark-mode');
      if (saved !== null) {
        return saved === 'true';
      }
      // 检测系统暗色模式偏好
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return true;
      }
    }
    return initialDarkMode;
  });

  const setThemeId = useCallback((id: string) => {
    setThemeIdState(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('wiki-theme-id', id);
    }
  }, []);

  const setDarkMode = useCallback((isDark: boolean) => {
    setIsDarkModeState(isDark);
    if (typeof window !== 'undefined') {
      localStorage.setItem('wiki-dark-mode', String(isDark));
    }
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(!isDarkMode);
  }, [isDarkMode, setDarkMode]);

  const theme = getThemeByPairAndMode(themeId, isDarkMode);

  return {
    theme,
    themeId,
    isDarkMode,
    setThemeId,
    toggleDarkMode,
    setDarkMode,
    availableThemes: themePairs
  };
};

export default useWikiTheme;
