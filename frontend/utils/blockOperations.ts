import { WikiBlock, BlockType } from '../types';

/**
 * 在树形结构中插入block
 *
 * 插入规则：
 * - 如果 target 是 heading：新块作为第一个子节点插入
 * - 如果 target 是非 heading：新块作为下一个兄弟节点插入
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param targetId 目标块的ID
 * @param newBlock 要插入的新块
 * @returns 更新后的树形结构
 */
export function insertBlockAfter(
  blocks: WikiBlock[],
  targetId: string,
  newBlock: WikiBlock
): WikiBlock[] {
  return insertInBlocks(blocks, targetId, newBlock);
}

function insertInBlocks(
  blocks: WikiBlock[],
  targetId: string,
  newBlock: WikiBlock
): WikiBlock[] {
  const result: WikiBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // 找到目标节点
    if (block.id === targetId) {
      result.push(block);

      // 如果是 heading，插入为第一个子节点
      if (block.type === 'heading') {
        const updatedBlock = {
          ...block,
          children: [
            newBlock,
            ...(block.children || [])
          ]
        };
        result[result.length - 1] = updatedBlock;
      } else {
        // 非 heading，插入为兄弟节点（在当前节点后）
        result.push(newBlock);
      }
    } else {
      // 递归处理子节点
      if (block.children && block.children.length > 0) {
        const updatedChildren = insertInBlocks(block.children, targetId, newBlock);
        if (updatedChildren !== block.children) {
          result.push({ ...block, children: updatedChildren });
        } else {
          result.push(block);
        }
      } else {
        result.push(block);
      }
    }
  }

  return result;
}

/**
 * 删除树形结构中的块
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param targetId 要删除的块ID
 * @returns 更新后的树形结构
 */
export function deleteBlock(blocks: WikiBlock[], targetId: string): WikiBlock[] {
  return blocks
    .filter(block => block.id !== targetId)
    .map(block => {
      if (block.children && block.children.length > 0) {
        return {
          ...block,
          children: deleteBlock(block.children, targetId)
        };
      }
      return block;
    });
}

/**
 * 更新树形结构中块的内容
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param targetId 要更新的块ID
 * @param newContent 新内容
 * @returns 更新后的树形结构
 */
export function updateBlockContent(
  blocks: WikiBlock[],
  targetId: string,
  newContent: string
): WikiBlock[] {
  return blocks.map(block => {
    if (block.id === targetId) {
      return {
        ...block,
        content: newContent,
        originalContent: block.originalContent || block.content,
        status: 'modified' as const
      };
    }

    if (block.children && block.children.length > 0) {
      return {
        ...block,
        children: updateBlockContent(block.children, targetId, newContent)
      };
    }

    return block;
  });
}

/**
 * 更新块的折叠状态
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param targetId 要切换的块ID
 * @returns 更新后的树形结构
 */
export function toggleBlockCollapse(
  blocks: WikiBlock[],
  targetId: string
): WikiBlock[] {
  return blocks.map(block => {
    if (block.id === targetId) {
      return {
        ...block,
        isCollapsed: !block.isCollapsed
      };
    }

    if (block.children && block.children.length > 0) {
      return {
        ...block,
        children: toggleBlockCollapse(block.children, targetId)
      };
    }

    return block;
  });
}

/**
 * 标记块为删除状态（用于 Diff 系统）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param targetId 要标记的块ID
 * @returns 更新后的树形结构
 */
export function markBlockAsDeleted(
  blocks: WikiBlock[],
  targetId: string
): WikiBlock[] {
  return blocks.map(block => {
    if (block.id === targetId) {
      return {
        ...block,
        status: 'deleted' as const
      };
    }

    if (block.children && block.children.length > 0) {
      return {
        ...block,
        children: markBlockAsDeleted(block.children, targetId)
      };
    }

    return block;
  });
}

/**
 * 移除所有已删除的块
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 清理后的树形结构
 */
export function removeDeletedBlocks(blocks: WikiBlock[]): WikiBlock[] {
  return blocks
    .filter(block => block.status !== 'deleted')
    .map(block => {
      if (block.children && block.children.length > 0) {
        return {
          ...block,
          children: removeDeletedBlocks(block.children)
        };
      }
      return block;
    });
}

/**
 * 清除所有块的状态标记（恢复为 original）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 更新后的树形结构
 */
export function clearBlockStatuses(blocks: WikiBlock[]): WikiBlock[] {
  return blocks.map(block => {
    const { status, originalContent, ...cleanBlock } = block;
    return {
      ...cleanBlock,
      status: undefined,
      originalContent: undefined,
      children: block.children ? clearBlockStatuses(block.children) : undefined
    } as WikiBlock;
  });
}

/**
 * 获取块的所有祖先ID
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param targetId 目标块ID
 * @returns 祖先ID数组（从根到父，不包括自身）
 */
export function getAncestorIds(blocks: WikiBlock[], targetId: string): string[] {
  const ancestors: string[] = [];

  function traverse(blocks: WikiBlock[], path: string[]): boolean {
    for (const block of blocks) {
      if (block.id === targetId) {
        ancestors.push(...path);
        return true;
      }

      if (block.children && block.children.length > 0) {
        if (traverse(block.children, [...path, block.id])) {
          return true;
        }
      }
    }
    return false;
  }

  traverse(blocks, []);
  return ancestors;
}

/**
 * 展开到指定块（确保该块可见）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param targetId 目标块ID
 * @returns 更新后的树形结构（所有祖先节点展开）
 */
export function expandToBlock(blocks: WikiBlock[], targetId: string): WikiBlock[] {
  const ancestorIds = getAncestorIds(blocks, targetId);

  function updateCollapse(blocks: WikiBlock[]): WikiBlock[] {
    return blocks.map(block => {
      // 如果是祖先节点，确保展开
      if (ancestorIds.includes(block.id)) {
        return {
          ...block,
          isCollapsed: false,
          children: block.children ? updateCollapse(block.children) : undefined
        };
      }

      // 递归处理子节点
      if (block.children && block.children.length > 0) {
        return {
          ...block,
          children: updateCollapse(block.children)
        };
      }

      return block;
    });
  }

  return updateCollapse(blocks);
}

/**
 * 折叠所有节点
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 更新后的树形结构
 */
export function collapseAll(blocks: WikiBlock[]): WikiBlock[] {
  return blocks.map(block => ({
    ...block,
    isCollapsed: block.type === 'heading' && block.children && block.children.length > 0,
    children: block.children ? collapseAll(block.children) : undefined
  }));
}

/**
 * 展开所有节点
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @returns 更新后的树形结构
 */
export function expandAll(blocks: WikiBlock[]): WikiBlock[] {
  return blocks.map(block => ({
    ...block,
    isCollapsed: false,
    children: block.children ? expandAll(block.children) : undefined
  }));
}

/**
 * 收集所有选中的块ID（包括子节点）
 *
 * @param blocks 树形结构的 WikiBlock 数组
 * @param selectedIds 已选中的块ID集合
 * @returns 包括子节点在内的所有选中块ID
 */
export function collectSelectedBlocksWithChildren(
  blocks: WikiBlock[],
  selectedIds: Set<string>
): string[] {
  const result: string[] = [];

  function traverse(blocks: WikiBlock[]) {
    for (const block of blocks) {
      if (selectedIds.has(block.id)) {
        result.push(block.id);
        // 同时收集所有子节点
        if (block.children && block.children.length > 0) {
          collectAllIds(block.children);
        }
      } else if (block.children && block.children.length > 0) {
        traverse(block.children);
      }
    }
  }

  function collectAllIds(blocks: WikiBlock[]) {
    for (const block of blocks) {
      result.push(block.id);
      if (block.children && block.children.length > 0) {
        collectAllIds(block.children);
      }
    }
  }

  traverse(blocks);
  return result;
}
