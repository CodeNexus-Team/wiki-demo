import React, { useState, useCallback } from 'react';
import { codenexusWikiService } from '../services/codenexusWikiService';
import {
  BookOpen,
  Loader2,
  Sparkles
} from 'lucide-react';

interface WikiBrowserProps {
  isDarkMode?: boolean;
  onOpenWikiPage: (pagePath: string, allPages: string[]) => void;
}

const WikiBrowser: React.FC<WikiBrowserProps> = ({ isDarkMode = false, onOpenWikiPage }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 点击"生成Wiki"：扫描目录，拿到页面列表后直接跳转
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

      // 直接跳转到第一个页面
      onOpenWikiPage(result.wiki_pages[0], result.wiki_pages);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
      setGenerationStatus(null);
      setIsGenerating(false);
    }
  }, [isGenerating, onOpenWikiPage]);

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className={`w-20 h-20 rounded-[1.5rem] shadow-xl mb-6 mx-auto flex items-center justify-center text-white ${
          isDarkMode ? 'bg-gradient-to-tr from-[#58a6ff] to-[#79c0ff]' : 'bg-gradient-to-tr from-[#0071E3] to-[#5AC8FA]'
        }`}>
          <BookOpen size={36} />
        </div>

        <h2 className={`text-3xl font-semibold mb-3 tracking-tight ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>
          生成 Wiki
        </h2>
        <p className={`text-base font-light mb-8 leading-relaxed ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
          扫描代码仓库，生成结构化的交互式 Wiki 文档
        </p>

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={`
            px-8 py-3 rounded-xl text-[15px] font-medium inline-flex items-center gap-2.5 transition-all duration-200
            ${isDarkMode
              ? 'bg-[#238636] text-white hover:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#484f58]'
              : 'bg-[#0071E3] text-white hover:bg-[#0077ED] disabled:bg-[#d2d2d7] disabled:text-[#86868b]'
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

        {/* 状态提示 */}
        {generationStatus && (
          <div className={`mt-4 flex items-center justify-center gap-2 text-[13px] ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
            {isGenerating && <Loader2 size={14} className="animate-spin" />}
            <span>{generationStatus}</span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className={`mt-4 text-[13px] ${isDarkMode ? 'text-[#f85149]' : 'text-red-500'}`}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default WikiBrowser;
