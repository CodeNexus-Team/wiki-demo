import { WikiBlock, WikiPageContent, WikiSource, MermaidMetadata, SourceLocation, Neo4jIdMapping } from '../types';

const SOURCE_FILE_EXT_RE = /\.(java|py|ts|tsx|js|jsx|go|rs|kt|xml|yml|yaml|json|sql)$/i;

/**
 * 把 neo4jSource 中的类/方法名向上索引到所在文件,并对每一组 value 去重。
 *
 * Wiki 数据里 neo4jSource 经常是一堆类名 (OmsOrderController / OmsOrderService...),
 * 用户看不到文件路径就没法右键定位源码。每个 Java 文件的 basename 与其主类同名,
 * 直接拿页面级 sources 做 basename 反查就能还原成 .java 路径,无需运行时查 neo4j。
 * 没命中的名字 (方法名 / 非 Java 标识符) 保持原样。
 */
function resolveNeo4jSourceToFiles(
  raw: Neo4jIdMapping | undefined,
  basenameToFile: Map<string, string>
): Neo4jIdMapping | undefined {
  if (!raw || Object.keys(raw).length === 0) return undefined;

  const resolveName = (name: string): string => {
    if (!name) return name;
    // 已经是路径形式就直接返回
    if (name.includes('/') && SOURCE_FILE_EXT_RE.test(name)) return name;
    // 对 "ClassName.method" 这种先取类名部分
    const classPart = name.split('.')[0];
    return basenameToFile.get(classPart) || basenameToFile.get(name) || name;
  };

  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const arr = Array.isArray(value) ? value : [value];
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
      const r = resolveName(item);
      if (!seen.has(r)) {
        seen.add(r);
        resolved.push(r);
      }
    }
    out[key] = resolved.length === 1 ? resolved[0] : resolved;
  }
  return out;
}

/**
 * 将 CodeNexus 返回的结构化 Wiki 内容转换为树形 WikiBlock 数组
 *
 * 关键优化：直接利用 API 返回的 section 嵌套结构，映射为 WikiBlock 树形结构
 */
export function parseWikiPageToBlocks(
  content: WikiPageContent[],
  sources: WikiSource[]
): WikiBlock[] {
  const blocks: WikiBlock[] = [];
  let blockIdCounter = 0;

  const generateId = () => `block-${Date.now()}-${blockIdCounter++}`;

  // 预构建 basename(去扩展名) -> 完整文件路径映射,用于 neo4jSource 向文件级上卷。
  // 一个页面内同一个类名理论上只对应一个文件,多重出现取最后一次命中(等价)。
  const basenameToFile = new Map<string, string>();
  for (const s of sources) {
    const path = s.name;
    if (!path || !path.includes('/')) continue;
    const filename = path.substring(path.lastIndexOf('/') + 1);
    const basename = filename.replace(/\.[^.]+$/, '');
    if (basename) basenameToFile.set(basename, path);
  }

  /**
   * 递归处理内容块，返回对应的 WikiBlock
   * @param item 单个内容项
   * @param depth 当前深度（0为根）
   * @param parentId 父节点ID
   */
  function processContent(item: WikiPageContent, depth: number = 0, parentId?: string): WikiBlock | null {
    switch (item.type) {
      case 'section':
        // Section 对应 heading block，并递归处理其子内容
        if (!item.title) {
          // 如果没有标题，递归处理子内容但不创建heading
          if (Array.isArray(item.content)) {
            return null; // 跳过无标题的section
          }
        }

        const heading: WikiBlock = {
          id: item.id || generateId(),
          type: 'heading',
          content: item.title || '',
          level: Math.min(depth + 1, 6), // 限制在 h1-h6
          depth: depth,
          parentId: parentId,
          children: [], // 初始化子节点数组
          isCollapsed: false, // 默认展开
          neo4jIds: item.neo4j_id && Object.keys(item.neo4j_id).length > 0 ? item.neo4j_id : undefined,
          neo4jSource: resolveNeo4jSourceToFiles(item.neo4j_source, basenameToFile)
        };

        // 递归处理子内容
        if (Array.isArray(item.content)) {
          for (const subItem of item.content) {
            const childBlock = processContent(subItem, depth + 1, heading.id);
            if (childBlock) {
              heading.children!.push(childBlock);
            }
          }
        }

        return heading;

      case 'text':
        // 文本内容
        if (item.content && typeof item.content === 'object' && 'markdown' in item.content) {
          const markdownContent = item.content.markdown;

          // 构建源码引用信息和完整源码数据
          const { sourceInfo, blockSources } = buildSourceInfo(item.source_id, sources);

          // 检查是否包含代码块
          if (markdownContent.includes('```')) {
            const codeBlockMatch = markdownContent.match(/```(\w+)?\n([\s\S]*?)```/);
            if (codeBlockMatch) {
              const language = codeBlockMatch[1] || 'text';
              const code = codeBlockMatch[2];

              return {
                id: item.id || generateId(),
                type: language === 'mermaid' ? 'mermaid' : 'code',
                content: code,
                depth: depth,
                parentId: parentId,
                sourceInfo: sourceInfo || undefined,
                sourceIds: item.source_id,
                sources: blockSources.length > 0 ? blockSources : undefined
              };
            }
          }

          // 普通段落
          return {
            id: item.id || generateId(),
            type: 'paragraph',
            content: markdownContent,
            depth: depth,
            parentId: parentId,
            sourceInfo: sourceInfo || undefined,
            sourceIds: item.source_id,
            sources: blockSources.length > 0 ? blockSources : undefined
          };
        }
        break;

      case 'chart':
        // 图表类型 - 处理 mermaid 图表和节点映射
        if (item.content && typeof item.content === 'object') {
          if ('mermaid' in item.content && typeof item.content.mermaid === 'string') {
            const mermaidCode = item.content.mermaid;

            // 处理节点映射（用于交互式节点点击）
            let metadata: MermaidMetadata | undefined;
            if ('mapping' in item.content && item.content.mapping) {
              const sourceMapping: Record<string, SourceLocation> = {};

              Object.entries(item.content.mapping as Record<string, string>).forEach(([nodeId, sourceRef]) => {
                // 使用 mapping 中的 sourceRef（source_id）查找对应的 source
                const source = sources.find(s => s.source_id === sourceRef);
                if (source) {
                  // lines 缺失/为空时保留 undefined,源码面板只跳文件不高亮。
                  const lineRange = source.lines?.[0];
                  let line: number | undefined;
                  let endLine: number | undefined;

                  if (lineRange) {
                    const rangeMatch = lineRange.match(/^(\d+)-(\d+)$/);
                    const singleMatch = lineRange.match(/^(\d+)$/);

                    if (rangeMatch) {
                      line = parseInt(rangeMatch[1], 10);
                      endLine = parseInt(rangeMatch[2], 10);
                    } else if (singleMatch) {
                      line = parseInt(singleMatch[1], 10);
                    }
                  }

                  sourceMapping[nodeId] = {
                    file: source.name,
                    line,
                    endLine
                  };
                }
              });

              if (Object.keys(sourceMapping).length > 0) {
                metadata = { sourceMapping };
              }
            }

            // 构建源码引用信息
            const { sourceInfo, blockSources } = buildSourceInfo(item.source_id, sources);

            return {
              id: item.id || generateId(),
              type: 'mermaid',
              content: mermaidCode,
              depth: depth,
              parentId: parentId,
              metadata,
              sourceInfo: sourceInfo || undefined,
              sourceIds: item.source_id,
              sources: blockSources.length > 0 ? blockSources : undefined,
              neo4jIds: item.neo4j_id && Object.keys(item.neo4j_id).length > 0 ? item.neo4j_id : undefined,
              neo4jSource: resolveNeo4jSourceToFiles(item.neo4j_source, basenameToFile)
            };
          }
        }
        break;

      case 'list':
        // 列表
        if (item.content && typeof item.content === 'object' && 'markdown' in item.content) {
          const { sourceInfo, blockSources } = buildSourceInfo(item.source_id, sources);

          return {
            id: item.id || generateId(),
            type: 'list',
            content: item.content.markdown,
            depth: depth,
            parentId: parentId,
            sourceInfo: sourceInfo || undefined,
            sourceIds: item.source_id,
            sources: blockSources.length > 0 ? blockSources : undefined
          };
        }
        break;

      case 'table':
        // 表格
        if (item.content && typeof item.content === 'object' && 'markdown' in item.content) {
          const { sourceInfo, blockSources } = buildSourceInfo(item.source_id, sources);

          return {
            id: item.id || generateId(),
            type: 'table',
            content: item.content.markdown,
            depth: depth,
            parentId: parentId,
            sourceInfo: sourceInfo || undefined,
            sourceIds: item.source_id,
            sources: blockSources.length > 0 ? blockSources : undefined
          };
        }
        break;

      default:
        // 未知类型，尝试作为段落处理
        if (item.content && typeof item.content === 'object' && 'markdown' in item.content) {
          const { sourceInfo, blockSources } = buildSourceInfo(item.source_id, sources);

          return {
            id: item.id || generateId(),
            type: 'paragraph',
            content: item.content.markdown,
            depth: depth,
            parentId: parentId,
            sourceInfo: sourceInfo || undefined,
            sourceIds: item.source_id,
            sources: blockSources.length > 0 ? blockSources : undefined
          };
        }
    }

    return null;
  }

  /**
   * 构建源码引用信息的辅助函数
   */
  function buildSourceInfo(sourceIds: string[] | undefined, sources: WikiSource[]) {
    let sourceInfo = '';
    let blockSources: WikiSource[] = [];

    if (sourceIds && sourceIds.length > 0) {
      const sourceList = sourceIds
        .map(sid => {
          const source = sources.find(s => s.source_id === sid);
          if (source) {
            blockSources.push(source);
            return `📄 ${source.name} (${source.lines.join(', ')})`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');

      if (sourceList) {
        sourceInfo = `\n\n**源码位置**:\n${sourceList}`;
      }
    }

    return { sourceInfo, blockSources };
  }

  // 处理所有顶层内容
  for (const item of content) {
    const block = processContent(item, 0);
    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

/**
 * 从多个 Wiki 页面生成组合的树形 WikiBlock 数组
 */
export async function parseMultiplePages(
  wikiPages: string[],
  fetchPageFn: (path: string) => Promise<{ content: WikiPageContent[]; source: WikiSource[] }>
): Promise<WikiBlock[]> {
  const allBlocks: WikiBlock[] = [];

  for (const pagePath of wikiPages) {
    try {
      const page = await fetchPageFn(pagePath);

      // 添加页面标题
      const pageTitle = pagePath.split('/').pop()?.replace('.json', '') || 'Page';
      allBlocks.push({
        id: `page-title-${Date.now()}`,
        type: 'heading',
        content: `📄 ${pageTitle}`,
        level: 2,
        depth: 0,
        children: [],
        isCollapsed: false
      });

      // 解析页面内容
      const pageBlocks = parseWikiPageToBlocks(page.content, page.source);

      // 将页面内容作为页面标题的子节点
      if (allBlocks.length > 0) {
        const pageTitleBlock = allBlocks[allBlocks.length - 1];
        pageTitleBlock.children = pageBlocks;
      }

      // 添加分隔符
      allBlocks.push({
        id: `separator-${Date.now()}`,
        type: 'paragraph',
        content: '\n---\n',
        depth: 0
      });
    } catch (error) {
      console.error(`解析页面失败: ${pagePath}`, error);
      allBlocks.push({
        id: `error-${Date.now()}`,
        type: 'paragraph',
        content: `⚠️ 加载页面失败: ${pagePath}`,
        depth: 0
      });
    }
  }

  return allBlocks;
}
