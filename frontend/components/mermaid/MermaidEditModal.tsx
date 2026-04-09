import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Code, Eye, Columns, Settings, Save, RotateCcw, Play } from 'lucide-react';
import { MermaidMetadata } from '../../types';
import { useMermaidEditor } from '../../hooks/useMermaidEditor';
import { EditorPanel } from '../mermaid-editor/EditorPanel';
import { PreviewPanel } from '../mermaid-editor/PreviewPanel';
import { ToolBar } from '../mermaid-editor/ToolBar';

type ViewMode = 'split' | 'editor' | 'preview';

interface MermaidEditModalProps {
  isOpen: boolean;
  initialChart: string;
  metadata?: MermaidMetadata;
  onClose: () => void;
  onSave?: (newChart: string) => void;
  onApply?: (newChart: string) => void;
  onNodeClick?: (nodeId: string) => void;
}

export const MermaidEditModal: React.FC<MermaidEditModalProps> = ({
  isOpen,
  initialChart,
  metadata,
  onClose,
  onSave,
  onApply,
  onNodeClick,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showSettings, setShowSettings] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalChart] = useState(initialChart);

  // 模态框位置和大小
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const isDraggingRef = useRef<'left' | 'right' | 'top' | 'bottom' | 'move' | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const {
    code,
    config,
    chartType,
    setCode,
    setDirection,
    setNodeSpacing,
    setRankSpacing,
    processedCode,
  } = useMermaidEditor(initialChart);

  // 初始化模态框位置和大小
  useEffect(() => {
    if (isOpen) {
      const width = Math.min(window.innerWidth * 0.9, 1400);
      const height = Math.min(window.innerHeight * 0.9, 900);
      setSize({ width, height });
      setPosition({
        left: (window.innerWidth - width) / 2,
        top: (window.innerHeight - height) / 2,
      });
      setHasChanges(false);
    }
  }, [isOpen, initialChart]);

  // 检测变化
  useEffect(() => {
    setHasChanges(code !== originalChart);
  }, [code, originalChart]);

  // 代码变化处理
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
  }, [setCode]);

  // 应用（更新 Wiki 但不关闭）
  const handleApply = useCallback(() => {
    onApply?.(code);
    setHasChanges(false);
  }, [code, onApply]);

  // 保存
  const handleSave = useCallback(() => {
    onSave?.(code);
    onClose();
  }, [code, onSave, onClose]);

  // 重置
  const handleReset = useCallback(() => {
    setCode(originalChart);
  }, [originalChart, setCode]);

  // 拖拽移动
  const handleMoveStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    isDraggingRef.current = 'move';
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: position.left,
      top: position.top,
    };
  }, [position]);

  // 调整大小
  const handleResizeStart = useCallback((direction: 'left' | 'right' | 'top' | 'bottom') => {
    isDraggingRef.current = direction;
  }, []);

  // 鼠标移动和释放处理
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      if (isDraggingRef.current === 'move' && dragStartRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        setPosition({
          left: dragStartRef.current.left + dx,
          top: dragStartRef.current.top + dy,
        });
      } else if (isDraggingRef.current === 'right') {
        setSize(prev => ({ ...prev, width: Math.max(600, e.clientX - position.left) }));
      } else if (isDraggingRef.current === 'left') {
        const newWidth = Math.max(600, size.width + (position.left - e.clientX));
        setPosition(prev => ({ ...prev, left: e.clientX }));
        setSize(prev => ({ ...prev, width: newWidth }));
      } else if (isDraggingRef.current === 'bottom') {
        setSize(prev => ({ ...prev, height: Math.max(400, e.clientY - position.top) }));
      } else if (isDraggingRef.current === 'top') {
        const newHeight = Math.max(400, size.height + (position.top - e.clientY));
        setPosition(prev => ({ ...prev, top: e.clientY }));
        setSize(prev => ({ ...prev, height: newHeight }));
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = null;
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isOpen, position, size]);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handleSave]);

  if (!isOpen) return null;

  // 使用 Portal 渲染到 body，避免被父容器限制
  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm">
      <div
        className="absolute bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          left: position.left,
          top: position.top,
          width: size.width,
          height: size.height,
        }}
      >
        {/* 调整大小手柄 */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/20 z-10"
          onMouseDown={() => handleResizeStart('left')}
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/20 z-10"
          onMouseDown={() => handleResizeStart('right')}
        />
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/20 z-10"
          onMouseDown={() => handleResizeStart('top')}
        />
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/20 z-10"
          onMouseDown={() => handleResizeStart('bottom')}
        />

        {/* 顶部标题栏 */}
        <div
          className="flex items-center justify-between px-4 py-3 bg-gradient-to-b from-gray-50 to-white border-b border-gray-200 cursor-move"
          onMouseDown={handleMoveStart}
        >
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-gray-800">Mermaid 图表编辑器</h3>
            {hasChanges && (
              <span className="px-2 py-0.5 text-xs font-medium text-amber-600 bg-amber-100 rounded-full">
                未保存
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 视图模式切换 */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 mr-2">
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
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-lg transition-colors ${
                showSettings
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
              title="布局设置"
            >
              <Settings size={16} />
            </button>

            {/* 重置按钮 */}
            <button
              onClick={handleReset}
              disabled={!hasChanges}
              className={`p-1.5 rounded-lg transition-colors ${
                hasChanges
                  ? 'text-gray-500 hover:bg-gray-100'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
              title="重置更改"
            >
              <RotateCcw size={16} />
            </button>

            {/* 应用按钮 */}
            {onApply && (
              <button
                onClick={handleApply}
                disabled={!hasChanges}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  hasChanges
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
                title="应用更改到 Wiki（不关闭编辑器）"
              >
                <Play size={14} />
                应用
              </button>
            )}

            {/* 保存按钮 */}
            {onSave && (
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  hasChanges
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
                title="保存并关闭编辑器"
              >
                <Save size={14} />
                保存
              </button>
            )}

            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors ml-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 布局设置工具栏 */}
        {showSettings && (
          <ToolBar
            direction={config.direction}
            nodeSpacing={config.nodeSpacing}
            rankSpacing={config.rankSpacing}
            chartType={chartType}
            onDirectionChange={setDirection}
            onNodeSpacingChange={setNodeSpacing}
            onRankSpacingChange={setRankSpacing}
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
                  enableDrag={true}
                  onDragEnd={(nodeId, pos) => {
                    console.log(`Node ${nodeId} moved to:`, pos);
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
          <span>Ctrl/Cmd + S 保存 | ESC 关闭 | 拖拽边缘调整大小</span>
          <span className="text-gray-400">双击图表节点可定位源代码</span>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default MermaidEditModal;
