import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, PanelLeftClose, List } from 'lucide-react';
import { WikiBlock } from '../types';
import { WikiTheme, notionTheme } from '../config/wikiThemes';

interface WikiPageNode {
  path: string;
  name: string;
  children?: WikiPageNode[];
}

// Internal type for building the tree
interface TreeNodeBuilder {
  path: string;
  name: string;
  children?: { [key: string]: TreeNodeBuilder };
}

interface WikiPageNavigatorProps {
  wikiPages: string[];
  currentPage: string;
  onPageSelect: (pagePath: string) => void;
  onToggleVisibility?: () => void;
  blocks?: WikiBlock[];
  onBlockClick?: (blockId: string) => void;
  theme?: WikiTheme;
  isDarkMode?: boolean;
}

/**
 * 将扁平的页面路径列表转换为树形结构
 * 例如: ["/wiki/summary.json", "/wiki/module-A/page1.json"]
 * -> { name: "wiki", children: [...] }
 */
function buildPageTree(pages: string[]): WikiPageNode[] {
  const root: { [key: string]: TreeNodeBuilder } = {};

  pages.forEach(pagePath => {
    const parts = pagePath.split('/').filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const key = parts.slice(0, index + 1).join('/');

      if (!current[key]) {
        current[key] = {
          // 对于文件节点，使用原始路径以保持与 wikiPages 格式一致
          path: isFile ? pagePath : '/' + parts.slice(0, index + 1).join('/'),
          name: part,
          children: isFile ? undefined : {}
        };
      }

      if (!isFile && current[key].children) {
        current = current[key].children as { [key: string]: TreeNodeBuilder };
      }
    });
  });

  // 转换为数组并递归处理。排序规则:
  //   1. 名称含「总揽/总览」的置顶 (无论文件/目录) —— 两种字形都常见,同音近义
  //   2. 目录排在同级文件前
  //   3. 同类内部按字典序
  const sortBucket = (node: WikiPageNode): number => {
    if (node.name.includes('总揽') || node.name.includes('总览')) return 0;
    if (node.children && node.children.length > 0) return 1;
    return 2;
  };
  const convertToArray = (obj: any): WikiPageNode[] => {
    return Object.values(obj)
      .map((node: any): WikiPageNode => ({
        path: node.path,
        name: node.name,
        children: node.children ? convertToArray(node.children) : undefined
      }))
      .sort((a, b) => {
        const diff = sortBucket(a) - sortBucket(b);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
  };

  return convertToArray(root);
}

/**
 * 检查某个页面路径是否在节点的子树中
 */
const isPageInSubtree = (node: WikiPageNode, pagePath: string): boolean => {
  if (node.path === pagePath) return true;
  if (node.children) {
    return node.children.some(child => isPageInSubtree(child, pagePath));
  }
  return false;
};

/**
 * 树节点组件
 */
const TreeNode: React.FC<{
  node: WikiPageNode;
  level: number;
  currentPage: string;
  onSelect: (path: string) => void;
  theme: WikiTheme;
  isDarkMode?: boolean;
}> = ({ node, level, currentPage, onSelect, theme, isDarkMode = false }) => {
  const isFolder = node.children && node.children.length > 0;
  const isActive = node.path === currentPage;

  // 检查当前页面是否在此节点的子树中
  const containsCurrentPage = useMemo(() => {
    return isFolder && isPageInSubtree(node, currentPage);
  }, [isFolder, node, currentPage]);

  const [isExpanded, setIsExpanded] = useState(containsCurrentPage);

  // 当 currentPage 变化且该页面在子树中时，自动展开
  useEffect(() => {
    if (containsCurrentPage) {
      setIsExpanded(true);
    }
  }, [containsCurrentPage]);

  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all
          ${isActive
            ? theme.navigator.activeItem
            : `${theme.navigator.hoverBg} ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`
          }
        `}
        style={{ paddingLeft: `${level * 12 + 12}px` }}
      >
        {isFolder && (
          <div className="flex-shrink-0">
            {isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </div>
        )}

        <div className="flex-shrink-0">
          {isFolder ? (
            <Folder size={16} className={isActive ? theme.navigator.activeIcon : theme.navigator.inactiveIcon} />
          ) : (
            <FileText size={16} className={isActive ? theme.navigator.activeIcon : theme.navigator.inactiveIcon} />
          )}
        </div>

        <span className="text-sm font-medium truncate flex-1">
          {node.name.replace('.json', '')}
        </span>
      </div>

      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              currentPage={currentPage}
              onSelect={onSelect}
              theme={theme}
              isDarkMode={isDarkMode}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 从blocks中提取heading结构
 */
function extractHeadings(blocks: WikiBlock[]): { id: string; title: string; level: number }[] {
  const headings: { id: string; title: string; level: number }[] = [];

  const traverse = (blockList: WikiBlock[]) => {
    for (const block of blockList) {
      if (block.type === 'heading') {
        headings.push({
          id: block.id,
          title: block.content.replace(/^#{1,6}\s*/, ''),
          level: block.level || 1
        });
      }
      if (block.children) {
        traverse(block.children);
      }
    }
  };

  traverse(blocks);
  return headings;
}

/**
 * Wiki 页面导航器
 */
const WikiPageNavigator: React.FC<WikiPageNavigatorProps> = ({
  wikiPages,
  currentPage,
  onPageSelect,
  onToggleVisibility,
  blocks = [],
  onBlockClick,
  theme = notionTheme,
  isDarkMode = false
}) => {
  const tree = useMemo(() => buildPageTree(wikiPages), [wikiPages]);
  const [activeTab, setActiveTab] = useState<'pages' | 'structure'>('pages');
  const headings = extractHeadings(blocks);

  return (
    <div className="bg-transparent p-2 h-full w-full flex flex-col">
      <div className={`flex-shrink-0 mb-3 pb-3 border-b ${theme.navigator.border}`}>
        <div className="flex items-center justify-between">
          {/* Tab 切换 */}
          <div className={`flex backdrop-blur-md rounded-xl p-0.5 border ${theme.navigator.border} ${isDarkMode ? 'bg-[#21262d]/60' : 'bg-white/40'}`}>
            <button
              onClick={() => setActiveTab('pages')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeTab === 'pages'
                  ? theme.navigator.tabActive
                  : theme.navigator.tabInactive
              }`}
            >
              <Folder size={12} className="inline mr-1" />
              文件
            </button>
            <button
              onClick={() => setActiveTab('structure')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeTab === 'structure'
                  ? theme.navigator.tabActive
                  : theme.navigator.tabInactive
              }`}
            >
              <List size={12} className="inline mr-1" />
              大纲
            </button>
          </div>
          {onToggleVisibility && (
            <button
              onClick={onToggleVisibility}
              className={`p-1.5 rounded-lg ${theme.navigator.hoverBg} ${isDarkMode ? 'text-[#7d8590] hover:text-[#e6edf3]' : 'text-[#86868b] hover:text-[#1d1d1f]'} transition-colors`}
              title="隐藏导航"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto min-h-0">
        {activeTab === 'pages' ? (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              level={0}
              currentPage={currentPage}
              onSelect={onPageSelect}
              theme={theme}
              isDarkMode={isDarkMode}
            />
          ))
        ) : (
          headings.length > 0 ? (
            headings.map((heading) => {
              // 根据级别设置不同的字体大小和样式
              const levelStyles: Record<number, string> = isDarkMode ? {
                1: 'text-base font-semibold text-[#e6edf3]',
                2: 'text-sm font-medium text-[#e6edf3]',
                3: 'text-sm text-[#c9d1d9]',
                4: 'text-xs text-[#8b949e]',
                5: 'text-xs text-[#7d8590]',
                6: 'text-xs text-[#6e7681]',
              } : {
                1: 'text-base font-semibold text-[#1d1d1f]',
                2: 'text-sm font-medium text-[#1d1d1f]',
                3: 'text-sm text-[#3a3a3c]',
                4: 'text-xs text-[#48484a]',
                5: 'text-xs text-[#636366]',
                6: 'text-xs text-[#86868b]',
              };
              const textStyle = levelStyles[heading.level] || levelStyles[3];

              return (
                <div
                  key={heading.id}
                  onClick={() => onBlockClick?.(heading.id)}
                  className={`px-3 py-1.5 rounded-xl cursor-pointer ${theme.navigator.hoverBg} transition-all truncate ${textStyle}`}
                  style={{ paddingLeft: `${(heading.level - 1) * 12 + 12}px` }}
                >
                  {heading.title}
                </div>
              );
            })
          ) : (
            <div className={`text-sm text-center py-4 ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>暂无内容结构</div>
          )
        )}
      </div>

      <div className={`flex-shrink-0 mt-3 pt-3 border-t ${theme.navigator.border}`}>
        <div className={`text-xs flex items-center gap-1 ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>
          <FileText size={12} className={theme.navigator.inactiveIcon} />
          当前wiki页面: {currentPage.split('/').pop()?.replace('.json', '')}
        </div>
      </div>
    </div>
  );
};

export default WikiPageNavigator;
