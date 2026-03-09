import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { useSvgDrag } from '../../hooks/useSvgDrag';
import { ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';

interface PreviewPanelProps {
  code: string;
  enableDrag?: boolean;
  onDragEnd?: (nodeId: string, position: { x: number; y: number }) => void;
  onResetLayout?: () => void;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  code,
  enableDrag = true,
  onDragEnd,
  onResetLayout,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 设置 Mermaid 配置
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      suppressErrorRendering: true,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
      themeVariables: {
        primaryColor: '#ffffff',
        primaryTextColor: '#1d1d1f',
        primaryBorderColor: '#d1d1d6',
        lineColor: '#86868b',
        secondaryColor: '#F5F5F7',
        tertiaryColor: '#ffffff',
        nodeBorder: '#d1d1d6',
        clusterBkg: '#F9F9F9',
        clusterBorder: '#e5e5ea',
        defaultLinkColor: '#86868b',
        titleColor: '#1d1d1f',
        edgeLabelBackground: '#ffffff',
      },
      flowchart: {
        curve: 'basis',
        padding: 30,
        nodeSpacing: 50,
        rankSpacing: 60,
        htmlLabels: true,
        subGraphTitleMargin: {
          top: 10,
          bottom: 10,
        },
        titleTopMargin: 25,
      },
    });
  }, []);

  // 渲染 Mermaid 图表
  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
      if (!code.trim()) {
        setSvg('');
        setError(null);
        return;
      }

      const cleanCode = code.replace(/```mermaid/g, '').replace(/```/g, '').trim();
      const id = `mermaid-editor-${Math.random().toString(36).substr(2, 9)}`;

      try {
        const { svg: renderedSvg } = await mermaid.render(id, cleanCode);
        if (isMounted) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : '图表渲染失败');
          setSvg('');
        }
      }
    };

    // 防抖渲染
    const timer = setTimeout(renderChart, 300);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [code]);

  // 设置 SVG 内容并调整 subgraph 标题位置
  useEffect(() => {
    if (!containerRef.current || !svg) return;
    const svgContainer = containerRef.current.querySelector('.svg-container');
    if (svgContainer) {
      svgContainer.innerHTML = svg;

      // 调整 cluster (subgraph) 标题位置，避免被子节点遮挡
      const svgElement = svgContainer.querySelector('svg');
      if (svgElement) {
        // 查找所有 cluster 的标签
        const clusterLabels = svgElement.querySelectorAll('.cluster-label');
        clusterLabels.forEach((label) => {
          const transform = label.getAttribute('transform');
          if (transform) {
            // 解析 translate(x, y) 并向上移动标题
            const match = transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
            if (match) {
              const x = parseFloat(match[1]);
              const y = parseFloat(match[2]) - 15; // 向上移动 15px
              label.setAttribute('transform', `translate(${x}, ${y})`);
            }
          }

          // 增加标题的字体大小和加粗
          const textElement = label.querySelector('text');
          if (textElement) {
            (textElement as HTMLElement).style.fontWeight = '600';
          }
        });

        // 调整 cluster 背景的 padding
        const clusters = svgElement.querySelectorAll('.cluster rect');
        clusters.forEach((rect) => {
          const currentY = parseFloat(rect.getAttribute('y') || '0');
          const currentHeight = parseFloat(rect.getAttribute('height') || '0');
          // 扩展顶部空间
          rect.setAttribute('y', String(currentY - 20));
          rect.setAttribute('height', String(currentHeight + 20));
        });
      }
    }
  }, [svg]);

  // 启用拖拽
  const { resetPositions } = useSvgDrag(
    containerRef as React.RefObject<HTMLDivElement>,
    {
      enabled: enableDrag,
      onDragEnd,
    }
  );

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.1, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.1, 0.3));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // 平移控制
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只响应左键
    if ((e.target as HTMLElement).closest('g[id^="flowchart-"]')) return; // 不拦截节点拖拽

    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [pan]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;

    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;

    setPan({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    });
  }, [isPanning]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => Math.max(0.3, Math.min(3, prev + delta)));
    }
  }, []);

  // 重置布局
  const handleResetLayout = useCallback(() => {
    resetPositions();
    onResetLayout?.();
  }, [resetPositions, onResetLayout]);

  return (
    <div className="h-full w-full flex flex-col bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors"
            title="缩小"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-gray-500 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors"
            title="放大"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={handleZoomReset}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors ml-1"
            title="重置视图"
          >
            <RotateCcw size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {enableDrag && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Move size={12} />
              <span>拖拽节点可调整位置</span>
            </div>
          )}
          {enableDrag && (
            <button
              onClick={handleResetLayout}
              className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
            >
              重置节点
            </button>
          )}
        </div>
      </div>

      {/* 预览区域 */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
        onWheel={handleWheel}
      >
        {error ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-md">
              <h4 className="text-sm font-medium text-red-800 mb-2">渲染错误</h4>
              <p className="text-xs text-red-600 font-mono whitespace-pre-wrap">
                {error}
              </p>
            </div>
          </div>
        ) : svg ? (
          <div
            className="svg-container h-full w-full flex items-center justify-center p-4"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.1s ease-out',
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            输入 Mermaid 代码以预览图表
          </div>
        )}
      </div>

      {/* 提示 */}
      <div className="px-3 py-1.5 bg-gray-100 border-t border-gray-200 text-[10px] text-gray-400 text-center">
        Ctrl/Cmd + 滚轮缩放 | 拖拽空白区域平移 | 拖拽节点调整位置
      </div>
    </div>
  );
};

export default PreviewPanel;
