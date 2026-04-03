
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { Code, ExternalLink, Database } from 'lucide-react';
import { MermaidMetadata, Neo4jIdMapping } from '../types';

const MERMAID_LIGHT_THEME = {
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
};

const MERMAID_DARK_THEME = {
  primaryColor: '#21262d',
  primaryTextColor: '#e6edf3',
  primaryBorderColor: '#30363d',
  lineColor: '#7d8590',
  secondaryColor: '#161b22',
  tertiaryColor: '#21262d',
  nodeBorder: '#30363d',
  clusterBkg: '#161b22',
  clusterBorder: '#30363d',
  defaultLinkColor: '#7d8590',
  titleColor: '#e6edf3',
  edgeLabelBackground: '#0d1117',
  actorBkg: '#21262d',
  actorBorder: '#30363d',
  labelBoxBkgColor: '#21262d',
  labelBoxBorderColor: '#30363d',
  signalColor: '#7d8590',
  signalTextColor: '#e6edf3',
  loopTextColor: '#e6edf3',
  mainBkg: '#21262d',
  fontSize: '14px',
};

const MERMAID_FLOWCHART_CONFIG = {
  curve: 'basis' as const,
  padding: 30,
  nodeSpacing: 50,
  rankSpacing: 60,
  htmlLabels: true,
  subGraphTitleMargin: {
    top: 10,
    bottom: 10,
  },
  titleTopMargin: 25,
};

function initMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    suppressErrorRendering: true,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    themeVariables: isDark ? MERMAID_DARK_THEME : MERMAID_LIGHT_THEME,
    flowchart: MERMAID_FLOWCHART_CONFIG,
  });
}

// 默认初始化为亮色
initMermaid(false);

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
    // 普通节点: flowchart-NodeId-123 格式
    const idMatch = domId.match(/^flowchart-(.+?)-\d+$/);
    if (idMatch) {
      return idMatch[1];
    }

    // Subgraph/Cluster: Mermaid 直接用原始 ID 作为 g 元素的 id
    if (element.classList.contains('cluster') || element.classList.contains('node')) {
      return domId || null;
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
  neo4jIds?: Neo4jIdMapping;
  neo4jSource?: Neo4jIdMapping;
  onNodeClick?: (nodeId: string, metadata?: MermaidMetadata) => void;
  highlightedNodeId?: string | null;
  onDoubleClick?: () => void;
  status?: 'inserted' | 'deleted' | 'modified' | 'original';
  isDarkMode?: boolean;
}

const Mermaid: React.FC<MermaidProps> = ({ chart, metadata, neo4jIds, neo4jSource, onNodeClick, highlightedNodeId, onDoubleClick, status, isDarkMode = false }) => {
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

      // 切换主题时重新初始化 mermaid
      initMermaid(isDarkMode);

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
  }, [chart, isDarkMode]);

  // Add event listeners for interaction
  useEffect(() => {
    if (!containerRef.current) return;

    const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // 根据图表类型选择合适的选择器
        let selector = '.node, .cluster, .actor, .messageText, .task, .classSection, [id^="flowchart-"], g[id]';

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
                // 检查节点是否在 sourceMapping 或 neo4jIds 中
                const hasMapping = metadata?.sourceMapping?.[foundId];
                const hasNeo4jId = neo4jIds?.[foundId];

                if (hasMapping || hasNeo4jId) {
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
        let selector = '.node, .cluster, .actor, .messageText, .task, .classSection, [id^="flowchart-"], g[id]';

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
                // 检查节点是否在 sourceMapping 或 neo4jIds 中
                const hasMapping = metadata?.sourceMapping?.[foundId];
                const hasNeo4jId = neo4jIds?.[foundId];

                if (hasMapping || hasNeo4jId) {
                    // 在 mapping 或 neo4jIds 中存在的节点显示右键菜单
                    e.preventDefault();
                    setActiveNodeId(foundId);
                    setMenuPosition({ x: e.clientX, y: e.clientY });
                } else {
                    // 节点不在 mapping 和 neo4jIds 中，不显示菜单
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
  }, [svg, metadata, neo4jIds, chartType]);

  // 设置 SVG 内容并调整 subgraph 标题位置
  useEffect(() => {
    if (!containerRef.current || !svg) return;
    containerRef.current.innerHTML = svg;

    // 调整 cluster (subgraph) 标题位置，避免被子节点遮挡
    const svgElement = containerRef.current.querySelector('svg');
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
          textElement.style.fontWeight = '600';
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

      // 暗色模式：只转换白色/浅色背景和深色文字，保留其他颜色不变
      if (isDarkMode) {
        // 白色/近白色填充 → 暗灰（只处理这些）
        const whiteFills = new Set(['#ffffff', '#fff', 'white', 'rgb(255, 255, 255)',
                                     '#f9f9f9', '#f5f5f7', '#fafafa']);

        const allStyled = svgElement.querySelectorAll('[style]');
        allStyled.forEach(el => {
          const style = (el as HTMLElement).style;
          const fill = style.fill?.toLowerCase();
          if (fill && whiteFills.has(fill)) {
            style.fill = '#21262d';
          }
        });

        // 深色文字 → 浅色
        const darkTexts = new Set(['#1d1d1f', '#333', '#333333', '#000', '#000000',
                                    'rgb(0, 0, 0)', 'rgb(29, 29, 31)']);
        svgElement.querySelectorAll('text, .nodeLabel, .edgeLabel, .label').forEach(el => {
          const style = (el as HTMLElement).style;
          const color = style.fill?.toLowerCase() || style.color?.toLowerCase();
          if (color && darkTexts.has(color)) {
            style.fill = '#e6edf3';
            style.color = '#e6edf3';
          }
          if (!style.fill || style.fill === '' || style.fill === 'rgb(0, 0, 0)') {
            style.fill = '#e6edf3';
          }
        });

        // 深色描边 → 浅灰（仅白色节点的边框）
        const darkStrokes = new Set(['#333', '#333333', '#000', '#000000']);
        allStyled.forEach(el => {
          const style = (el as HTMLElement).style;
          const stroke = style.stroke?.toLowerCase();
          if (stroke && darkStrokes.has(stroke)) {
            style.stroke = '#7d8590';
          }
        });

        // subgraph 背景
        svgElement.querySelectorAll('.cluster rect').forEach(rect => {
          const style = (rect as HTMLElement).style;
          const fill = style.fill?.toLowerCase();
          if (!fill || whiteFills.has(fill)) {
            style.fill = '#161b22';
          }
          style.stroke = '#30363d';
        });

        // edgeLabel 背景
        svgElement.querySelectorAll('.edgeLabel rect, .labelBkg').forEach(el => {
          const fill = (el as HTMLElement).style.fill?.toLowerCase();
          if (!fill || whiteFills.has(fill)) {
            (el as HTMLElement).style.fill = '#0d1117';
          }
        });
      }
    }
  }, [svg, isDarkMode]);

  // 高亮节点 - SVG 渲染后通过 DOM 操作
  useEffect(() => {
    if (!containerRef.current || !svg) return;

    const container = containerRef.current;

    // 清除之前的高亮样式
    container.querySelectorAll('[data-neo4j-highlighted]').forEach(el => {
      el.removeAttribute('data-neo4j-highlighted');
      const shapes = el.querySelectorAll('rect, circle, ellipse, polygon, path');
      shapes.forEach(shape => {
        (shape as HTMLElement).style.stroke = '';
        (shape as HTMLElement).style.strokeWidth = '';
        (shape as HTMLElement).style.filter = '';
      });
    });

    if (!highlightedNodeId) return;

    // 高亮样式应用函数
    const applyHighlight = (group: Element) => {
      group.setAttribute('data-neo4j-highlighted', 'true');
      // 高亮形状 - 直接子元素
      const shapes = group.querySelectorAll(':scope > rect, :scope > circle, :scope > ellipse, :scope > polygon, :scope > path');
      shapes.forEach(shape => {
        (shape as HTMLElement).style.stroke = '#f97316';
        (shape as HTMLElement).style.strokeWidth = '3px';
        (shape as HTMLElement).style.filter = 'drop-shadow(0 0 8px rgba(249, 115, 22, 0.6))';
      });
    };

    // 查找需要高亮的元素
    const allGroups = container.querySelectorAll('g[id]');

    allGroups.forEach(group => {
      const id = group.getAttribute('id') || '';

      // 普通节点: flowchart-{highlightedNodeId}-数字
      const nodeMatch = id.match(/^flowchart-(.+?)-\d+$/);
      if (nodeMatch && nodeMatch[1] === highlightedNodeId) {
        applyHighlight(group);
        return;
      }

      // Subgraph/Cluster: 检查 .cluster 类（Mermaid 直接用原始 ID 作为 g 元素的 id）
      if (group.classList.contains('cluster') && id === highlightedNodeId) {
        applyHighlight(group);
        return;
      }

      // 空的 subgraph 可能被渲染为普通节点，直接用 id 匹配
      if (id === highlightedNodeId) {
        applyHighlight(group);
        return;
      }
    });
  }, [svg, highlightedNodeId]);

  if (error) {
    return (
      <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-red-900/20 border-red-800/50' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-red-900/40' : 'bg-red-100'}`}>
            <span className={isDarkMode ? 'text-red-400 text-lg' : 'text-red-600 text-lg'}>⚠</span>
          </div>
          <div className="flex-1">
            <h4 className={`text-sm font-semibold mb-1 ${isDarkMode ? 'text-red-400' : 'text-red-800'}`}>{error}</h4>
            {errorDetails && (
              <div className={`text-xs space-y-1 ${isDarkMode ? 'text-red-400/80' : 'text-red-600'}`}>
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

  // 根据状态获取容器样式
  const getStatusStyles = () => {
    switch (status) {
      case 'deleted':
        return 'opacity-40 border-2 border-red-400 bg-red-50';
      case 'inserted':
        return 'border-2 border-emerald-400 bg-emerald-50/50';
      case 'modified':
        return 'border-2 border-amber-400 bg-amber-50/50';
      default:
        return 'bg-transparent';
    }
  };

  return (
    <>
        <div className="relative">
          {/* 删除状态覆盖层 */}
          {status === 'deleted' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none rounded-xl overflow-hidden">
              {/* 红色半透明背景 */}
              <div className="absolute inset-0 bg-red-100/60" />
              {/* 删除标签 */}
              <div className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded shadow">
                删除
              </div>
            </div>
          )}
          <div
              ref={containerRef}
              className={`mermaid-container overflow-x-auto no-scrollbar flex justify-center py-4 rounded-xl shadow-sm cursor-default ${getStatusStyles()} ${
                isDarkMode ? 'bg-[#0d1117] border border-[#30363d]' : 'bg-white'
              }`}
              onClick={() => setMenuPosition(null)}
              onDoubleClick={onDoubleClick}
          />
        </div>

        {/* Context Menu - Rendered via Portal to avoid transform scaling */}
        {menuPosition && activeNodeId && createPortal(
            <div
                className={`fixed z-[9999] backdrop-blur-xl rounded-lg shadow-apple-hover w-48 overflow-hidden animate-in fade-in zoom-in-95 duration-100 select-none ${
                  isDarkMode
                    ? 'bg-[#161b22]/90 border border-[#30363d]'
                    : 'bg-white/80 border border-gray-100'
                }`}
                style={{ top: menuPosition.y, left: menuPosition.x }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={`px-3 py-2 border-b text-[10px] font-semibold uppercase tracking-wider ${
                  isDarkMode ? 'bg-[#21262d]/50 border-[#30363d] text-[#7d8590]' : 'bg-gray-50/50 border-gray-100 text-gray-500'
                }`}>
                    Node Actions
                </div>
                {metadata?.sourceMapping?.[activeNodeId] && (
                    <button
                        onClick={() => {
                            if (activeNodeId && onNodeClick) {
                                onNodeClick(activeNodeId, metadata);
                            }
                            setMenuPosition(null);
                        }}
                        className={`w-full text-left px-3 py-2.5 text-xs hover:bg-[#0071E3] hover:text-white transition-colors flex items-center gap-2 ${
                          isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'
                        }`}
                    >
                        <Code size={14} />
                        定位源代码位置
                    </button>
                )}
                <button className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center gap-2 opacity-50 cursor-not-allowed ${
                  isDarkMode ? 'text-[#e6edf3] hover:bg-[#30363d]' : 'text-[#1d1d1f] hover:bg-gray-100/50'
                }`}>
                    <ExternalLink size={14} />
                    查看相关文档
                </button>
                {neo4jSource?.[activeNodeId] && (
                    <div className={`px-3 py-2.5 text-xs border-t flex items-center gap-2 ${
                      isDarkMode
                        ? 'text-[#e6edf3] border-[#30363d] bg-[#58a6ff]/10'
                        : 'text-[#1d1d1f] border-gray-100 bg-blue-50/50'
                    }`}>
                        <Database size={14} className={isDarkMode ? 'text-[#58a6ff]' : 'text-blue-600'} />
                        <span className={isDarkMode ? 'text-[#7d8590]' : 'text-gray-500'}>Neo4j Source:</span>
                        <span className={`font-mono ${isDarkMode ? 'text-[#58a6ff]' : 'text-blue-600'}`}>{Array.isArray(neo4jSource[activeNodeId]) ? (neo4jSource[activeNodeId] as string[]).join(', ') : neo4jSource[activeNodeId]}</span>
                    </div>
                )}
            </div>,
            document.body
        )}
    </>
  );
};

export default Mermaid;
