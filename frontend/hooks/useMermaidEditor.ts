import { useState, useCallback, useMemo } from 'react';

export type FlowDirection = 'LR' | 'RL' | 'TB' | 'BT';

export interface MermaidEditorConfig {
  direction: FlowDirection;
  nodeSpacing: number;
  rankSpacing: number;
}

export interface MermaidEditorState {
  code: string;
  config: MermaidEditorConfig;
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
    // 同步更新配置
    const extracted = extractInitConfig(newCode);
    setConfig((prev) => ({
      direction: extractDirection(newCode),
      nodeSpacing: extracted.nodeSpacing ?? prev.nodeSpacing,
      rankSpacing: extracted.rankSpacing ?? prev.rankSpacing,
    }));
  }, []);

  const setDirection = useCallback((direction: FlowDirection) => {
    setConfig((prev) => ({ ...prev, direction }));
    setCodeInternal((prev) => updateCodeDirection(prev, direction));
  }, []);

  const setNodeSpacing = useCallback((spacing: number) => {
    setConfig((prev) => {
      const newConfig = { ...prev, nodeSpacing: spacing };
      setCodeInternal((prevCode) =>
        updateCodeInit(prevCode, spacing, prev.rankSpacing)
      );
      return newConfig;
    });
  }, []);

  const setRankSpacing = useCallback((spacing: number) => {
    setConfig((prev) => {
      const newConfig = { ...prev, rankSpacing: spacing };
      setCodeInternal((prevCode) =>
        updateCodeInit(prevCode, prev.nodeSpacing, spacing)
      );
      return newConfig;
    });
  }, []);

  // 处理后的代码（确保有正确的方向和配置）
  const processedCode = useMemo(() => {
    let result = code;

    // 仅对 flowchart/graph 类型补充方向声明，不影响其他图表类型
    const isFlowchart = /^(flowchart|graph)\b/m.test(result);
    if (isFlowchart && !/^(flowchart|graph)\s+(LR|RL|TB|BT|TD)/m.test(result)) {
      result = result.replace(/^(flowchart|graph)\b/m, `$1 ${config.direction}`);
    }

    return result;
  }, [code, config.direction]);

  return {
    code,
    config,
    setCode,
    setDirection,
    setNodeSpacing,
    setRankSpacing,
    processedCode,
  };
}

export default useMermaidEditor;
