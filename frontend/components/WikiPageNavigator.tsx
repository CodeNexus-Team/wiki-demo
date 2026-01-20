import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, PanelLeftClose, List } from 'lucide-react';
import { WikiBlock } from '../types';

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
          path: '/' + parts.slice(0, index + 1).join('/'),
          name: part,
          children: isFile ? undefined : {}
        };
      }

      if (!isFile && current[key].children) {
        current = current[key].children as { [key: string]: TreeNodeBuilder };
      }
    });
  });

  // 转换为数组并递归处理
  const convertToArray = (obj: any): WikiPageNode[] => {
    return Object.values(obj).map((node: any) => ({
      path: node.path,
      name: node.name,
      children: node.children ? convertToArray(node.children) : undefined
    }));
  };

  return convertToArray(root);
}

/**
 * 树节点组件
 */
const TreeNode: React.FC<{
  node: WikiPageNode;
  level: number;
  currentPage: string;
  onSelect: (path: string) => void;
}> = ({ node, level, currentPage, onSelect }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const isFolder = node.children && node.children.length > 0;
  const isActive = node.path === currentPage;
  const isFile = !isFolder;

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
          flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all
          ${isActive
            ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-sm'
            : 'hover:bg-gray-100 text-gray-700'
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
            <Folder size={16} className={isActive ? 'text-white' : 'text-orange-500'} />
          ) : (
            <FileText size={16} className={isActive ? 'text-white' : 'text-blue-500'} />
          )}
        </div>

        <span className="text-sm font-medium truncate flex-1">
          {node.name.replace('.json', '')}
        </span>
      </div>

      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child, index) => (
            <TreeNode
              key={index}
              node={child}
              level={level + 1}
              currentPage={currentPage}
              onSelect={onSelect}
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
  onBlockClick
}) => {
  const tree = buildPageTree(wikiPages);
  const [activeTab, setActiveTab] = useState<'pages' | 'structure'>('pages');
  const headings = extractHeadings(blocks);

  return (
    <div className="bg-white rounded-2xl shadow-apple-card border border-white p-4 resize overflow-auto" style={{ width: 256, minWidth: 200, minHeight: 200 }}>
      <div className="mb-3 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          {/* Tab 切换 */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab('pages')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                activeTab === 'pages'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Folder size={12} className="inline mr-1" />
              文件
            </button>
            <button
              onClick={() => setActiveTab('structure')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                activeTab === 'structure'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <List size={12} className="inline mr-1" />
              大纲
            </button>
          </div>
          {onToggleVisibility && (
            <button
              onClick={onToggleVisibility}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-orange-600 transition-colors"
              title="隐藏导航"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {activeTab === 'pages' ? (
          tree.map((node, index) => (
            <TreeNode
              key={index}
              node={node}
              level={0}
              currentPage={currentPage}
              onSelect={onPageSelect}
            />
          ))
        ) : (
          headings.length > 0 ? (
            headings.map((heading) => {
              // 根据级别设置不同的字体大小和样式
              const levelStyles: Record<number, string> = {
                1: 'text-base font-semibold text-gray-900',
                2: 'text-sm font-medium text-gray-800',
                3: 'text-sm text-gray-700',
                4: 'text-xs text-gray-600',
                5: 'text-xs text-gray-500',
                6: 'text-xs text-gray-400',
              };
              const textStyle = levelStyles[heading.level] || levelStyles[3];

              return (
                <div
                  key={heading.id}
                  onClick={() => onBlockClick?.(heading.id)}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100 transition-all truncate ${textStyle}`}
                  style={{ paddingLeft: `${(heading.level - 1) * 12 + 12}px` }}
                >
                  {heading.title}
                </div>
              );
            })
          ) : (
            <div className="text-sm text-gray-400 text-center py-4">暂无内容结构</div>
          )
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <FileText size={12} />
          当前wiki页面: {currentPage.split('/').pop()?.replace('.json', '')}
        </div>
      </div>
    </div>
  );
};

export default WikiPageNavigator;
