import React, { useCallback, useState } from 'react';
import { Code, Eye, Columns, Settings } from 'lucide-react';
import { useMermaidEditor } from '../../hooks/useMermaidEditor';
import { EditorPanel } from './EditorPanel';
import { PreviewPanel } from './PreviewPanel';
import { ToolBar } from './ToolBar';

type ViewMode = 'split' | 'editor' | 'preview';

interface MermaidEditorProps {
  /** 初始 Mermaid 代码 */
  initialCode?: string;
  /** 代码变化回调 */
  onChange?: (code: string) => void;
  /** 是否启用节点拖拽 */
  enableDrag?: boolean;
  /** 容器高度 */
  height?: string | number;
  /** 是否显示工具栏 */
  showToolbar?: boolean;
  /** 暗色模式 */
  isDarkMode?: boolean;
}

const DEFAULT_CODE = `flowchart LR
    A[开始] --> B{判断条件}
    B -->|是| C[执行操作A]
    B -->|否| D[执行操作B]
    C --> E[结束]
    D --> E`;

export const MermaidEditor: React.FC<MermaidEditorProps> = ({
  initialCode = DEFAULT_CODE,
  onChange,
  enableDrag = true,
  height = '600px',
  showToolbar = true,
  isDarkMode = false,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showSettings, setShowSettings] = useState(true);

  const {
    code,
    config,
    setCode,
    setDirection,
    setNodeSpacing,
    setRankSpacing,
    processedCode,
  } = useMermaidEditor(initialCode);

  // 代码变化处理
  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      onChange?.(newCode);
    },
    [setCode, onChange]
  );

  // 节点拖拽结束
  const handleDragEnd = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      console.log(`Node ${nodeId} moved to:`, position);
      // 这里可以添加位置信息到代码注释中
    },
    []
  );

  // 重置布局
  const handleResetLayout = useCallback(() => {
    // 触发重新渲染
    setCode(code);
  }, [code, setCode]);

  return (
    <div
      className="flex flex-col bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200"
      style={{ height }}
    >
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Mermaid 编辑器</h3>
        </div>

        <div className="flex items-center gap-2">
          {/* 视图模式切换 */}
          <div className="flex items-center bg-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('editor')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'editor'
                  ? 'bg-white shadow-sm text-gray-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="仅编辑器"
            >
              <Code size={16} />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'split'
                  ? 'bg-white shadow-sm text-gray-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="分栏视图"
            >
              <Columns size={16} />
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'preview'
                  ? 'bg-white shadow-sm text-gray-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="仅预览"
            >
              <Eye size={16} />
            </button>
          </div>

          {/* 设置按钮 */}
          {showToolbar && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-lg transition-colors ${
                showSettings
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-500 hover:bg-gray-200'
              }`}
              title="布局设置"
            >
              <Settings size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 布局设置工具栏 */}
      {showToolbar && showSettings && (
        <ToolBar
          direction={config.direction}
          nodeSpacing={config.nodeSpacing}
          rankSpacing={config.rankSpacing}
          onDirectionChange={setDirection}
          onNodeSpacingChange={setNodeSpacing}
          onRankSpacingChange={setRankSpacing}
          onResetLayout={handleResetLayout}
        />
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 编辑器面板 */}
        {(viewMode === 'editor' || viewMode === 'split') && (
          <div
            className={`${
              viewMode === 'split' ? 'w-1/2 border-r border-gray-200' : 'w-full'
            } flex flex-col`}
          >
            <div className="flex-1 p-2">
              <EditorPanel
                code={code}
                onChange={handleCodeChange}
                isDarkMode={isDarkMode}
              />
            </div>
          </div>
        )}

        {/* 预览面板 */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} flex flex-col`}>
            <div className="flex-1 p-2">
              <PreviewPanel
                code={processedCode}
                enableDrag={enableDrag}
                onDragEnd={handleDragEnd}
                onResetLayout={handleResetLayout}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MermaidEditor;
