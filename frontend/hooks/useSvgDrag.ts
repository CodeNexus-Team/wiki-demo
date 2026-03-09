import { useEffect, useRef, useCallback } from 'react';
import { drag } from 'd3-drag';
import { select, Selection } from 'd3-selection';

export interface DragPosition {
  x: number;
  y: number;
}

export interface NodeDragInfo {
  nodeId: string;
  initialPosition: DragPosition;
  currentPosition: DragPosition;
}

export interface UseSvgDragOptions {
  /** 是否启用拖拽 */
  enabled?: boolean;
  /** 节点选择器 */
  nodeSelector?: string;
  /** 拖拽开始回调 */
  onDragStart?: (nodeId: string, position: DragPosition) => void;
  /** 拖拽中回调 */
  onDrag?: (nodeId: string, position: DragPosition) => void;
  /** 拖拽结束回调 */
  onDragEnd?: (nodeId: string, position: DragPosition) => void;
}

interface DragState {
  nodeId: string;
  startX: number;
  startY: number;
  initialTransform: { x: number; y: number };
}

/**
 * 从 transform 属性中提取 translate 值
 */
function parseTransform(transform: string | null): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 };

  const translateMatch = transform.match(/translate\(([^,]+),?\s*([^)]*)\)/);
  if (translateMatch) {
    return {
      x: parseFloat(translateMatch[1]) || 0,
      y: parseFloat(translateMatch[2]) || 0,
    };
  }

  return { x: 0, y: 0 };
}

/**
 * 从 Mermaid 节点 ID 中提取用户定义的节点 ID
 * 例如: "flowchart-A-123" -> "A"
 */
function extractNodeId(domId: string): string {
  const match = domId.match(/^flowchart-(.+?)-\d+$/);
  return match ? match[1] : domId;
}

/**
 * SVG 节点拖拽 Hook
 * 使用 D3.js 实现 Mermaid 图表节点的拖拽功能
 */
export function useSvgDrag(
  containerRef: React.RefObject<HTMLDivElement>,
  options: UseSvgDragOptions = {}
) {
  const {
    enabled = true,
    nodeSelector = 'g[id^="flowchart-"]',
    onDragStart,
    onDrag,
    onDragEnd,
  } = options;

  const dragStateRef = useRef<DragState | null>(null);
  const nodePositionsRef = useRef<Map<string, DragPosition>>(new Map());

  const setupDrag = useCallback(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    // 选择所有可拖拽节点
    const nodes = select(svg).selectAll(nodeSelector) as Selection<
      SVGGElement,
      unknown,
      SVGSVGElement,
      unknown
    >;

    // 创建拖拽行为
    const dragBehavior = drag<SVGGElement, unknown>()
      .on('start', function (event) {
        const element = this as SVGGElement;
        const domId = element.id;
        const nodeId = extractNodeId(domId);

        // 获取当前 transform
        const currentTransform = parseTransform(element.getAttribute('transform'));

        // 保存拖拽状态
        dragStateRef.current = {
          nodeId,
          startX: event.x,
          startY: event.y,
          initialTransform: currentTransform,
        };

        // 添加拖拽中样式
        select(element).classed('dragging', true);
        element.style.cursor = 'grabbing';

        onDragStart?.(nodeId, currentTransform);
      })
      .on('drag', function (event) {
        const element = this as SVGGElement;
        const state = dragStateRef.current;
        if (!state) return;

        // 计算位移
        const dx = event.x - state.startX;
        const dy = event.y - state.startY;

        // 新位置
        const newX = state.initialTransform.x + dx;
        const newY = state.initialTransform.y + dy;

        // 应用新的 transform
        element.setAttribute('transform', `translate(${newX}, ${newY})`);

        // 更新位置记录
        nodePositionsRef.current.set(state.nodeId, { x: newX, y: newY });

        onDrag?.(state.nodeId, { x: newX, y: newY });
      })
      .on('end', function (event) {
        const element = this as SVGGElement;
        const state = dragStateRef.current;
        if (!state) return;

        // 移除拖拽样式
        select(element).classed('dragging', false);
        element.style.cursor = 'grab';

        // 计算最终位置
        const dx = event.x - state.startX;
        const dy = event.y - state.startY;
        const finalPosition = {
          x: state.initialTransform.x + dx,
          y: state.initialTransform.y + dy,
        };

        onDragEnd?.(state.nodeId, finalPosition);

        dragStateRef.current = null;
      });

    // 应用拖拽行为
    nodes.call(dragBehavior);

    // 设置鼠标样式
    nodes.style('cursor', 'grab');

    // 返回清理函数
    return () => {
      nodes.on('.drag', null);
      nodes.style('cursor', null);
    };
  }, [containerRef, enabled, nodeSelector, onDragStart, onDrag, onDragEnd]);

  // 获取所有节点位置
  const getNodePositions = useCallback(() => {
    return new Map(nodePositionsRef.current);
  }, []);

  // 重置所有节点位置
  const resetPositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    const nodes = svg.querySelectorAll(nodeSelector);
    nodes.forEach((node) => {
      (node as SVGGElement).setAttribute('transform', '');
    });

    nodePositionsRef.current.clear();
  }, [containerRef, nodeSelector]);

  // 监听 SVG 变化并重新绑定拖拽
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 初始设置
    const cleanup = setupDrag();

    // 监听 DOM 变化（Mermaid 重新渲染时）
    const observer = new MutationObserver(() => {
      cleanup?.();
      setupDrag();
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      cleanup?.();
      observer.disconnect();
    };
  }, [setupDrag]);

  return {
    getNodePositions,
    resetPositions,
  };
}

export default useSvgDrag;
