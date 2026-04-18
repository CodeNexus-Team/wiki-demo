import React, { useState, useEffect, useCallback } from 'react';
import { Folder, ChevronRight, ArrowUp, X, Loader2, AlertCircle, Check, Home } from 'lucide-react';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { FsBrowseResponse } from '../types';

interface DirectoryPickerProps {
  isOpen: boolean;
  initialPath?: string;
  title?: string;
  isDarkMode?: boolean;
  onClose: () => void;
  onSelect: (absolutePath: string) => void;
  /**
   * 可选的目录浏览数据源。默认走后端 /api/fs/browse。
   * BackendLauncher 场景下可传 browseDirectoryViaDev 走 Vite dev 插件。
   */
  browser?: (path: string) => Promise<FsBrowseResponse>;
}

/**
 * 服务端目录浏览弹层。
 * - 初始路径:优先用 initialPath(若存在),否则从用户 HOME 开始
 * - 单击子目录 = 进入; 点击"选择此目录"按钮 = 提交当前路径
 * - 顶部路径可直接编辑,按回车跳转
 * - "返回上级"按钮使用后端返回的 parent
 */
const DirectoryPicker: React.FC<DirectoryPickerProps> = ({
  isOpen,
  initialPath,
  title = '选择目录',
  isDarkMode = false,
  onClose,
  onSelect,
  browser,
}) => {
  const [data, setData] = useState<FsBrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 顶部可编辑的路径输入(按回车生效)
  const [pathInput, setPathInput] = useState('');

  const loadPath = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const fetcher = browser ?? codenexusWikiService.browseDirectory.bind(codenexusWikiService);
      const resp = await fetcher(path);
      setData(resp);
      setPathInput(resp.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // 加载失败不清空 data,让用户仍能看到之前的路径
    } finally {
      setLoading(false);
    }
  }, [browser]);

  // 打开时加载初始路径
  useEffect(() => {
    if (!isOpen) return;
    loadPath(initialPath?.trim() || '~');
  }, [isOpen, initialPath, loadPath]);

  if (!isOpen) return null;

  const panelBg = isDarkMode ? 'bg-[#161b22] border-[#30363d] text-[#e6edf3]' : 'bg-white border-[#e5e5ea] text-[#1d1d1f]';
  const muted = isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]';
  const inputBase = `w-full px-3 py-2 rounded-lg text-sm border outline-none font-mono ${
    isDarkMode
      ? 'bg-[#0d1117] border-[#30363d] text-[#e6edf3] focus:border-[#58a6ff]'
      : 'bg-white border-[#e5e5ea] text-[#1d1d1f] focus:border-[#0071E3]'
  }`;
  const btnSecondary = `px-3 py-1.5 rounded-lg text-[13px] border transition-colors inline-flex items-center gap-1.5 ${
    isDarkMode
      ? 'bg-[#21262d] border-[#30363d] hover:bg-[#30363d] text-[#e6edf3]'
      : 'bg-[#f5f5f7] border-[#e5e5ea] hover:bg-[#e8e8ed] text-[#1d1d1f]'
  }`;

  const entries = data?.entries ?? [];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className={`rounded-xl border shadow-2xl w-full max-w-2xl flex flex-col ${panelBg}`}
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className={`px-5 py-3.5 border-b flex items-center justify-between ${
          isDarkMode ? 'border-[#30363d]' : 'border-[#e5e5ea]'
        }`}>
          <div className="flex items-center gap-2">
            <Folder size={16} className={isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'} />
            <span className="text-[14px] font-medium">{title}</span>
          </div>
          <button onClick={onClose} className={`p-1 rounded ${isDarkMode ? 'hover:bg-[#30363d]' : 'hover:bg-[#f0f0f0]'}`}>
            <X size={16} />
          </button>
        </div>

        {/* 路径输入栏 */}
        <div className={`px-5 py-3 border-b ${isDarkMode ? 'border-[#30363d]' : 'border-[#e5e5ea]'} flex items-center gap-2`}>
          <button
            type="button"
            onClick={() => loadPath('~')}
            className={btnSecondary}
            title="回到主目录"
          >
            <Home size={14} />
          </button>
          <button
            type="button"
            onClick={() => data?.parent && loadPath(data.parent)}
            disabled={!data?.parent || loading}
            className={`${btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
            title="返回上级"
          >
            <ArrowUp size={14} />
          </button>
          <input
            type="text"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                loadPath(pathInput);
              }
            }}
            placeholder="输入绝对路径后按回车"
            className={inputBase}
            spellCheck={false}
          />
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className={`flex items-center justify-center gap-2 py-12 ${muted}`}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          )}
          {!loading && error && (
            <div className={`flex items-start gap-2 mx-5 my-4 px-4 py-3 rounded-lg text-[13px] ${
              isDarkMode ? 'bg-[#422d1a] text-[#f0b76b]' : 'bg-[#fff4e6] text-[#a35b00]'
            }`}>
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className={`text-center py-12 text-sm ${muted}`}>
              <Folder size={28} className="mx-auto mb-2 opacity-40" />
              <div>此目录下没有子目录</div>
              <div className="text-[12px] mt-1">你可以直接点"选择此目录"提交当前路径</div>
            </div>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="py-1">
              {entries.map(entry => {
                const childPath = data!.path === '/'
                  ? `/${entry.name}`
                  : `${data!.path}/${entry.name}`;
                return (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() => loadPath(childPath)}
                    className={`w-full flex items-center gap-2 px-5 py-2 text-left text-[13px] transition-colors ${
                      isDarkMode ? 'hover:bg-[#21262d]' : 'hover:bg-[#f5f5f7]'
                    }`}
                  >
                    <Folder size={14} className={isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'} />
                    <span className="flex-1 truncate">{entry.name}</span>
                    <ChevronRight size={14} className={muted} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className={`px-5 py-3.5 border-t flex items-center gap-3 ${
          isDarkMode ? 'border-[#30363d]' : 'border-[#e5e5ea]'
        }`}>
          <div className={`flex-1 text-[12px] font-mono truncate ${muted}`}>
            {data ? `当前: ${data.path}` : ''}
          </div>
          <button type="button" onClick={onClose} className={btnSecondary}>
            取消
          </button>
          <button
            type="button"
            onClick={() => data && onSelect(data.path)}
            disabled={!data || loading}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors ${
              isDarkMode
                ? 'bg-[#238636] text-white hover:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed'
                : 'bg-[#0071E3] text-white hover:bg-[#0077ED] disabled:bg-[#d2d2d7] disabled:text-[#86868b] disabled:cursor-not-allowed'
            }`}
          >
            <Check size={14} />
            选择此目录
          </button>
        </div>
      </div>
    </div>
  );
};

export default DirectoryPicker;
