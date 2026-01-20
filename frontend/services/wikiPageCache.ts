/**
 * Wiki 页面缓存服务
 * 管理从 CodeNexus 后端获取的 Wiki 页面数据
 */

import { WikiPage } from '../types';

interface CachedWikiPage {
  pagePath: string;
  data: WikiPage;
  timestamp: number;
  lastAccessed: number;
}

interface CacheIndex {
  [pagePathHash: string]: {
    pagePath: string;
    timestamp: number;
    lastAccessed: number;
    size: number;
  };
}

class WikiPageCacheService {
  private cache: Map<string, CachedWikiPage>;
  private readonly CACHE_KEY = 'codewiki_wiki_cache_index';
  private readonly SESSION_KEY = 'codewiki_wiki_session_id';
  private readonly MAX_CACHE_SIZE = 1000; // 最多缓存 1000 个页面

  constructor() {
    this.cache = new Map();
    this.initializeSession();
  }

  /**
   * 初始化会话
   * 仅记录会话ID，缓存是纯内存的，页面刷新时自动清空
   */
  private initializeSession(): void {
    const existingSessionId = sessionStorage.getItem(this.SESSION_KEY);

    if (!existingSessionId) {
      // 新会话：清理可能遗留的旧 localStorage 数据（历史遗留）
      this.clearAllStoredCache();

      // 生成新的会话 ID
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      sessionStorage.setItem(this.SESSION_KEY, newSessionId);
      console.log('[WikiPageCache] 🆕 新会话开始，内存缓存已清空');
    } else {
      console.log('[WikiPageCache] ♻️ 继续现有会话:', existingSessionId);
    }
  }

  /**
   * 清除所有存储的缓存（清理历史遗留的 localStorage 数据）
   */
  private clearAllStoredCache(): void {
    try {
      const indexData = localStorage.getItem(this.CACHE_KEY);
      if (indexData) {
        const index: CacheIndex = JSON.parse(indexData);

        // 删除所有缓存文件
        Object.keys(index).forEach(hash => {
          localStorage.removeItem(`codewiki_wiki_${hash}`);
        });
        console.log('[WikiPageCache] 🧹 已清除历史遗留的 localStorage 缓存');
      }

      // 删除索引
      localStorage.removeItem(this.CACHE_KEY);
    } catch (error) {
      console.error('[WikiPageCache] 清除旧缓存失败:', error);
    }
  }


  /**
   * 生成页面路径的 hash
   */
  private hashPagePath(pagePath: string): string {
    // 简单的 hash 函数
    let hash = 0;
    for (let i = 0; i < pagePath.length; i++) {
      const char = pagePath.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 获取缓存的 Wiki 页面
   */
  get(pagePath: string): WikiPage | null {
    const hash = this.hashPagePath(pagePath);
    const cached = this.cache.get(hash);

    console.log('[WikiPageCache] 尝试获取缓存:', {
      pagePath,
      hash,
      hasCached: !!cached
    });

    if (!cached) {
      console.log('[WikiPageCache] ❌ 缓存未命中');
      return null;
    }

    // 更新最后访问时间（仅内存缓存，不持久化）
    cached.lastAccessed = Date.now();
    this.cache.set(hash, cached);

    console.log(`[WikiPageCache] ✅ 命中缓存: ${pagePath}`);
    return cached.data;
  }

  /**
   * 设置 Wiki 页面缓存（仅内存缓存）
   */
  set(pagePath: string, data: WikiPage): void {
    const hash = this.hashPagePath(pagePath);
    const now = Date.now();

    console.log('[WikiPageCache] 缓存页面到内存:', {
      pagePath,
      hash,
      currentCacheSize: this.cache.size,
      hasData: !!data
    });

    const cached: CachedWikiPage = {
      pagePath,
      data,
      timestamp: now,
      lastAccessed: now
    };

    // 检查缓存大小限制
    if (this.cache.size >= this.MAX_CACHE_SIZE && !this.cache.has(hash)) {
      this.evictLRU();
    }

    this.cache.set(hash, cached);
    console.log(`[WikiPageCache] ✅ 缓存页面成功（内存）: ${pagePath}`);
  }

  /**
   * 移除缓存
   */
  remove(pagePath: string): void {
    const hash = this.hashPagePath(pagePath);
    this.cache.delete(hash);
  }

  /**
   * LRU 淘汰策略：移除最久未访问的缓存
   */
  private evictLRU(): void {
    let oldestHash = '';
    let oldestTime = Date.now();

    this.cache.forEach((cached, hash) => {
      if (cached.lastAccessed < oldestTime) {
        oldestTime = cached.lastAccessed;
        oldestHash = hash;
      }
    });

    if (oldestHash) {
      const pagePath = this.cache.get(oldestHash)?.pagePath || '';
      console.log(`[WikiPageCache] LRU 淘汰（内存）: ${pagePath}`);
      this.cache.delete(oldestHash);
    }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    console.log('[WikiPageCache] 内存缓存已清空');
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    count: number;
    totalSize: number;
    pages: string[];
  } {
    let totalSize = 0;
    const pages: string[] = [];

    this.cache.forEach((cached) => {
      totalSize += JSON.stringify(cached.data).length;
      pages.push(cached.pagePath);
    });

    return {
      count: this.cache.size,
      totalSize,
      pages
    };
  }
}

// 导出单例
export const wikiPageCache = new WikiPageCacheService();
