import React, { useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface EditorPanelProps {
  code: string;
  onChange: (code: string) => void;
  height?: string | number;
  isDarkMode?: boolean;
}

// Mermaid 语法高亮配置
const mermaidLanguageConfig = {
  keywords: [
    'flowchart',
    'graph',
    'subgraph',
    'end',
    'direction',
    'classDef',
    'class',
    'click',
    'style',
    'linkStyle',
    'sequenceDiagram',
    'participant',
    'actor',
    'activate',
    'deactivate',
    'Note',
    'loop',
    'alt',
    'else',
    'opt',
    'par',
    'and',
    'rect',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
    'gantt',
    'pie',
    'journey',
    'gitGraph',
    'mindmap',
    'timeline',
  ],
  directions: ['LR', 'RL', 'TB', 'BT', 'TD', 'BR', 'BL'],
  shapes: ['[', ']', '(', ')', '{', '}', '((', '))', '[[', ']]', '[(', ')]', '{{', '}}'],
};

export const EditorPanel: React.FC<EditorPanelProps> = ({
  code,
  onChange,
  height = '100%',
  isDarkMode = false,
}) => {
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    // 注册 Mermaid 语言
    monaco.languages.register({ id: 'mermaid' });

    // 设置语法高亮规则
    monaco.languages.setMonarchTokensProvider('mermaid', {
      keywords: mermaidLanguageConfig.keywords,
      directions: mermaidLanguageConfig.directions,

      tokenizer: {
        root: [
          // 注释
          [/%%.*$/, 'comment'],
          // init 块
          [/%%\{[\s\S]*?\}%%/, 'annotation'],
          // 方向
          [/\b(LR|RL|TB|BT|TD|BR|BL)\b/, 'keyword.direction'],
          // 关键字
          [
            /\b(flowchart|graph|subgraph|end|direction|classDef|class|click|style|linkStyle)\b/,
            'keyword',
          ],
          [
            /\b(sequenceDiagram|participant|actor|activate|deactivate|Note|loop|alt|else|opt|par|and|rect)\b/,
            'keyword',
          ],
          [/\b(classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline)\b/, 'keyword'],
          // 箭头
          [/-->|--o|--x|<-->|===|---|\.\.\.>|~~~/, 'operator'],
          [/==>|-.->|-->>|<<-->>/, 'operator'],
          // 节点 ID
          [/[A-Za-z_][A-Za-z0-9_]*/, 'identifier'],
          // 字符串
          [/"[^"]*"/, 'string'],
          [/'[^']*'/, 'string'],
          // 括号内容
          [/\[.*?\]/, 'string.node'],
          [/\(.*?\)/, 'string.node'],
          [/\{.*?\}/, 'string.node'],
          // 数字
          [/\d+/, 'number'],
        ],
      },
    });

    // 设置语言配置
    monaco.languages.setLanguageConfiguration('mermaid', {
      comments: {
        lineComment: '%%',
      },
      brackets: [
        ['[', ']'],
        ['(', ')'],
        ['{', '}'],
        ['[[', ']]'],
        ['((', '))'],
        ['{{', '}}'],
      ],
      autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '{', close: '}' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    // 添加自动补全
    monaco.languages.registerCompletionItemProvider('mermaid', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions = [
          ...mermaidLanguageConfig.keywords.map((keyword) => ({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            range,
          })),
          ...mermaidLanguageConfig.directions.map((dir) => ({
            label: dir,
            kind: monaco.languages.CompletionItemKind.Enum,
            insertText: dir,
            range,
          })),
          {
            label: 'flowchart LR',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'flowchart LR\n    A[Start] --> B[End]',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: '创建左到右流程图',
            range,
          },
          {
            label: 'subgraph',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'subgraph ${1:title}\n    ${2:content}\nend',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: '创建子图',
            range,
          },
        ];

        return { suggestions };
      },
    });

    // 设置编辑器选项
    editor.updateOptions({
      fontSize: 14,
      lineHeight: 22,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      tabSize: 4,
      insertSpaces: true,
      automaticLayout: true,
    });
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value || '');
    },
    [onChange]
  );

  return (
    <div className="h-full w-full overflow-hidden rounded-lg border border-gray-200">
      <Editor
        height={height}
        language="mermaid"
        value={code}
        onChange={handleChange}
        onMount={handleEditorMount}
        theme={isDarkMode ? 'vs-dark' : 'light'}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 14,
          lineHeight: 22,
          padding: { top: 16, bottom: 16 },
        }}
        loading={
          <div className="flex items-center justify-center h-full text-gray-400">
            加载编辑器...
          </div>
        }
      />
    </div>
  );
};

export default EditorPanel;
