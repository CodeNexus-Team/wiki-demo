// Wiki 主题配置
export interface WikiTheme {
  id: string;
  name: string;
  description: string;
  isDark?: boolean;  // 是否为暗色主题

  // 标题样式
  heading: {
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    h5: string;
    h6: string;
  };

  // 标题容器装饰
  headingContainer: {
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    h5: string;
    h6: string;
  };

  // H3 装饰点
  h3Dot: string | null;

  // 段落样式
  paragraph: string;
  paragraphInner: string;

  // 列表样式
  list: string;
  ul: string;
  ol: string;
  li: string;

  // 代码块样式
  codeBlock: string;
  codeHeader: string;
  codeHeaderDots: boolean;
  inlineCode: string;

  // 表格样式
  table: string;
  thead: string;
  tbody: string;
  tr: string;
  th: string;
  td: string;

  // 链接样式
  link: string;

  // 分割线
  hr: string;
  hrDot: boolean;

  // 图表容器
  mermaid: string;

  // 强调样式
  strong: string;
  em: string;

  // 导航栏样式
  navigator: {
    activeItem: string;       // 选中项背景和文字
    activeIcon: string;       // 选中项图标颜色
    inactiveIcon: string;     // 未选中项图标颜色
    hoverBg: string;          // 悬停背景
    tabActive: string;        // Tab 激活状态
    tabInactive: string;      // Tab 未激活状态
    border: string;           // 边框颜色
  };


  // Neo4j ID 卡片样式
  neo4jCard: {
    container: string;        // 容器样式
    label: string;            // Neo4j 标签样式
    labelIcon: string;        // 图标颜色
    idTag: string;            // ID 标签样式
    idTagActive: string;      // ID 标签激活样式
    activeNodeText: string;   // 激活状态节点文字样式
    activeIdText: string;     // 激活状态 ID 文字样式
  };
}

// Apple 风格 (iOS/macOS 26 - Liquid Glass 液态玻璃)
export const appleTheme: WikiTheme = {
  id: 'apple',
  name: 'Apple',
  description: 'Liquid Glass 液态玻璃',

  heading: {
    h1: "text-[34px] font-semibold text-[#1d1d1f] tracking-[-0.022em] leading-[1.15]",
    h2: "text-[28px] font-semibold text-[#1d1d1f] tracking-[-0.018em] leading-[1.2]",
    h3: "text-[22px] font-semibold text-[#1d1d1f] tracking-[-0.012em] leading-[1.25]",
    h4: "text-[18px] font-semibold text-[#1d1d1f] tracking-[-0.008em]",
    h5: "text-[16px] font-semibold text-[#1d1d1f]",
    h6: "text-[13px] font-semibold text-[#86868b] uppercase tracking-[0.02em]"
  },

  headingContainer: {
    h1: "mt-10 mb-4",
    h2: "mt-8 mb-3",
    h3: "mt-6 mb-2",
    h4: "mt-5 mb-2",
    h5: "mt-4 mb-1.5",
    h6: "mt-3 mb-1"
  },

  h3Dot: null,

  paragraph: "my-3 text-[17px] leading-[1.7] text-[#1d1d1f] tracking-[-0.01em]",
  paragraphInner: "mb-3 last:mb-0",

  list: "my-3 text-[17px] leading-[1.65] text-[#1d1d1f]",
  ul: "list-disc pl-5 space-y-2.5 marker:text-[#86868b]/70",
  ol: "list-decimal pl-6 space-y-2.5 marker:text-[#86868b]/70 marker:font-medium",
  li: "pl-1.5",

  codeBlock: "my-5 rounded-[28px] overflow-hidden bg-[#1d1d1f]/90 backdrop-blur-3xl shadow-[0_8px_32px_rgba(0,0,0,0.15),0_0_0_1px_rgba(255,255,255,0.1),inset_0_1px_1px_rgba(255,255,255,0.1),inset_0_-1px_1px_rgba(0,0,0,0.2)] border border-white/10",
  codeHeader: "flex items-center justify-between px-5 py-3 bg-gradient-to-b from-white/10 to-white/[0.02] border-b border-white/[0.08]",
  codeHeaderDots: true,
  inlineCode: "bg-white/50 backdrop-blur-md text-[#1d1d1f] px-2 py-0.5 rounded-lg text-[0.9em] font-mono border border-white/60 shadow-[0_1px_3px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.8)]",

  table: "my-6 w-full overflow-hidden rounded-[28px] bg-white/40 backdrop-blur-3xl shadow-[0_8px_32px_rgba(0,0,0,0.08),0_0_0_1px_rgba(255,255,255,0.5),inset_0_2px_4px_rgba(255,255,255,0.9),inset_0_-1px_2px_rgba(0,0,0,0.03)] border border-white/70",
  thead: "bg-gradient-to-b from-white/60 to-white/30 backdrop-blur-md",
  tbody: "divide-y divide-white/40",
  tr: "transition-all duration-200 hover:bg-white/50",
  th: "px-5 py-4 text-left text-[13px] font-semibold text-[#86868b] tracking-[0.01em]",
  td: "px-5 py-4 text-[15px] text-[#1d1d1f] leading-relaxed align-top",

  link: "text-[#0071E3] hover:text-[#0077ED] transition-colors duration-200",

  hr: "my-10 h-px border-0 bg-gradient-to-r from-transparent via-[#d2d2d7]/60 to-transparent",
  hrDot: false,

  mermaid: "my-5 p-8 rounded-[28px] bg-white/40 backdrop-blur-3xl shadow-[0_8px_40px_rgba(0,0,0,0.1),0_0_0_1px_rgba(255,255,255,0.6),inset_0_2px_4px_rgba(255,255,255,1),inset_0_-2px_4px_rgba(0,0,0,0.02)] border border-white/80",

  strong: "font-semibold text-[#1d1d1f]",
  em: "italic text-[#424245]",


  navigator: {
    activeItem: "bg-[#0071E3] text-white shadow-sm",
    activeIcon: "text-white",
    inactiveIcon: "text-[#0071E3]",
    hoverBg: "hover:bg-white/50",
    tabActive: "bg-white/80 text-[#1d1d1f] shadow-sm backdrop-blur-sm",
    tabInactive: "text-[#86868b] hover:text-[#1d1d1f]",
    border: "border-white/40"
  },

  neo4jCard: {
    container: "mt-3 px-3 py-2 bg-gradient-to-br from-violet-50/80 to-indigo-50/60 backdrop-blur-sm rounded-xl border border-violet-100/60 shadow-sm flex flex-wrap items-center gap-1.5",
    label: "flex items-center gap-1 text-xs font-medium text-violet-600 mr-1",
    labelIcon: "text-violet-500",
    idTag: "px-2 py-1 bg-white/60 backdrop-blur-sm text-[#86868b] rounded-lg text-xs font-mono border border-white/50 hover:bg-white/80 transition-colors cursor-default",
    idTagActive: "ring-2 ring-orange-400 ring-offset-1 bg-orange-50/80 border-orange-200",
    activeNodeText: "text-orange-600 font-semibold",
    activeIdText: "text-orange-600"
  }
};

// GitHub 风格
export const githubTheme: WikiTheme = {
  id: 'github',
  name: 'GitHub',
  description: '经典 Markdown 风格',

  heading: {
    h1: "text-[32px] font-semibold text-[#1f2328] leading-tight pb-2 border-b border-[#d1d9e0]",
    h2: "text-[24px] font-semibold text-[#1f2328] leading-tight pb-2 border-b border-[#d1d9e0]",
    h3: "text-[20px] font-semibold text-[#1f2328] leading-tight",
    h4: "text-[16px] font-semibold text-[#1f2328]",
    h5: "text-[14px] font-semibold text-[#1f2328]",
    h6: "text-[13px] font-semibold text-[#656d76]"
  },

  headingContainer: {
    h1: "mt-6 mb-4",
    h2: "mt-6 mb-4",
    h3: "mt-6 mb-4",
    h4: "mt-6 mb-4",
    h5: "mt-6 mb-4",
    h6: "mt-6 mb-4"
  },

  h3Dot: null,

  paragraph: "my-4 text-[16px] leading-[1.6] text-[#1f2328]",
  paragraphInner: "mb-4 last:mb-0",

  list: "my-4 text-[16px] leading-[1.6] text-[#1f2328]",
  ul: "list-disc pl-8 space-y-1",
  ol: "list-decimal pl-8 space-y-1",
  li: "pl-1",

  codeBlock: "my-4 rounded-md overflow-hidden border border-[#d1d9e0] bg-[#f6f8fa]",
  codeHeader: "flex items-center justify-between px-4 py-2 bg-[#f6f8fa] border-b border-[#d1d9e0] text-xs text-[#656d76]",
  codeHeaderDots: false,
  inlineCode: "bg-[#eff1f3] text-[#1f2328] px-1.5 py-0.5 rounded-md text-[85%] font-mono",

  table: "my-4 w-full border-collapse border border-[#d1d9e0]",
  thead: "bg-[#f6f8fa]",
  tbody: "bg-white",
  tr: "border-b border-[#d1d9e0]",
  th: "px-4 py-3 text-left text-sm font-semibold text-[#1f2328] border border-[#d1d9e0]",
  td: "px-4 py-3 text-sm text-[#1f2328] border border-[#d1d9e0]",

  link: "text-[#0969da] hover:underline",

  hr: "my-6 border-t border-[#d1d9e0]",
  hrDot: false,

  mermaid: "my-4 p-4 bg-white border border-[#d1d9e0] rounded-md",

  strong: "font-semibold",
  em: "italic",


  navigator: {
    activeItem: "bg-[#2C974B] text-white",
    activeIcon: "text-white",
    inactiveIcon: "text-[#2C974B]",
    hoverBg: "hover:bg-[#f6f8fa]",
    tabActive: "bg-[#2C974B] text-white shadow-sm",
    tabInactive: "text-[#656d76] hover:text-[#1f2328]",
    border: "border-[#d1d9e0]"
  },

  neo4jCard: {
    container: "mt-3 px-3 py-2 bg-[#dafbe1] rounded-md border border-[#2EA44F66] flex flex-wrap items-center gap-1.5",
    label: "flex items-center gap-1 text-xs font-medium text-[#2EA44F] mr-1",
    labelIcon: "text-[#2EA44F]",
    idTag: "px-2 py-1 bg-white text-[#2EA44F] rounded-md text-xs font-mono border border-[#2EA44F66] hover:bg-[#f6f8fa] hover:border-[#2EA44F] transition-colors cursor-default",
    idTagActive: "ring-2 ring-[#2EA44F] ring-offset-1 bg-white border-[#2EA44F]",
    activeNodeText: "text-[#2EA44F] font-semibold",
    activeIdText: "text-[#2EA44F]"
  }
};

// Notion 风格
export const notionTheme: WikiTheme = {
  id: 'notion',
  name: 'Notion',
  description: '现代简约，大间距',

  heading: {
    h1: "text-[40px] font-bold text-[#37352f] leading-[1.2]",
    h2: "text-[30px] font-semibold text-[#37352f] leading-[1.3]",
    h3: "text-[24px] font-semibold text-[#37352f] leading-[1.3]",
    h4: "text-[20px] font-semibold text-[#37352f]",
    h5: "text-[18px] font-semibold text-[#37352f]",
    h6: "text-[16px] font-semibold text-[#9b9a97]"
  },

  headingContainer: {
    h1: "mt-8 mb-1",
    h2: "mt-6 mb-1",
    h3: "mt-5 mb-1",
    h4: "mt-4 mb-1",
    h5: "mt-3 mb-1",
    h6: "mt-3 mb-1"
  },

  h3Dot: null,

  paragraph: "my-1 text-[16px] leading-[1.7] text-[#37352f]",
  paragraphInner: "mb-0",

  list: "my-1 text-[16px] leading-[1.7] text-[#37352f]",
  ul: "list-disc pl-6 space-y-0.5",
  ol: "list-decimal pl-6 space-y-0.5",
  li: "pl-1",

  codeBlock: "my-2 rounded-md overflow-hidden bg-[#f7f6f3]",
  codeHeader: "flex items-center justify-between px-4 py-2 bg-[#f7f6f3] text-xs text-[#9b9a97]",
  codeHeaderDots: false,
  inlineCode: "bg-[#f7f6f3] text-[#eb5757] px-1 py-0.5 rounded text-[90%] font-mono",

  table: "my-2 w-full",
  thead: "border-b border-[#e9e9e7]",
  tbody: "",
  tr: "border-b border-[#e9e9e7]",
  th: "px-3 py-2 text-left text-sm font-medium text-[#9b9a97]",
  td: "px-3 py-2 text-sm text-[#37352f]",

  link: "text-[#37352f] underline decoration-[#9b9a97]/50 hover:decoration-[#37352f]",

  hr: "my-4 border-t border-[#e9e9e7]",
  hrDot: false,

  mermaid: "my-2 p-4 bg-[#f7f6f3] rounded-md",

  strong: "font-semibold",
  em: "italic",


  navigator: {
    activeItem: "bg-[#37352f] text-white",
    activeIcon: "text-white",
    inactiveIcon: "text-[#37352f]",
    hoverBg: "hover:bg-[#f7f6f3]",
    tabActive: "bg-white text-[#37352f] shadow-sm",
    tabInactive: "text-[#9b9a97] hover:text-[#37352f]",
    border: "border-[#e9e9e7]"
  },

  neo4jCard: {
    container: "mt-2 px-3 py-2 bg-[#f1f1ef] rounded-lg border border-[#e9e9e7] flex flex-wrap items-center gap-1",
    label: "flex items-center gap-1 text-xs font-medium text-[#9b9a97] mr-1",
    labelIcon: "text-[#9b9a97]",
    idTag: "px-2 py-0.5 bg-white text-[#9b9a97] rounded text-xs font-mono border border-[#e9e9e7] hover:bg-[#f7f6f3] transition-colors cursor-default",
    idTagActive: "ring-2 ring-[#f97316] ring-offset-1 bg-[#fff7ed]",
    activeNodeText: "text-[#ea580c] font-semibold",
    activeIdText: "text-[#ea580c]"
  }
};

// 技术文档风格
export const technicalTheme: WikiTheme = {
  id: 'technical',
  name: 'Technical',
  description: '紧凑专业，适合代码文档',

  heading: {
    h1: "text-[28px] font-bold text-[#24292f] tracking-tight border-b-2 border-[#0969da] pb-2",
    h2: "text-[22px] font-bold text-[#24292f] tracking-tight",
    h3: "text-[18px] font-semibold text-[#24292f]",
    h4: "text-[16px] font-semibold text-[#24292f]",
    h5: "text-[14px] font-semibold text-[#24292f]",
    h6: "text-[12px] font-bold text-[#57606a] uppercase tracking-wide"
  },

  headingContainer: {
    h1: "mt-8 mb-4",
    h2: "mt-6 mb-3 pl-3 border-l-4 border-[#0969da]",
    h3: "mt-4 mb-2",
    h4: "mt-3 mb-2",
    h5: "mt-2 mb-1",
    h6: "mt-2 mb-1"
  },

  h3Dot: "w-2 h-2 bg-[#0969da] mr-2",

  paragraph: "my-2 text-[14px] leading-[1.6] text-[#24292f]",
  paragraphInner: "mb-2 last:mb-0",

  list: "my-2 text-[14px] leading-[1.5] text-[#24292f]",
  ul: "list-disc pl-5 space-y-1",
  ol: "list-decimal pl-5 space-y-1",
  li: "pl-1 marker:text-[#0969da]",

  codeBlock: "my-3 rounded-lg overflow-hidden border-2 border-[#d0d7de] bg-[#0d1117]",
  codeHeader: "flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] text-xs text-[#7d8590]",
  codeHeaderDots: true,
  inlineCode: "bg-[#ddf4ff] text-[#0969da] px-1.5 py-0.5 rounded text-[85%] font-mono font-medium",

  table: "my-3 w-full border-2 border-[#d0d7de] rounded-lg overflow-hidden",
  thead: "bg-[#f6f8fa]",
  tbody: "bg-white",
  tr: "border-b border-[#d0d7de]",
  th: "px-4 py-2 text-left text-xs font-bold text-[#24292f] uppercase tracking-wide bg-[#f6f8fa] border-r border-[#d0d7de] last:border-r-0",
  td: "px-4 py-2 text-sm text-[#24292f] font-mono border-r border-[#d0d7de] last:border-r-0",

  link: "text-[#0969da] font-medium hover:underline",

  hr: "my-6 border-t-2 border-dashed border-[#d0d7de]",
  hrDot: false,

  mermaid: "my-3 p-4 bg-[#f6f8fa] border-2 border-[#d0d7de] rounded-lg",

  strong: "font-bold text-[#24292f]",
  em: "italic text-[#57606a]",


  navigator: {
    activeItem: "bg-[#0969da] text-white",
    activeIcon: "text-white",
    inactiveIcon: "text-[#0969da]",
    hoverBg: "hover:bg-[#f6f8fa]",
    tabActive: "bg-[#0969da] text-white",
    tabInactive: "text-[#57606a] hover:text-[#24292f]",
    border: "border-[#d0d7de]"
  },

  neo4jCard: {
    container: "mt-2 px-3 py-2 bg-[#ddf4ff] rounded border-2 border-[#54aeff]/40 flex flex-wrap items-center gap-1",
    label: "flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-[#0969da] mr-1",
    labelIcon: "text-[#0969da]",
    idTag: "px-2 py-1 bg-[#f6f8fa] text-[#57606a] rounded text-xs font-mono font-medium border-2 border-[#d0d7de] hover:bg-[#eaeef2] hover:border-[#0969da]/30 transition-colors cursor-default",
    idTagActive: "ring-2 ring-[#f97316] ring-offset-1 bg-[#fff7ed] border-[#f97316]",
    activeNodeText: "text-[#ea580c] font-bold",
    activeIdText: "text-[#ea580c]"
  }
};

// Apple 暗色风格
export const appleDarkTheme: WikiTheme = {
  id: 'apple-dark',
  name: 'Apple',
  description: 'Liquid Glass 暗色',
  isDark: true,

  heading: {
    h1: "text-[34px] font-semibold text-[#f5f5f7] tracking-[-0.022em] leading-[1.15]",
    h2: "text-[28px] font-semibold text-[#f5f5f7] tracking-[-0.018em] leading-[1.2]",
    h3: "text-[22px] font-semibold text-[#f5f5f7] tracking-[-0.012em] leading-[1.25]",
    h4: "text-[18px] font-semibold text-[#f5f5f7] tracking-[-0.008em]",
    h5: "text-[16px] font-semibold text-[#f5f5f7]",
    h6: "text-[13px] font-semibold text-[#86868b] uppercase tracking-[0.02em]"
  },

  headingContainer: {
    h1: "mt-10 mb-4",
    h2: "mt-8 mb-3",
    h3: "mt-6 mb-2",
    h4: "mt-5 mb-2",
    h5: "mt-4 mb-1.5",
    h6: "mt-3 mb-1"
  },

  h3Dot: null,

  paragraph: "my-3 text-[17px] leading-[1.7] text-[#f5f5f7] tracking-[-0.01em]",
  paragraphInner: "mb-3 last:mb-0",

  list: "my-3 text-[17px] leading-[1.65] text-[#f5f5f7]",
  ul: "list-disc pl-5 space-y-2.5 marker:text-[#86868b]/70",
  ol: "list-decimal pl-6 space-y-2.5 marker:text-[#86868b]/70 marker:font-medium",
  li: "pl-1.5",

  codeBlock: "my-5 rounded-[28px] overflow-hidden bg-[#1d1d1f] backdrop-blur-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_1px_rgba(255,255,255,0.05)] border border-white/10",
  codeHeader: "flex items-center justify-between px-5 py-3 bg-gradient-to-b from-white/10 to-white/[0.02] border-b border-white/[0.08]",
  codeHeaderDots: true,
  inlineCode: "bg-white/10 backdrop-blur-md text-[#f5f5f7] px-2 py-0.5 rounded-lg text-[0.9em] font-mono border border-white/20",

  table: "my-6 w-full overflow-hidden rounded-[28px] bg-white/5 backdrop-blur-3xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-white/10",
  thead: "bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-md",
  tbody: "divide-y divide-white/10",
  tr: "transition-all duration-200 hover:bg-white/5",
  th: "px-5 py-4 text-left text-[13px] font-semibold text-[#86868b] tracking-[0.01em]",
  td: "px-5 py-4 text-[15px] text-[#f5f5f7] leading-relaxed align-top",

  link: "text-[#2997ff] hover:text-[#5ac8fa] transition-colors duration-200",

  hr: "my-10 h-px border-0 bg-gradient-to-r from-transparent via-[#424245]/60 to-transparent",
  hrDot: false,

  mermaid: "my-5 p-8 rounded-[28px] bg-white/5 backdrop-blur-3xl shadow-[0_8px_40px_rgba(0,0,0,0.3)] border border-white/10",

  strong: "font-semibold text-[#f5f5f7]",
  em: "italic text-[#a1a1a6]",


  navigator: {
    activeItem: "bg-[#2997ff] text-white shadow-sm",
    activeIcon: "text-white",
    inactiveIcon: "text-[#2997ff]",
    hoverBg: "hover:bg-white/10",
    tabActive: "bg-white/20 text-[#f5f5f7] shadow-sm backdrop-blur-sm",
    tabInactive: "text-[#86868b] hover:text-[#f5f5f7]",
    border: "border-white/20"
  },

  neo4jCard: {
    container: "mt-3 px-3 py-2 bg-gradient-to-br from-violet-900/40 to-indigo-900/30 backdrop-blur-sm rounded-xl border border-violet-500/30 shadow-sm flex flex-wrap items-center gap-1.5",
    label: "flex items-center gap-1 text-xs font-medium text-violet-400 mr-1",
    labelIcon: "text-violet-400",
    idTag: "px-2 py-1 bg-white/10 backdrop-blur-sm text-[#86868b] rounded-lg text-xs font-mono border border-white/20 hover:bg-white/15 transition-colors cursor-default",
    idTagActive: "ring-2 ring-orange-400 ring-offset-1 ring-offset-[#1d1d1f] bg-orange-900/40 border-orange-500/50",
    activeNodeText: "text-orange-400 font-semibold",
    activeIdText: "text-orange-400"
  }
};

// GitHub 暗色风格
export const githubDarkTheme: WikiTheme = {
  id: 'github-dark',
  name: 'GitHub',
  description: '暗色 Markdown 风格',
  isDark: true,

  heading: {
    h1: "text-[32px] font-semibold text-[#e6edf3] leading-tight pb-2 border-b border-[#30363d]",
    h2: "text-[24px] font-semibold text-[#e6edf3] leading-tight pb-2 border-b border-[#30363d]",
    h3: "text-[20px] font-semibold text-[#e6edf3] leading-tight",
    h4: "text-[16px] font-semibold text-[#e6edf3]",
    h5: "text-[14px] font-semibold text-[#e6edf3]",
    h6: "text-[13px] font-semibold text-[#7d8590]"
  },

  headingContainer: {
    h1: "mt-6 mb-4",
    h2: "mt-6 mb-4",
    h3: "mt-6 mb-4",
    h4: "mt-6 mb-4",
    h5: "mt-6 mb-4",
    h6: "mt-6 mb-4"
  },

  h3Dot: null,

  paragraph: "my-4 text-[16px] leading-[1.6] text-[#e6edf3]",
  paragraphInner: "mb-4 last:mb-0",

  list: "my-4 text-[16px] leading-[1.6] text-[#e6edf3]",
  ul: "list-disc pl-8 space-y-1 marker:text-[#7d8590]",
  ol: "list-decimal pl-8 space-y-1 marker:text-[#7d8590]",
  li: "pl-1",

  codeBlock: "my-4 rounded-md overflow-hidden border border-[#30363d] bg-[#161b22]",
  codeHeader: "flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] text-xs text-[#7d8590]",
  codeHeaderDots: false,
  inlineCode: "bg-[#343942] text-[#e6edf3] px-1.5 py-0.5 rounded-md text-[85%] font-mono",

  table: "my-4 w-full border-collapse border border-[#30363d]",
  thead: "bg-[#161b22]",
  tbody: "bg-[#0d1117]",
  tr: "border-b border-[#30363d]",
  th: "px-4 py-3 text-left text-sm font-semibold text-[#e6edf3] border border-[#30363d]",
  td: "px-4 py-3 text-sm text-[#e6edf3] border border-[#30363d]",

  link: "text-[#58a6ff] hover:underline",

  hr: "my-6 border-t border-[#30363d]",
  hrDot: false,

  mermaid: "my-4 p-4 bg-[#161b22] border border-[#30363d] rounded-md",

  strong: "font-semibold text-[#e6edf3]",
  em: "italic text-[#7d8590]",


  navigator: {
    activeItem: "bg-[#238636] text-white",
    activeIcon: "text-white",
    inactiveIcon: "text-[#3fb950]",
    hoverBg: "hover:bg-[#161b22]",
    tabActive: "bg-[#238636] text-white shadow-sm",
    tabInactive: "text-[#7d8590] hover:text-[#e6edf3]",
    border: "border-[#30363d]"
  },

  neo4jCard: {
    container: "mt-3 px-3 py-2 bg-[#1b4721] rounded-md border border-[#238636] flex flex-wrap items-center gap-1.5",
    label: "flex items-center gap-1 text-xs font-medium text-[#3fb950] mr-1",
    labelIcon: "text-[#3fb950]",
    idTag: "px-2 py-1 bg-[#0d1117] text-[#3fb950] rounded-md text-xs font-mono border border-[#30363d] hover:bg-[#161b22] hover:border-[#3fb950] transition-colors cursor-default",
    idTagActive: "ring-2 ring-[#3fb950] ring-offset-1 ring-offset-[#0d1117] bg-[#0d1117] border-[#3fb950]",
    activeNodeText: "text-[#3fb950] font-semibold",
    activeIdText: "text-[#3fb950]"
  }
};

// Notion 暗色风格
export const notionDarkTheme: WikiTheme = {
  id: 'notion-dark',
  name: 'Notion',
  description: '现代简约暗色',
  isDark: true,

  heading: {
    h1: "text-[40px] font-bold text-[#ffffffcf] leading-[1.2]",
    h2: "text-[30px] font-semibold text-[#ffffffcf] leading-[1.3]",
    h3: "text-[24px] font-semibold text-[#ffffffcf] leading-[1.3]",
    h4: "text-[20px] font-semibold text-[#ffffffcf]",
    h5: "text-[18px] font-semibold text-[#ffffffcf]",
    h6: "text-[16px] font-semibold text-[#ffffff71]"
  },

  headingContainer: {
    h1: "mt-8 mb-1",
    h2: "mt-6 mb-1",
    h3: "mt-5 mb-1",
    h4: "mt-4 mb-1",
    h5: "mt-3 mb-1",
    h6: "mt-3 mb-1"
  },

  h3Dot: null,

  paragraph: "my-1 text-[16px] leading-[1.7] text-[#ffffffcf]",
  paragraphInner: "mb-0",

  list: "my-1 text-[16px] leading-[1.7] text-[#ffffffcf]",
  ul: "list-disc pl-6 space-y-0.5 marker:text-[#ffffff71]",
  ol: "list-decimal pl-6 space-y-0.5 marker:text-[#ffffff71]",
  li: "pl-1",

  codeBlock: "my-2 rounded-md overflow-hidden bg-[#252526]",
  codeHeader: "flex items-center justify-between px-4 py-2 bg-[#252526] text-xs text-[#ffffff71]",
  codeHeaderDots: false,
  inlineCode: "bg-[#363636] text-[#eb5757] px-1 py-0.5 rounded text-[90%] font-mono",

  table: "my-2 w-full",
  thead: "border-b border-[#ffffff1a]",
  tbody: "",
  tr: "border-b border-[#ffffff1a]",
  th: "px-3 py-2 text-left text-sm font-medium text-[#ffffff71]",
  td: "px-3 py-2 text-sm text-[#ffffffcf]",

  link: "text-[#ffffffcf] underline decoration-[#ffffff71]/50 hover:decoration-[#ffffffcf]",

  hr: "my-4 border-t border-[#ffffff1a]",
  hrDot: false,

  mermaid: "my-2 p-4 bg-[#252526] rounded-md",

  strong: "font-semibold text-[#ffffffcf]",
  em: "italic text-[#ffffff71]",


  navigator: {
    activeItem: "bg-[#ffffffcf] text-[#191919]",
    activeIcon: "text-[#191919]",
    inactiveIcon: "text-[#ffffffcf]",
    hoverBg: "hover:bg-[#ffffff1a]",
    tabActive: "bg-[#2f2f2f] text-[#ffffffcf] shadow-sm",
    tabInactive: "text-[#ffffff71] hover:text-[#ffffffcf]",
    border: "border-[#ffffff1a]"
  },

  neo4jCard: {
    container: "mt-2 px-3 py-2 bg-[#2f2f2f] rounded-lg border border-[#ffffff1a] flex flex-wrap items-center gap-1",
    label: "flex items-center gap-1 text-xs font-medium text-[#ffffff71] mr-1",
    labelIcon: "text-[#ffffff71]",
    idTag: "px-2 py-0.5 bg-[#191919] text-[#ffffff71] rounded text-xs font-mono border border-[#ffffff1a] hover:bg-[#252526] transition-colors cursor-default",
    idTagActive: "ring-2 ring-[#f97316] ring-offset-1 ring-offset-[#191919] bg-[#3d2814]",
    activeNodeText: "text-[#fb923c] font-semibold",
    activeIdText: "text-[#fb923c]"
  }
};

// Technical 暗色风格
export const technicalDarkTheme: WikiTheme = {
  id: 'technical-dark',
  name: 'Technical',
  description: '紧凑专业暗色',
  isDark: true,

  heading: {
    h1: "text-[28px] font-bold text-[#e6edf3] tracking-tight border-b-2 border-[#58a6ff] pb-2",
    h2: "text-[22px] font-bold text-[#e6edf3] tracking-tight",
    h3: "text-[18px] font-semibold text-[#e6edf3]",
    h4: "text-[16px] font-semibold text-[#e6edf3]",
    h5: "text-[14px] font-semibold text-[#e6edf3]",
    h6: "text-[12px] font-bold text-[#7d8590] uppercase tracking-wide"
  },

  headingContainer: {
    h1: "mt-8 mb-4",
    h2: "mt-6 mb-3 pl-3 border-l-4 border-[#58a6ff]",
    h3: "mt-4 mb-2",
    h4: "mt-3 mb-2",
    h5: "mt-2 mb-1",
    h6: "mt-2 mb-1"
  },

  h3Dot: "w-2 h-2 bg-[#58a6ff] mr-2",

  paragraph: "my-2 text-[14px] leading-[1.6] text-[#e6edf3]",
  paragraphInner: "mb-2 last:mb-0",

  list: "my-2 text-[14px] leading-[1.5] text-[#e6edf3]",
  ul: "list-disc pl-5 space-y-1 marker:text-[#58a6ff]",
  ol: "list-decimal pl-5 space-y-1 marker:text-[#58a6ff]",
  li: "pl-1",

  codeBlock: "my-3 rounded-lg overflow-hidden border-2 border-[#30363d] bg-[#0d1117]",
  codeHeader: "flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] text-xs text-[#7d8590]",
  codeHeaderDots: true,
  inlineCode: "bg-[#1f3a5f] text-[#58a6ff] px-1.5 py-0.5 rounded text-[85%] font-mono font-medium",

  table: "my-3 w-full border-2 border-[#30363d] rounded-lg overflow-hidden",
  thead: "bg-[#161b22]",
  tbody: "bg-[#0d1117]",
  tr: "border-b border-[#30363d]",
  th: "px-4 py-2 text-left text-xs font-bold text-[#e6edf3] uppercase tracking-wide bg-[#161b22] border-r border-[#30363d] last:border-r-0",
  td: "px-4 py-2 text-sm text-[#e6edf3] font-mono border-r border-[#30363d] last:border-r-0",

  link: "text-[#58a6ff] font-medium hover:underline",

  hr: "my-6 border-t-2 border-dashed border-[#30363d]",
  hrDot: false,

  mermaid: "my-3 p-4 bg-[#161b22] border-2 border-[#30363d] rounded-lg",

  strong: "font-bold text-[#e6edf3]",
  em: "italic text-[#7d8590]",


  navigator: {
    activeItem: "bg-[#58a6ff] text-white",
    activeIcon: "text-white",
    inactiveIcon: "text-[#58a6ff]",
    hoverBg: "hover:bg-[#161b22]",
    tabActive: "bg-[#58a6ff] text-white",
    tabInactive: "text-[#7d8590] hover:text-[#e6edf3]",
    border: "border-[#30363d]"
  },

  neo4jCard: {
    container: "mt-2 px-3 py-2 bg-[#1f3a5f] rounded border-2 border-[#58a6ff]/40 flex flex-wrap items-center gap-1",
    label: "flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-[#58a6ff] mr-1",
    labelIcon: "text-[#58a6ff]",
    idTag: "px-2 py-1 bg-[#0d1117] text-[#7d8590] rounded text-xs font-mono font-medium border-2 border-[#30363d] hover:bg-[#161b22] hover:border-[#58a6ff]/30 transition-colors cursor-default",
    idTagActive: "ring-2 ring-[#f97316] ring-offset-1 ring-offset-[#0d1117] bg-[#3d2814] border-[#f97316]",
    activeNodeText: "text-[#fb923c] font-bold",
    activeIdText: "text-[#fb923c]"
  }
};

// 主题对（亮色/暗色）
export interface ThemePair {
  id: string;
  name: string;
  light: WikiTheme;
  dark: WikiTheme;
}

export const themePairs: ThemePair[] = [
  { id: 'apple', name: 'Apple', light: appleTheme, dark: appleDarkTheme },
  { id: 'github', name: 'GitHub', light: githubTheme, dark: githubDarkTheme },
  { id: 'notion', name: 'Notion', light: notionTheme, dark: notionDarkTheme },
  { id: 'technical', name: 'Technical', light: technicalTheme, dark: technicalDarkTheme }
];

// 所有主题
export const wikiThemes: WikiTheme[] = [
  appleTheme,
  appleDarkTheme,
  githubTheme,
  githubDarkTheme,
  notionTheme,
  notionDarkTheme,
  technicalTheme,
  technicalDarkTheme
];

// 根据 ID 获取主题
export const getThemeById = (id: string): WikiTheme => {
  return wikiThemes.find(t => t.id === id) || appleTheme;
};

// 根据主题对 ID 和暗色模式获取主题
export const getThemeByPairAndMode = (pairId: string, isDark: boolean): WikiTheme => {
  const pair = themePairs.find(p => p.id === pairId);
  if (!pair) return appleTheme;
  return isDark ? pair.dark : pair.light;
};
