import React, { useState, useCallback } from 'react';
import { codenexusWikiService } from '../services/codenexusWikiService';
import {
  BookOpen,
  Loader2,
  Sparkles,
} from 'lucide-react';

interface WikiBrowserProps {
  isDarkMode?: boolean;
  onOpenWikiPage: (pagePath: string, allPages: string[]) => void;
}

// 总揽页面的常见命名（用于优先打开）
const OVERVIEW_PAGE_NAMES = ['总揽', '总览', 'overview', 'index', 'README'];

/**
 * 在 wiki 页面列表中找到最适合作为入口的"总揽"页面：
 * 1. 文件名（去扩展名后）匹配常见总揽名称
 * 2. 文件路径深度最浅（根目录优先）
 * 否则返回第一个页面。
 */
function findOverviewPage(pages: string[]): string {
  if (pages.length === 0) return '';

  // 优先匹配名称
  for (const name of OVERVIEW_PAGE_NAMES) {
    const matched = pages.find(p => {
      const fileName = p.split('/').pop()?.replace(/\.json$/, '') || '';
      return fileName.toLowerCase() === name.toLowerCase();
    });
    if (matched) return matched;
  }

  // 退化：返回路径最浅的页面
  return pages.slice().sort((a, b) =>
    a.split('/').length - b.split('/').length
  )[0];
}

const WikiBrowser: React.FC<WikiBrowserProps> = ({ isDarkMode = false, onOpenWikiPage }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 点击"生成Wiki"：扫描目录，找到总揽页直接打开
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenerationStatus('正在扫描 Wiki 目录...');
    setError(null);

    try {
      const result = await codenexusWikiService.scanWikis();

      if (result.wiki_pages.length === 0) {
        setError('未找到任何 Wiki 页面');
        setGenerationStatus(null);
        setIsGenerating(false);
        return;
      }

      setGenerationStatus(`扫描完成！共 ${result.wiki_pages.length} 个页面，正在加载...`);

      const initialPage = findOverviewPage(result.wiki_pages);
      onOpenWikiPage(initialPage, result.wiki_pages);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
      setGenerationStatus(null);
      setIsGenerating(false);
    }
  }, [isGenerating, onOpenWikiPage]);

  return (
    <div className="h-full overflow-y-auto py-10 px-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 生成 Wiki 入口 */}
        <div className={`rounded-xl border p-8 text-center ${
          isDarkMode ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-[#e5e5ea]'
        }`}>
          <div className={`w-16 h-16 rounded-[1.25rem] shadow-xl mb-5 mx-auto flex items-center justify-center text-white ${
            isDarkMode ? 'bg-gradient-to-tr from-[#58a6ff] to-[#79c0ff]' : 'bg-gradient-to-tr from-[#0071E3] to-[#5AC8FA]'
          }`}>
            <BookOpen size={28} />
          </div>

          <h2 className={`text-2xl font-semibold mb-2 tracking-tight ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>
            生成 Wiki
          </h2>
          <p className={`text-[14px] font-light mb-6 leading-relaxed ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
            扫描代码仓库，生成结构化的交互式 Wiki 文档
          </p>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`
              px-8 py-3 rounded-xl text-[15px] font-medium inline-flex items-center gap-2.5 transition-all duration-200
              ${isDarkMode
                ? 'bg-[#238636] text-white hover:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed'
                : 'bg-[#0071E3] text-white hover:bg-[#0077ED] disabled:bg-[#d2d2d7] disabled:text-[#86868b] disabled:cursor-not-allowed'
              }
            `}
          >
            {isGenerating ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Sparkles size={18} />
            )}
            {isGenerating ? '生成中...' : '生成 Wiki'}
          </button>

          {generationStatus && (
            <div className={`mt-4 flex items-center justify-center gap-2 text-[13px] ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
              {isGenerating && <Loader2 size={14} className="animate-spin" />}
              <span>{generationStatus}</span>
            </div>
          )}

          {error && (
            <div className={`mt-4 text-[13px] ${isDarkMode ? 'text-[#f85149]' : 'text-red-500'}`}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WikiBrowser;
