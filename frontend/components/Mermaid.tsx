
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { Code, ExternalLink } from 'lucide-react';
import { MermaidMetadata } from '../types';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
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
    actorBkg: '#ffffff',
    actorBorder: '#d1d1d6',
    labelBoxBkgColor: '#ffffff',
    labelBoxBorderColor: '#d1d1d6',
    signalColor: '#86868b',
    signalTextColor: '#1d1d1f',
    loopTextColor: '#1d1d1f',
    mainBkg: '#ffffff',
    fontSize: '14px',
  },
  flowchart: {
    curve: 'basis',
    padding: 20,
    nodeSpacing: 50,
    rankSpacing: 50,
    htmlLabels: true,
  }
});

/**
 * 检测 Mermaid 图表类型
 */
function detectChartType(chart: string): string {
  const trimmedChart = chart.trim().toLowerCase();

  // 按顺序检测各种图表类型
  if (trimmedChart.startsWith('graph')) return 'graph';
  if (trimmedChart.startsWith('flowchart')) return 'flowchart';
  if (trimmedChart.startsWith('sequencediagram')) return 'sequenceDiagram';
  if (trimmedChart.startsWith('classdiagram')) return 'classDiagram';
  if (trimmedChart.startsWith('statediagram')) return 'stateDiagram';
  if (trimmedChart.startsWith('erdiagram')) return 'erDiagram';
  if (trimmedChart.startsWith('gantt')) return 'gantt';
  if (trimmedChart.startsWith('pie')) return 'pie';
  if (trimmedChart.startsWith('journey')) return 'journey';
  if (trimmedChart.startsWith('gitgraph')) return 'gitGraph';
  if (trimmedChart.startsWith('mindmap')) return 'mindmap';
  if (trimmedChart.startsWith('timeline')) return 'timeline';
  if (trimmedChart.startsWith('quadrantchart')) return 'quadrantChart';
  if (trimmedChart.startsWith('requirementdiagram')) return 'requirementDiagram';
  if (trimmedChart.startsWith('c4')) return 'c4';

  return 'unknown';
}

/**
 * 根据图表类型进行预处理
 * - 对于不支持 note 的图表类型（如 graph/flowchart），移除 note 语句
 * - 对于支持 note 的图表类型（如 sequenceDiagram, classDiagram），保留 note
 */
function preprocessChart(chart: string, chartType: string): string {
  // 支持 note 语法的图表类型
  const noteSupported = ['sequenceDiagram', 'classDiagram', 'stateDiagram'];

  // 如果图表类型不支持 note，移除所有 note 语句
  if (!noteSupported.includes(chartType)) {
    // 移除 note right of / note left of / note over 等语句
    chart = chart.replace(/^\s*note\s+(right|left|over)\s+of\s+\w+:.*$/gm, '');

    // 移除多余的空行
    chart = chart.replace(/\n\s*\n\s*\n/g, '\n\n');
  }

  return chart.trim();
}

/**
 * 根据图表类型从 DOM 元素中提取节点 ID
 * @param element - DOM 元素
 * @param chartType - 图表类型
 * @returns 节点 ID 或 null
 */
function extractNodeIdByChartType(element: Element, chartType: string): string | null {
  const domId = element.id;

  // Block 图表（flowchart/graph）
  if (chartType === 'graph' || chartType === 'flowchart') {
    // flowchart-NodeId-123 格式
    const idMatch = domId.match(/^flowchart-(.+?)-\d+$/);
    if (idMatch) {
      return idMatch[1];
    }
  }

  // UML 类图（classDiagram）
  else if (chartType === 'classDiagram') {
    const classNode = element.closest('g[id^="classId-"]') as HTMLElement | null;
    if (!classNode) {
      return null;
    }

    const rawId = classNode.id;
    const match = rawId.match(/^classId-(.+?)(?:-\d+)?$/);
    if (!match) {
      return null;
    }

    return match[1];
  }



  // 时序图（sequenceDiagram）
  else if (chartType === 'sequenceDiagram') {
    // 时序图的 actor ID 格式: actor{number} 或直接的 actor 名称
    if (domId && domId.startsWith('actor')) {
      // 尝试获取 text 内容作为 ID
      const textElement = element.querySelector('text');
      if (textElement?.textContent) {
        return textElement.textContent.trim();
      }
      return domId;
    }
    // 如果不是以 actor 开头，尝试直接使用 domId
    if (domId) {
      return domId;
    }
  }

  // 控制流图（stateDiagram）
  else if (chartType === 'stateDiagram') {
    // 状态图的节点格式
    if (element.classList.contains('node') || element.classList.contains('state')) {
      // 提取 state-{name} 格式
      const stateMatch = domId.match(/^state-(.+)$/);
      if (stateMatch) {
        return stateMatch[1];
      }
      if (domId) {
        return domId;
      }
    }
  }

  // 通用解析方法 - 用于其他类型的图表
  // 尝试直接使用 domId
  if (domId) {
    return domId;
  }

  // 尝试获取文本内容作为 ID
  const textContent = element.textContent?.trim();
  if (textContent) {
    return textContent;
  }

  return null;
}

interface MermaidProps {
  chart: string;
  metadata?: MermaidMetadata;
  onNodeClick?: (nodeId: string, metadata?: MermaidMetadata) => void;
  highlightedNodeId?: string | null;
  onDoubleClick?: () => void;
}

const Mermaid: React.FC<MermaidProps> = ({ chart, metadata, onNodeClick, highlightedNodeId, onDoubleClick }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ type: string; message: string } | null>(null);
  const [chartType, setChartType] = useState<string>('unknown');
  const containerRef = useRef<HTMLDivElement>(null);

  // Context Menu State
  const [menuPosition, setMenuPosition] = useState<{x: number, y: number} | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
      if (!chart) return;
      let cleanChart = chart.replace(/```mermaid/g, '').replace(/```/g, '').trim();
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

      // 检测图表类型
      const detectedChartType = detectChartType(cleanChart);

      // 保存图表类型到状态
      if (isMounted) {
        setChartType(detectedChartType);
      }

      // 根据图表类型进行预处理
      cleanChart = preprocessChart(cleanChart, detectedChartType);

      try {
        const { svg } = await mermaid.render(id, cleanChart);
        if (isMounted) {
          setSvg(svg);
          setError(null);
          setErrorDetails(null);
        }
      } catch (err) {
        if (isMounted) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(`图表渲染失败`);
          setErrorDetails({
            type: detectedChartType,
            message: errorMessage
          });
        }
      }
    };

    renderChart();
    return () => { isMounted = false; };
  }, [chart]);

  // Add event listeners for interaction
  useEffect(() => {
    if (!containerRef.current) return;

    const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // 根据图表类型选择合适的选择器
        let selector = '.node, .actor, .messageText, .task, .classSection, [id^="flowchart-"], g[id]';

        if (chartType === 'classDiagram') {
            selector = '.classGroup, .node, g[id^="classId-"]';
        } else if (chartType === 'sequenceDiagram') {
            selector = '.actor, .messageText, g[id^="actor"]';
        } else if (chartType === 'stateDiagram') {
            selector = '.node, .state, g[id^="state-"]';
        }

        const interactiveGroup = target.closest(selector);

        if (interactiveGroup) {
            // 使用新的提取函数根据图表类型提取节点 ID
            const foundId = extractNodeIdByChartType(interactiveGroup, chartType);

            if (foundId) {
                // 检查节点是否在 sourceMapping 中
                const hasMapping = metadata?.sourceMapping?.[foundId];

                if (hasMapping) {
                    // 为可交互节点添加鼠标指针样式
                    (interactiveGroup as HTMLElement).style.cursor = 'context-menu';
                } else {
                    (interactiveGroup as HTMLElement).style.cursor = 'default';
                }
            }
        }
    };

    const handleContextMenu = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // 根据图表类型选择合适的选择器
        let selector = '.node, .actor, .messageText, .task, .classSection, [id^="flowchart-"], g[id]';

        if (chartType === 'classDiagram') {
            selector = '.classGroup, .node, g[id^="classId-"]';
        } else if (chartType === 'sequenceDiagram') {
            selector = '.actor, .messageText, g[id^="actor"]';
        } else if (chartType === 'stateDiagram') {
            selector = '.node, .state, g[id^="state-"]';
        }

        const interactiveGroup = target.closest(selector);

        if (interactiveGroup) {
            // 使用新的提取函数根据图表类型提取节点 ID
            const foundId = extractNodeIdByChartType(interactiveGroup, chartType);

            if (foundId) {
                // 检查节点是否在 sourceMapping 中
                const hasMapping = metadata?.sourceMapping?.[foundId];

                if (hasMapping) {
                    // 只有在 mapping 中存在的节点才显示右键菜单
                    e.preventDefault();
                    setActiveNodeId(foundId);
                    setMenuPosition({ x: e.clientX, y: e.clientY });
                } else {
                    // 节点不在 mapping 中，不显示菜单
                    setMenuPosition(null);
                }
            } else {
                setMenuPosition(null);
            }
        } else {
            setMenuPosition(null);
        }
    };

    const handleClick = () => {
        setMenuPosition(null);
    };

    const container = containerRef.current;
    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('click', handleClick);

    return () => {
        container.removeEventListener('mouseover', handleMouseOver);
        container.removeEventListener('contextmenu', handleContextMenu);
        window.removeEventListener('click', handleClick);
    };
  }, [svg, metadata, chartType]);

  // Inject highlight styles into SVG
  const getHighlightedSvg = () => {
    if (!svg || !highlightedNodeId) return svg;

    // Inject CSS style for highlighted nodes into SVG
    const highlightStyle = `
      <style>
        [id^="flowchart-${highlightedNodeId}-"] { filter: drop-shadow(0 0 8px rgba(249, 115, 22, 0.6)) !important; }
        [id^="flowchart-${highlightedNodeId}-"] rect,
        [id^="flowchart-${highlightedNodeId}-"] circle,
        [id^="flowchart-${highlightedNodeId}-"] ellipse,
        [id^="flowchart-${highlightedNodeId}-"] polygon,
        [id^="flowchart-${highlightedNodeId}-"] path:not([class*="edge"]) {
          stroke: #f97316 !important;
          stroke-width: 3px !important;
        }
      </style>
    `;

    // Insert style after opening <svg> tag
    return svg.replace(/<svg([^>]*)>/, `<svg$1>${highlightStyle}`);
  };

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded-xl border border-red-200">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
            <span className="text-red-600 text-lg">⚠</span>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-red-800 mb-1">{error}</h4>
            {errorDetails && (
              <div className="text-xs text-red-600 space-y-1">
                <p><strong>图表类型:</strong> {errorDetails.type}</p>
                <p className="text-red-500 font-mono text-[11px] bg-red-100/50 p-2 rounded mt-2 break-all">
                  {errorDetails.message}
                </p>
                <p className="text-red-700 mt-2">
                  💡 提示: {errorDetails.type === 'graph' || errorDetails.type === 'flowchart'
                    ? '流程图不支持 note 语法，已自动移除。如仍失败，请检查图表语法。'
                    : '请检查图表语法是否正确。'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
        <div
            ref={containerRef}
            className="mermaid-container overflow-x-auto no-scrollbar flex justify-center py-4 bg-white rounded-xl border border-[#00000008] shadow-sm cursor-default"
            dangerouslySetInnerHTML={{ __html: getHighlightedSvg() }}
            onClick={() => setMenuPosition(null)}
            onDoubleClick={onDoubleClick}
        />

        {/* Context Menu - Rendered via Portal to avoid transform scaling */}
        {menuPosition && activeNodeId && createPortal(
            <div
                className="fixed z-[9999] bg-white/80 backdrop-blur-xl rounded-lg shadow-apple-hover border border-gray-100 w-48 overflow-hidden animate-in fade-in zoom-in-95 duration-100 select-none"
                style={{ top: menuPosition.y, left: menuPosition.x }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-3 py-2 bg-gray-50/50 border-b border-gray-100 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Node Actions
                </div>
                <button
                    onClick={() => {
                        if (activeNodeId && onNodeClick) {
                            onNodeClick(activeNodeId, metadata);
                        }
                        setMenuPosition(null);
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs text-[#1d1d1f] hover:bg-[#0071E3] hover:text-white transition-colors flex items-center gap-2"
                >
                    <Code size={14} />
                    定位源代码位置
                </button>
                <button className="w-full text-left px-3 py-2.5 text-xs text-[#1d1d1f] hover:bg-gray-100/50 transition-colors flex items-center gap-2 opacity-50 cursor-not-allowed">
                    <ExternalLink size={14} />
                    查看相关文档
                </button>
            </div>,
            document.body
        )}
    </>
  );
};

export default Mermaid;
