
import React, { useEffect, useRef, useState } from 'react';
import { X, FileCode, ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { SourceLocation } from '../types';
import { MOCK_REPO_FILES } from '../mock/sourceCode';

interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileTreeNode[];
}

// VSCode Dark Theme (Inlined to avoid deep import issues in some environments)
const vscDarkTheme = {
  "code[class*=\"language-\"]": {
    "color": "#d4d4d4",
    "fontSize": "13px",
    "textShadow": "none",
    "fontFamily": "Menlo, Monaco, Consolas, \"Andale Mono\", \"Ubuntu Mono\", \"Courier New\", monospace",
    "direction": "ltr",
    "textAlign": "left",
    "whiteSpace": "pre",
    "wordSpacing": "normal",
    "wordBreak": "normal",
    "lineHeight": "1.5",
    "MozTabSize": "4",
    "OTabSize": "4",
    "tabSize": "4",
    "hyphens": "none"
  },
  "pre[class*=\"language-\"]": {
    "color": "#d4d4d4",
    "fontSize": "13px",
    "textShadow": "none",
    "fontFamily": "Menlo, Monaco, Consolas, \"Andale Mono\", \"Ubuntu Mono\", \"Courier New\", monospace",
    "direction": "ltr",
    "textAlign": "left",
    "whiteSpace": "pre",
    "wordSpacing": "normal",
    "wordBreak": "normal",
    "lineHeight": "1.5",
    "MozTabSize": "4",
    "OTabSize": "4",
    "tabSize": "4",
    "hyphens": "none",
    "padding": "1em",
    "margin": ".5em 0",
    "overflow": "auto",
    "background": "#1e1e1e"
  },
  "code[class*=\"language-\"] ::selection": {
    "textShadow": "none",
    "background": "#264F78"
  },
  "code[class*=\"language-\"] ::moz-selection": {
    "textShadow": "none",
    "background": "#264F78"
  },
  "pre[class*=\"language-\"] ::selection": {
    "textShadow": "none",
    "background": "#264F78"
  },
  "pre[class*=\"language-\"] ::moz-selection": {
    "textShadow": "none",
    "background": "#264F78"
  },
  ":not(pre) > code[class*=\"language-\"]": {
    "padding": ".1em .3em",
    "borderRadius": ".3em",
    "color": "#db4c69",
    "background": "#1e1e1e"
  },
  "comment": { "color": "#6a9955" },
  "prolog": { "color": "#6a9955" },
  "doctype": { "color": "#6a9955" },
  "cdata": { "color": "#6a9955" },
  "punctuation": { "color": "#d4d4d4" },
  "namespace": { "Opacity": ".7" },
  "property": { "color": "#9cdcfe" },
  "keyword": { "color": "#569cd6" },
  "tag": { "color": "#569cd6" },
  "class-name": { "color": "#4ec9b0" },
  "boolean": { "color": "#569cd6" },
  "constant": { "color": "#9cdcfe" },
  "symbol": { "color": "#b5cea8" },
  "deleted": { "color": "#b5cea8" },
  "number": { "color": "#b5cea8" },
  "selector": { "color": "#d7ba7d" },
  "attr-name": { "color": "#9cdcfe" },
  "string": { "color": "#ce9178" },
  "char": { "color": "#ce9178" },
  "builtin": { "color": "#4ec9b0" },
  "inserted": { "color": "#ce9178" },
  "variable": { "color": "#9cdcfe" },
  "operator": { "color": "#d4d4d4" },
  "entity": { "color": "#4ec9b0", "cursor": "help" },
  "url": { "color": "#9cdcfe" },
  ".language-css .token.string": { "color": "#ce9178" },
  ".style .token.string": { "color": "#ce9178" },
  "atrule": { "color": "#c586c0" },
  "attr-value": { "color": "#ce9178" },
  "function": { "color": "#dcdcaa" },
  "regex": { "color": "#d16969" },
  "important": { "color": "#569cd6", "fontWeight": "bold" },
  "bold": { "fontWeight": "bold" },
  "italic": { "fontStyle": "italic" }
};

interface SourceCodePanelProps {
  isOpen: boolean;
  onClose: () => void;
  location: SourceLocation | null;
  panelWidth: number;
  onWidthChange: (width: number) => void;
}

// 构建文件树
const buildFileTree = (files: string[]): FileTreeNode[] => {
  const root: FileTreeNode[] = [];
  const folderMap = new Map<string, FileTreeNode>();

  files.forEach(filePath => {
    const parts = filePath.split('/');
    let currentPath = '';

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!folderMap.has(currentPath)) {
        const node: FileTreeNode = {
          name: part,
          path: currentPath,
          isFolder: !isLast,
          children: isLast ? undefined : []
        };
        folderMap.set(currentPath, node);

        if (parentPath) {
          folderMap.get(parentPath)?.children?.push(node);
        } else {
          root.push(node);
        }
      }
    });
  });

  return root;
};

const SourceCodePanel: React.FC<SourceCodePanelProps> = ({ isOpen, onClose, location, panelWidth, onWidthChange }) => {
  const codeRef = useRef<HTMLDivElement>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const isDraggingTreeRef = useRef(false);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [highlightEndLine, setHighlightEndLine] = useState<number | null>(null);
  const [treeWidth, setTreeWidth] = useState<number>(200); // 初始宽度 200px

  // 加载文件列表 - 自动从 source-code 目录读取
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/source-code/files')
      .then(res => res.json())
      .then(data => {
        setFileTree(buildFileTree(data.files || []));
      })
      .catch(() => setFileTree([]));
  }, [isOpen]);

  // 当 location 变化时，同步 currentFile 和 highlightLine，并只展开该文件所在目录
  useEffect(() => {
    if (location) {
      setCurrentFile(location.file);
      setHighlightLine(location.line);
      setHighlightEndLine(location.endLine || null);

      // 只展开当前文件所在的目录路径
      const folders = new Set<string>();
      const parts = location.file.split('/');
      let path = '';
      parts.slice(0, -1).forEach((p: string) => {
        path = path ? `${path}/${p}` : p;
        folders.add(path);
      });
      setExpandedFolders(folders);
    }
  }, [location]);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectFile = (path: string) => {
    setCurrentFile(path);
    // 不清除高亮信息，保留原始 location 的高亮状态
  };

  // 当前显示的文件路径
  const displayFile = currentFile || location?.file || null;

  // Drag resize handler for panel
  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      // Use requestAnimationFrame for smooth updates
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const newWidth = Math.max(300, Math.min(window.innerWidth - e.clientX, window.innerWidth - 100));
        onWidthChange(newWidth);
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.classList.remove('select-none');
      if (rafId) cancelAnimationFrame(rafId);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [onWidthChange]);

  // Drag resize handler for tree width
  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingTreeRef.current) return;

      // Use requestAnimationFrame for smooth updates
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const panel = document.querySelector('.source-code-panel') as HTMLElement;
        if (!panel) return;
        const panelRect = panel.getBoundingClientRect();
        const newWidth = Math.max(150, Math.min(e.clientX - panelRect.left, panelWidth - 300));
        setTreeWidth(newWidth);
      });
    };

    const handleMouseUp = () => {
      isDraggingTreeRef.current = false;
      document.body.classList.remove('select-none');
      if (rafId) cancelAnimationFrame(rafId);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [panelWidth]);

  // Map file extension to language support by Prism
  const language = displayFile?.endsWith('.java') ? 'java' :
                   displayFile?.endsWith('.yml') ? 'yaml' :
                   displayFile?.endsWith('.xml') ? 'xml' :
                   displayFile?.endsWith('.json') ? 'json' :
                   displayFile?.endsWith('.js') ? 'javascript' :
                   displayFile?.endsWith('.ts') ? 'typescript' :
                   displayFile?.endsWith('.tsx') ? 'tsx' :
                   displayFile?.endsWith('.py') ? 'python' :
                   displayFile?.endsWith('.go') ? 'go' : 'text';

  // 加载源代码文件
  useEffect(() => {
    if (!displayFile || !isOpen) {
      return;
    }

    setLoading(true);
    setError(null);

    // 从 public/source-code 目录加载实际文件
    const filePath = `/source-code/${displayFile}`;

    fetch(filePath)
      .then(response => {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          throw new Error(`文件不存在: ${displayFile}`);
        }
        if (!response.ok) {
          throw new Error(`文件加载失败: ${response.status}`);
        }
        return response.text();
      })
      .then(content => {
        if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
          throw new Error(`文件路径可能不正确: ${displayFile}`);
        }
        setFileContent(content);
        setLoading(false);
      })
      .catch(err => {
        const mockContent = MOCK_REPO_FILES[displayFile];
        if (mockContent) {
          setFileContent(mockContent);
          setLoading(false);
        } else {
          setError(err.message || '文件加载失败');
          setFileContent('');
          setLoading(false);
        }
      });
  }, [displayFile, isOpen]);

  // 滚动到高亮行的函数
  const scrollToHighlightLine = () => {
    if (highlightLine && codeRef.current) {
      const lineHeight = 21;
      const scrollPos = Math.max(0, (highlightLine - 10) * lineHeight);
      codeRef.current.scrollTo({ top: scrollPos, behavior: 'smooth' });
    }
  };

  // 跳转到目标文件并滚动到高亮行
  const jumpToHighlightLocation = () => {
    if (!location) return;

    // 如果当前文件不是目标文件，先切换文件
    if (displayFile !== location.file) {
      setCurrentFile(location.file);
      // 展开目标文件所在的目录
      const folders = new Set<string>();
      const parts = location.file.split('/');
      let path = '';
      parts.slice(0, -1).forEach((p: string) => {
        path = path ? `${path}/${p}` : p;
        folders.add(path);
      });
      setExpandedFolders(prev => new Set([...prev, ...folders]));
      // 文件切换后，useEffect 会自动触发滚动
    } else {
      // 已经是目标文件，直接滚动
      scrollToHighlightLine();
    }
  };

  // Scroll to line logic
  useEffect(() => {
    if (isOpen && highlightLine && codeRef.current) {
      setTimeout(() => {
        scrollToHighlightLine();
      }, 100);
    }
  }, [isOpen, highlightLine, displayFile]);

  // 渲染文件树节点
  const renderTreeNode = (node: FileTreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = node.path === displayFile;

    if (node.isFolder) {
      return (
        <div key={node.path}>
          <div
            className="flex items-center gap-1 px-2 py-1 hover:bg-[#2a2d2e] cursor-pointer text-gray-300 text-xs"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {isExpanded ? <FolderOpen size={14} className="text-[#dcb67a]" /> : <Folder size={14} className="text-[#dcb67a]" />}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && node.children?.map(child => renderTreeNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer text-xs ${isSelected ? 'bg-[#094771] text-white' : 'hover:bg-[#2a2d2e] text-gray-300'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => selectFile(node.path)}
      >
        <FileCode size={14} className="text-[#519aba] flex-shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  };

  return (
    <div
      className={`
        source-code-panel fixed top-0 right-0 h-full bg-[#1e1e1e]/90 backdrop-blur-xl shadow-2xl transform transition-transform duration-300 ease-out z-[100] border-l border-[#333] flex flex-col
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}
      style={{ width: panelWidth }}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/30 z-10"
        onMouseDown={() => {
          isDraggingRef.current = true;
          document.body.classList.add('select-none');
        }}
      />
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#333] bg-[#252526]/60 backdrop-blur-md">
        <div className="flex items-center gap-2 overflow-hidden">
           <FileCode size={16} className="text-[#4EC9B0] flex-shrink-0" />
           <span className="text-xs text-gray-400 truncate" title={displayFile || ''}>{displayFile || '选择文件'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {location && highlightLine && (
            <button
              onClick={jumpToHighlightLocation}
              className="text-[11px] text-white font-mono bg-[#007acc]/80 hover:bg-[#007acc] px-2 py-0.5 rounded shadow-lg truncate max-w-[200px] cursor-pointer transition-colors"
              title={`点击跳转到 ${location.file}:${highlightLine}${highlightEndLine && highlightEndLine !== highlightLine ? `-${highlightEndLine}` : ''}`}
            >
              {location.file.split('/').pop()}:{highlightLine}{highlightEndLine && highlightEndLine !== highlightLine ? `-${highlightEndLine}` : ''}
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 hover:bg-[#333] rounded flex-shrink-0">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Content Area - Horizontal Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Tree - Left Sidebar */}
        {fileTree.length > 0 && (
          <div
            className="border-r border-[#333] bg-[#252526]/40 overflow-y-auto custom-scrollbar flex-shrink-0 relative"
            style={{ width: treeWidth }}
          >
            <div className="py-1">
              {fileTree.map(node => renderTreeNode(node))}
            </div>
            {/* Tree resize handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/50 z-10"
              onMouseDown={() => {
                isDraggingTreeRef.current = true;
                document.body.classList.add('select-none');
              }}
            />
          </div>
        )}

        {/* Code Area - Right Side */}
        <div className="flex-1 overflow-y-auto custom-scrollbar relative" ref={codeRef}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <p className="text-sm">加载源代码中...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
              <FileCode size={40} strokeWidth={1} className="text-red-400" />
              <p className="text-red-400">加载失败</p>
              <p className="text-xs opacity-70">{error}</p>
              <p className="text-xs opacity-50">{displayFile}</p>
            </div>
          ) : fileContent ? (
            <SyntaxHighlighter
              language={language}
              style={vscDarkTheme as any}
              showLineNumbers={true}
              wrapLines={true}
              lineProps={(lineNumber: number) => {
                const style: React.CSSProperties = { display: 'block' };
                // 只有当显示的文件与 location 的文件相同时，才应用高亮
                if (highlightLine && displayFile === location?.file) {
                  const endLine = highlightEndLine || highlightLine;
                  if (lineNumber >= highlightLine && lineNumber <= endLine) {
                    style.backgroundColor = '#37373d';
                    style.borderLeft = '4px solid #007acc';
                  }
                }
                return { style };
              }}
              customStyle={{
                margin: 0,
                padding: '20px 0',
                backgroundColor: 'transparent',
                fontSize: '13px',
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                lineHeight: '21px'
              }}
            >
              {fileContent}
            </SyntaxHighlighter>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
               <FileCode size={40} strokeWidth={1} />
               <p>{displayFile ? '未找到源代码文件' : '请选择文件'}</p>
               {displayFile && <p className="text-xs opacity-50">{displayFile}</p>}
               <p className="text-xs opacity-70 mt-2 text-center px-4">
                 请将源代码文件放置在 <code className="bg-[#333] px-1 py-0.5 rounded">public/source-code/</code> 目录
               </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SourceCodePanel;
