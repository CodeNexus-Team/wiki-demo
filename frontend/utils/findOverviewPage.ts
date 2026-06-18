/**
 * 在 wiki 页面列表中找到最适合作为入口的"总览/总揽"页面。
 *
 * 匹配优先级:
 *   1. 文件名(去扩展名)**包含**「总览」或「总揽」—— 同时匹配 `_项目总览.json` / `平台总揽.json`
 *      等带前缀或长名称的写法
 *   2. 文件名精确等于英文常见入口名: overview / index / readme
 *   3. 若多个候选,选**路径最浅**的那个(根目录优先)
 *   4. 都不命中 → 返回路径最浅的页面
 *   5. 空列表 → ''
 */
const OVERVIEW_NAME_KEYWORDS_CN = ['总览', '总揽'];
const OVERVIEW_NAME_EXACT_EN = ['overview', 'index', 'readme'];

function depth(path: string): number {
  return path.split('/').length;
}

function baseName(path: string): string {
  return path.split('/').pop()?.replace(/\.json$/, '') || '';
}

export function findOverviewPage(pages: string[]): string {
  if (pages.length === 0) return '';

  const cnMatches = pages.filter(p => {
    const name = baseName(p);
    return OVERVIEW_NAME_KEYWORDS_CN.some(kw => name.includes(kw));
  });
  if (cnMatches.length > 0) {
    return cnMatches.slice().sort((a, b) => depth(a) - depth(b))[0];
  }

  const enMatches = pages.filter(p => {
    const name = baseName(p).toLowerCase();
    return OVERVIEW_NAME_EXACT_EN.includes(name);
  });
  if (enMatches.length > 0) {
    return enMatches.slice().sort((a, b) => depth(a) - depth(b))[0];
  }

  return pages.slice().sort((a, b) => depth(a) - depth(b))[0];
}
