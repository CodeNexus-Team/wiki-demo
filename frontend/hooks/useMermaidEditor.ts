import { useState, useCallback, useMemo } from 'react';

export type FlowDirection = 'LR' | 'RL' | 'TB' | 'BT';

export interface MermaidEditorConfig {
  direction: FlowDirection;
  nodeSpacing: number;
  rankSpacing: number;
}

// 支持方向控制的图表类型
const DIRECTION_TYPES = new Set(['flowchart', 'graph']);
// 支持间距控制的图表类型（flowchart init 配置）
const SPACING_TYPES = new Set(['flowchart', 'graph']);

export function detectChartTypeFromCode(code: string): string {
  const trimmed = code.trim().toLowerCase();
  if (trimmed.startsWith('graph')) return 'graph';
  if (trimmed.startsWith('flowchart')) return 'flowchart';
  if (trimmed.startsWith('sequencediagram')) return 'sequenceDiagram';
  if (trimmed.startsWith('classdiagram')) return 'classDiagram';
  if (trimmed.startsWith('statediagram')) return 'stateDiagram';
  if (trimmed.startsWith('erdiagram')) return 'erDiagram';
  if (trimmed.startsWith('gantt')) return 'gantt';
  if (trimmed.startsWith('pie')) return 'pie';
  if (trimmed.startsWith('journey')) return 'journey';
  if (trimmed.startsWith('gitgraph')) return 'gitGraph';
  if (trimmed.startsWith('mindmap')) return 'mindmap';
  if (trimmed.startsWith('timeline')) return 'timeline';
  return 'unknown';
}

export function supportsDirection(chartType: string): boolean {
  return DIRECTION_TYPES.has(chartType);
}

export function supportsSpacing(chartType: string): boolean {
  return SPACING_TYPES.has(chartType);
}

export interface MermaidEditorState {
  code: string;
  config: MermaidEditorConfig;
  chartType: string;
  setCode: (code: string) => void;
  setDirection: (direction: FlowDirection) => void;
  setNodeSpacing: (spacing: number) => void;
  setRankSpacing: (spacing: number) => void;
  processedCode: string;
}

const DEFAULT_CONFIG: MermaidEditorConfig = {
  direction: 'LR',
  nodeSpacing: 50,
  rankSpacing: 50,
};

/**
 * 从 Mermaid 代码中提取方向
 */
function extractDirection(code: string): FlowDirection {
  const match = code.match(/^(flowchart|graph)\s+(LR|RL|TB|BT)/m);
  return (match?.[2] as FlowDirection) || 'LR';
}

/**
 * 从 Mermaid 代码中提取 init 配置
 */
function extractInitConfig(code: string): Partial<MermaidEditorConfig> {
  const initMatch = code.match(/%%\{init:\s*(\{[\s\S]*?\})\s*\}%%/);
  if (!initMatch) return {};

  try {
    const initObj = JSON.parse(initMatch[1]);
    return {
      nodeSpacing: initObj.flowchart?.nodeSpacing,
      rankSpacing: initObj.flowchart?.rankSpacing,
    };
  } catch {
    return {};
  }
}

/**
 * 更新代码中的方向
 */
function updateCodeDirection(code: string, direction: FlowDirection): string {
  // 检查是否已有 flowchart/graph 声明（支持 LR, RL, TB, BT, TD 方向）
  if (/^(flowchart|graph)\s+(LR|RL|TB|BT|TD)/m.test(code)) {
    return code.replace(/^(flowchart|graph)\s+(LR|RL|TB|BT|TD)/m, `$1 ${direction}`);
  }
  // 如果没有，在开头添加
  return `flowchart ${direction}\n${code}`;
}

/**
 * 更新代码中的 init 配置
 */
function updateCodeInit(
  code: string,
  nodeSpacing: number,
  rankSpacing: number
): string {
  const initBlock = `%%{init: {"flowchart": {"nodeSpacing": ${nodeSpacing}, "rankSpacing": ${rankSpacing}}}}%%`;

  // 检查是否已有 init 块
  if (/%%\{init:[\s\S]*?\}%%/.test(code)) {
    return code.replace(/%%\{init:[\s\S]*?\}%%/, initBlock);
  }

  // 在第一行之前添加 init 块
  return `${initBlock}\n${code}`;
}

/**
 * Mermaid 编辑器状态管理 Hook
 */
export function useMermaidEditor(initialCode: string = ''): MermaidEditorState {
  const [code, setCodeInternal] = useState(initialCode);
  const [chartType, setChartType] = useState(() => detectChartTypeFromCode(initialCode));
  const [config, setConfig] = useState<MermaidEditorConfig>(() => {
    const extracted = extractInitConfig(initialCode);
    return {
      direction: extractDirection(initialCode),
      nodeSpacing: extracted.nodeSpacing ?? DEFAULT_CONFIG.nodeSpacing,
      rankSpacing: extracted.rankSpacing ?? DEFAULT_CONFIG.rankSpacing,
    };
  });

  const setCode = useCallback((newCode: string) => {
    setCodeInternal(newCode);
    const type = detectChartTypeFromCode(newCode);
    setChartType(type);
    // 仅对支持的类型同步配置
    if (supportsDirection(type)) {
      const extracted = extractInitConfig(newCode);
      setConfig((prev) => ({
        direction: extractDirection(newCode),
        nodeSpacing: extracted.nodeSpacing ?? prev.nodeSpacing,
        rankSpacing: extracted.rankSpacing ?? prev.rankSpacing,
      }));
    }
  }, []);

  const setDirection = useCallback((direction: FlowDirection) => {
    if (!supportsDirection(chartType)) return;
    setConfig((prev) => ({ ...prev, direction }));
    setCodeInternal((prev) => updateCodeDirection(prev, direction));
  }, [chartType]);

  const setNodeSpacing = useCallback((spacing: number) => {
    if (!supportsSpacing(chartType)) return;
    setConfig((prev) => {
      const newConfig = { ...prev, nodeSpacing: spacing };
      setCodeInternal((prevCode) =>
        updateCodeInit(prevCode, spacing, prev.rankSpacing)
      );
      return newConfig;
    });
  }, [chartType]);

  const setRankSpacing = useCallback((spacing: number) => {
    if (!supportsSpacing(chartType)) return;
    setConfig((prev) => {
      const newConfig = { ...prev, rankSpacing: spacing };
      setCodeInternal((prevCode) =>
        updateCodeInit(prevCode, prev.nodeSpacing, spacing)
      );
      return newConfig;
    });
  }, [chartType]);

  // 处理后的代码（仅对 flowchart/graph 补充方向声明）
  const processedCode = useMemo(() => {
    let result = code;
    if (supportsDirection(chartType) && !/^(flowchart|graph)\s+(LR|RL|TB|BT|TD)/m.test(result)) {
      result = result.replace(/^(flowchart|graph)\b/m, `$1 ${config.direction}`);
    }
    return result;
  }, [code, config.direction, chartType]);

  return {
    code,
    config,
    chartType,
    setCode,
    setDirection,
    setNodeSpacing,
    setRankSpacing,
    processedCode,
  };
}

export default useMermaidEditor;
