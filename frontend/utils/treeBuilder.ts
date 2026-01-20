import { WikiBlock } from '../types';

/**
 * 从扁平的 WikiBlock 数组构建树形结构
 *
 * 规则：
 * 1. heading 按 level 构建层级关系 (level 1 > level 2 > level 3 等)
 * 2. 非 heading 的 block 归属于前面最近的 heading
 * 3. 如果没有 heading，作为顶层节点
 *
 * @param flatBlocks 扁平的 WikiBlock 数组
 * @returns 树形结构的 WikiBlock 数组
 *
 * @example
 * const flat = [
 *   { id: '1', type: 'heading', level: 1, content: 'Chapter 1' },
 *   { id: '2', type: 'paragraph', content: 'Introduction' },
 *   { id: '3', type: 'heading', level: 2, content: 'Section 1.1' },
 *   { id: '4', type: 'paragraph', content: 'Details' },
 * ];
 *
 * const tree = buildTree(flat);
 * // tree[0].children = [
 * //   { id: '2', ... },
 * //   { id: '3', children: [{ id: '4', ... }] }
 * // ]
 */
export function buildTree(flatBlocks: WikiBlock[]): WikiBlock[] {
  if (!flatBlocks || flatBlocks.length === 0) {
    return [];
  }

  const result: WikiBlock[] = [];
  const stack: WikiBlock[] = []; // 维护当前的 heading 栈

  for (const block of flatBlocks) {
    // 创建新块，初始化树形结构字段
    const newBlock: WikiBlock = {
      ...block,
      children: [],
      depth: 0,
      parentId: undefined,
      isCollapsed: block.isCollapsed ?? false,
    };

    if (block.type === 'heading') {
      const level = block.level || 1;

      // 弹出所有 level >= 当前 level 的 heading
      // 例如：当前是 h2，需要弹出所有 h2、h3、h4 等
      while (stack.length > 0 && (stack[stack.length - 1].level || 1) >= level) {
        stack.pop();
      }

      // 设置深度和父节点
      newBlock.depth = stack.length;
      newBlock.parentId = stack.length > 0 ? stack[stack.length - 1].id : undefined;

      // 添加到父节点或根节点
      if (stack.length === 0) {
        // 顶层节点
        result.push(newBlock);
      } else {
        // 子节点
        const parent = stack[stack.length - 1];
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(newBlock);
      }

      // 当前 heading 压入栈
      stack.push(newBlock);
    } else {
      // 非 heading block
      newBlock.depth = stack.length;
      newBlock.parentId = stack.length > 0 ? stack[stack.length - 1].id : undefined;

      if (stack.length === 0) {
        // 没有 heading，作为顶层节点
        result.push(newBlock);
      } else {
        // 归属于当前栈顶的 heading
        const parent = stack[stack.length - 1];
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(newBlock);
      }
    }
  }

  return result;
}

/**
 * 树形结构扁平化（深度优先遍历）
 *
 * 用于：
 * - API 提交时需要扁平数组
 * - 序列化存储
 * - 向后兼容
 *
 * @param treeBlocks 树形结构的 WikiBlock 数组
 * @returns 扁平的 WikiBlock 数组
 */
export function flattenTree(treeBlocks: WikiBlock[]): WikiBlock[] {
  const result: WikiBlock[] = [];

  function traverse(blocks: WikiBlock[]) {
    for (const block of blocks) {
      // 移除树形结构字段，保留原始数据
      const { children, parentId, depth, isCollapsed, ...flatBlock } = block;
      result.push(flatBlock as WikiBlock);

      // 递归处理子节点
      if (children && children.length > 0) {
        traverse(children);
      }
    }
  }

  traverse(treeBlocks);
  return result;
}

/**
 * 通过ID查找节点（深度优先搜索）
 *
 * @param blocks WikiBlock 数组（可以是树形或扁平）
 * @param id 要查找的块ID
 * @returns 找到的块，如果不存在返回 null
 */
export function findBlockById(blocks: WikiBlock[], id: string): WikiBlock | null {
  for (const block of blocks) {
    if (block.id === id) {
      return block;
    }

    if (block.children && block.children.length > 0) {
      const found = findBlockById(block.children, id);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

/**
 * 获取所有可见的节点（考虑折叠状态）
 *
 * 如果一个节点的祖先节点被折叠，该节点不可见
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 所有可见的 WikiBlock（扁平数组）
 */
export function getVisibleBlocks(blocks: WikiBlock[]): WikiBlock[] {
  const result: WikiBlock[] = [];

  function traverse(blocks: WikiBlock[], parentCollapsed = false) {
    for (const block of blocks) {
      // 如果父节点未折叠，当前节点可见
      if (!parentCollapsed) {
        result.push(block);
      }

      // 检查当前节点是否折叠
      const isCollapsed = block.isCollapsed || false;

      // 递归处理子节点
      if (block.children && block.children.length > 0) {
        // 如果父节点折叠或当前节点折叠，子节点都不可见
        traverse(block.children, parentCollapsed || isCollapsed);
      }
    }
  }

  traverse(blocks);
  return result;
}

/**
 * 检测是否为树形结构
 *
 * 通过检查是否有任何块包含 children 字段来判断
 *
 * @param blocks WikiBlock 数组
 * @returns 如果是树形结构返回 true
 */
export function isTreeStructure(blocks: WikiBlock[]): boolean {
  for (const block of blocks) {
    if (block.children && block.children.length > 0) {
      return true;
    }
    // 递归检查
    if (block.children) {
      if (isTreeStructure(block.children)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 确保数据为树形结构
 *
 * 如果已经是树形结构，直接返回
 * 如果是扁平结构，自动转换
 *
 * @param blocks WikiBlock 数组
 * @returns 树形结构的 WikiBlock 数组
 */
export function ensureTreeStructure(blocks: WikiBlock[]): WikiBlock[] {
  if (isTreeStructure(blocks)) {
    return blocks;
  }
  return buildTree(blocks);
}

/**
 * 递归克隆树形结构（深拷贝）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 克隆的树形结构
 */
export function cloneTree(blocks: WikiBlock[]): WikiBlock[] {
  return blocks.map(block => ({
    ...block,
    children: block.children ? cloneTree(block.children) : undefined
  }));
}

/**
 * 统计树的总节点数（包括所有层级）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 总节点数
 */
export function countTreeNodes(blocks: WikiBlock[]): number {
  let count = 0;

  function traverse(blocks: WikiBlock[]) {
    for (const block of blocks) {
      count++;
      if (block.children && block.children.length > 0) {
        traverse(block.children);
      }
    }
  }

  traverse(blocks);
  return count;
}

/**
 * 获取树的最大深度
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 最大深度（根节点深度为0）
 */
export function getMaxDepth(blocks: WikiBlock[]): number {
  let maxDepth = 0;

  function traverse(blocks: WikiBlock[], currentDepth: number) {
    for (const block of blocks) {
      maxDepth = Math.max(maxDepth, currentDepth);
      if (block.children && block.children.length > 0) {
        traverse(block.children, currentDepth + 1);
      }
    }
  }

  traverse(blocks, 0);
  return maxDepth;
}

/**
 * 根据ID集合收集对应的blocks（递归搜索）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param selectedIds 要收集的块ID集合
 * @returns 找到的所有块的数组
 */
export function collectBlocksByIds(blocks: WikiBlock[], selectedIds: Set<string>): WikiBlock[] {
  const result: WikiBlock[] = [];

  function traverse(blocks: WikiBlock[]) {
    for (const block of blocks) {
      if (selectedIds.has(block.id)) {
        result.push(block);
      }

      if (block.children && block.children.length > 0) {
        traverse(block.children);
      }
    }
  }

  traverse(blocks);
  return result;
}

/**
 * 递归删除所有标记为 deleted 的节点
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 过滤后的树形结构（不包含 deleted 节点）
 */
export function removeDeletedBlocks(blocks: WikiBlock[]): WikiBlock[] {
  return blocks
    .filter(block => block.status !== 'deleted')
    .map(block => ({
      ...block,
      children: block.children && block.children.length > 0
        ? removeDeletedBlocks(block.children)
        : undefined
    }));
}

/**
 * 递归清除所有节点的状态标记（status 和 originalContent）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 清除状态后的树形结构
 */
export function clearBlockStatuses(blocks: WikiBlock[]): WikiBlock[] {
  return blocks.map(block => {
    const { status, originalContent, ...rest } = block;
    return {
      ...rest,
      children: block.children && block.children.length > 0
        ? clearBlockStatuses(block.children)
        : undefined
    };
  });
}
