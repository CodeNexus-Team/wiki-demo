import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Server, Play, Loader2, AlertCircle, CheckCircle2,
  Folder, Eye, EyeOff, ChevronDown, ChevronRight,
} from 'lucide-react';
import { codenexusWikiService } from '../services/codenexusWikiService';
import { BackendStartEvent } from '../types';
import DirectoryPicker from './DirectoryPicker';

interface BackendLauncherProps {
  isDarkMode?: boolean;
  /** 后端就绪(检测到 running=true)时回调父组件切换到主界面 */
  onReady: () => void;
}

type LogEntry = { source: 'stdout' | 'stderr' | 'info' | 'error'; line: string };

interface FieldDef {
  name: string;
  label: string;
  description: string;
  placeholder: string;
  isSecret: boolean;
  required: boolean;
  type: 'text' | 'directory';
}

// 核心字段(所有启动都可见,包含必填项)
const CORE_FIELDS: FieldDef[] = [
  { name: 'OPENAI_API_KEY',  label: 'OpenAI API Key',  description: 'wiki 索引生成必需,可以是第三方兼容服务的 key。',
    placeholder: 'sk-...',                                      isSecret: true,  required: true,  type: 'text' },
  { name: 'OPENAI_BASE_URL', label: 'OpenAI Base URL', description: '第三方兼容服务地址,留空则用官方。',
    placeholder: 'https://api.openai.com/v1',                   isSecret: false, required: false, type: 'text' },
  { name: 'OPENAI_MODEL',    label: 'OpenAI Model',    description: '生成 wiki 索引用的模型,默认 gpt-4o-mini。',
    placeholder: 'gpt-4o-mini',                                 isSecret: false, required: false, type: 'text' },
  { name: 'SOURCE_ROOT_PATH', label: '业务源码根目录', description: '项目业务代码绝对路径。Agent 的 Read 工具从这里读源码,语义上和 Wiki 根目录不同。',
    placeholder: '/Users/you/code/your-project',                isSecret: false, required: false, type: 'directory' },
  { name: 'WIKI_RAW_PATH',   label: '原始 Wiki 根目录', description: '未转换的 wiki 根目录(含 .md / .meta.json),启动时会转换到 <路径>/wiki_result。',
    placeholder: '/Users/you/code/your-wiki',                   isSecret: false, required: true,  type: 'directory' },
];

// Neo4j 组(可选,默认折叠)
const NEO4J_FIELDS: FieldDef[] = [
  { name: 'NEO4J_URI',      label: 'Neo4j URI',     description: '填写 bolt:// 或 neo4j:// 地址,不用图谱则留空。',
    placeholder: 'neo4j://127.0.0.1:7687',                      isSecret: false, required: false, type: 'text' },
  { name: 'NEO4J_USER',     label: 'Neo4j 用户名',  description: '默认 neo4j。',
    placeholder: 'neo4j',                                       isSecret: false, required: false, type: 'text' },
  { name: 'NEO4J_PASSWORD', label: 'Neo4j 密码',    description: 'Neo4j 密码。',
    placeholder: '',                                            isSecret: true,  required: false, type: 'text' },
];

/** 掩码 secret 值,用于预览(首尾各留 4 位) */
function maskSecret(v: string): string {
  if (!v) return '';
  if (v.length <= 8) return '•'.repeat(v.length);
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/**
 * 后端启动器 —— App 顶层的 gate,同时也是全项目唯一的配置入口。
 *
 * 挂载时:
 *   1. GET /api/dev/backend/status → running=true 直接 onReady()
 *   2. GET /api/dev/env → 拿当前 .env 值预填表单
 *
 * 提交:
 *   POST /api/dev/backend/start { values } → SSE 推进度
 *     - secret 字段如果用户没开启"编辑",发空字符串 → 插件保留原值
 *     - 非 secret 字段发当前值 → 非空才写入 .env
 *     - 启动成功后回调 onReady()
 */
const BackendLauncher: React.FC<BackendLauncherProps> = ({ isDarkMode = false, onReady }) => {
  const [phase, setPhase] = useState<'loading' | 'form' | 'starting'>('loading');
  // 从 /api/dev/env 读到的当前 .env 原始值
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  // 用户正在编辑的表单值(secret 字段未编辑时保持空字符串)
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  // 哪些 secret 字段点开了"编辑"(否则展示 mask 预览)
  const [editingSecrets, setEditingSecrets] = useState<Set<string>>(new Set());
  // 哪些 secret 字段在"编辑"模式下选择了明文显示(眼睛按钮)
  const [showPlainSecrets, setShowPlainSecrets] = useState<Set<string>>(new Set());
  const [neo4jExpanded, setNeo4jExpanded] = useState(false);
  const [pickerField, setPickerField] = useState<FieldDef | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const logAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logAreaRef.current?.scrollTo({ top: logAreaRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  // 初始加载: 探测后端 + 读 .env
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await codenexusWikiService.getBackendStatus();
        if (!cancelled && status.running) {
          onReady();
          return;
        }
      } catch {
        // 状态探测失败当未运行处理
      }
      try {
        const env = await codenexusWikiService.getDevEnv();
        if (cancelled) return;
        const vals = env.values || {};
        setEnvValues(vals);
        // 预填表单: 非 secret 字段带入当前值,secret 字段保持空(= 保留原值)
        const initial: Record<string, string> = {};
        for (const f of [...CORE_FIELDS, ...NEO4J_FIELDS]) {
          initial[f.name] = f.isSecret ? '' : (vals[f.name] ?? '');
        }
        setFormValues(initial);
        // 如果已有 Neo4j 值,默认展开方便用户查看
        if (NEO4J_FIELDS.some(f => vals[f.name])) setNeo4jExpanded(true);
      } catch {
        // 读 .env 失败 → 维持空表单,让用户手工填
      }
      if (!cancelled) setPhase('form');
    })();
    return () => { cancelled = true; };
  }, [onReady]);

  const appendLog = useCallback((entry: LogEntry) => {
    setLogs(prev => [...prev, entry]);
  }, []);

  const handleFieldChange = useCallback((name: string, value: string) => {
    setFormValues(prev => ({ ...prev, [name]: value }));
    setError(null);
  }, []);

  const toggleSecretEdit = useCallback((name: string) => {
    setEditingSecrets(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        // 退出编辑 → 清空输入 → 恢复"保留原值"语义
        setFormValues(p => ({ ...p, [name]: '' }));
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const toggleShowPlainSecret = useCallback((name: string) => {
    setShowPlainSecrets(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  // 校验必填字段: 要么 formValues 里有新值,要么 envValues 里有已存在值
  const missingRequired = useMemo(() => {
    const allFields = [...CORE_FIELDS, ...NEO4J_FIELDS];
    return allFields.filter(f => {
      if (!f.required) return false;
      const formVal = (formValues[f.name] || '').trim();
      const envVal = (envValues[f.name] || '').trim();
      return !formVal && !envVal;
    });
  }, [formValues, envValues]);

  const handleStart = useCallback(async () => {
    if (phase === 'starting') return;
    if (missingRequired.length > 0) {
      setError(`请先填写: ${missingRequired.map(f => f.label).join('、')}`);
      return;
    }
    setError(null);
    setLogs([]);
    setPhase('starting');

    // 构造提交: 只送表单里非空的 key(空 = 保留原值,插件会跳过)
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(formValues)) {
      const s = (v || '').trim();
      if (s) payload[k] = s;
    }

    try {
      await codenexusWikiService.startBackend(payload, (ev: BackendStartEvent) => {
        if (ev.type === 'progress') {
          appendLog({ source: 'info', line: `[${ev.step}] ${ev.message}` });
        } else if (ev.type === 'log') {
          appendLog({ source: ev.source, line: ev.line });
        } else if (ev.type === 'result') {
          appendLog({
            source: 'info',
            line: ev.already_running
              ? `后端已在运行 (port ${ev.port})`
              : `启动成功: pid=${ev.pid} port=${ev.port}`,
          });
          setTimeout(() => onReady(), 800);
        } else if (ev.type === 'error') {
          appendLog({ source: 'error', line: ev.message });
          setError(ev.message);
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      appendLog({ source: 'error', line: msg });
    } finally {
      setPhase('form');
    }
  }, [phase, missingRequired, formValues, appendLog, onReady]);

  // ---------- 样式 tokens ----------
  const card = isDarkMode
    ? 'bg-[#161b22] border-[#30363d] text-[#e6edf3]'
    : 'bg-white border-[#e5e5ea] text-[#1d1d1f]';
  const muted = isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]';
  const inputBase = `w-full px-3 py-2 rounded-lg text-sm border outline-none transition-colors ${
    isDarkMode
      ? 'bg-[#0d1117] border-[#30363d] text-[#e6edf3] focus:border-[#58a6ff] placeholder:text-[#484f58]'
      : 'bg-white border-[#e5e5ea] text-[#1d1d1f] focus:border-[#0071E3] placeholder:text-[#a0a0a0]'
  }`;
  const btnGhost = `px-2.5 py-2 rounded-lg text-xs shrink-0 border inline-flex items-center gap-1 ${
    isDarkMode
      ? 'bg-[#21262d] border-[#30363d] hover:bg-[#30363d]'
      : 'bg-[#f5f5f7] border-[#e5e5ea] hover:bg-[#e8e8ed]'
  } disabled:opacity-50 disabled:cursor-not-allowed`;

  if (phase === 'loading') {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-[#0d1117]' : 'bg-[#f5f5f7]'}`}>
        <div className={`flex items-center gap-2 ${muted}`}>
          <Loader2 size={18} className="animate-spin" />
          <span>正在检测后端状态...</span>
        </div>
      </div>
    );
  }

  const starting = phase === 'starting';

  // ---------- 字段渲染 ----------
  const renderField = (f: FieldDef) => {
    const envVal = envValues[f.name] ?? '';
    const formVal = formValues[f.name] ?? '';
    const isSecret = f.isSecret;
    const isEditing = editingSecrets.has(f.name);
    const isConfigured = envVal.trim().length > 0;

    return (
      <div key={f.name} className="mb-4 last:mb-0">
        <div className="flex items-baseline gap-2 mb-1">
          <label className="text-[13px] font-medium">
            {f.label}
            {f.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <code className={`text-[11px] ${muted}`}>{f.name}</code>
          {isConfigured && !formVal && (
            <span className={`text-[11px] ${isDarkMode ? 'text-[#238636]' : 'text-[#0b8a3e]'}`}>● 已配置</span>
          )}
        </div>
        {f.description && (
          <div className={`text-[12px] mb-1.5 ${muted}`}>{f.description}</div>
        )}

        {isSecret ? (
          <div className="flex items-center gap-2">
            {isEditing ? (
              <input
                type={showPlainSecrets.has(f.name) ? 'text' : 'password'}
                value={formVal}
                onChange={e => handleFieldChange(f.name, e.target.value)}
                placeholder={isConfigured ? `留空则保留原值 (${maskSecret(envVal)})` : f.placeholder}
                className={inputBase}
                spellCheck={false}
                disabled={starting}
                autoFocus
                autoComplete="off"
              />
            ) : (
              <input
                type="text"
                value={isConfigured ? maskSecret(envVal) : ''}
                placeholder={isConfigured ? '' : f.placeholder}
                className={`${inputBase} ${muted}`}
                readOnly
              />
            )}
            {isEditing && (
              <button
                type="button"
                onClick={() => toggleShowPlainSecret(f.name)}
                disabled={starting}
                className={btnGhost}
                title={showPlainSecrets.has(f.name) ? '隐藏' : '显示'}
              >
                {showPlainSecrets.has(f.name) ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleSecretEdit(f.name)}
              disabled={starting}
              className={btnGhost}
              title={isEditing ? '取消修改' : '修改'}
            >
              {isEditing ? '取消' : (isConfigured ? '修改' : '填写')}
            </button>
          </div>
        ) : f.type === 'directory' ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={formVal}
              onChange={e => handleFieldChange(f.name, e.target.value)}
              placeholder={f.placeholder}
              className={`${inputBase} font-mono`}
              spellCheck={false}
              disabled={starting}
            />
            <button
              type="button"
              onClick={() => setPickerField(f)}
              disabled={starting}
              className={btnGhost}
              title="浏览目录"
            >
              <Folder size={14} />
              <span>浏览</span>
            </button>
          </div>
        ) : (
          <input
            type="text"
            value={formVal}
            onChange={e => handleFieldChange(f.name, e.target.value)}
            placeholder={f.placeholder}
            className={inputBase}
            spellCheck={false}
            disabled={starting}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <div className={`h-full overflow-y-auto py-10 px-6 ${isDarkMode ? 'bg-[#0d1117]' : 'bg-[#f5f5f7]'}`}>
        <div className="max-w-3xl mx-auto">
          {/* 头部 */}
          <div className="text-center mb-6">
            <div className={`w-16 h-16 rounded-[1.25rem] shadow-xl mb-4 mx-auto flex items-center justify-center text-white ${
              isDarkMode ? 'bg-gradient-to-tr from-[#58a6ff] to-[#79c0ff]' : 'bg-gradient-to-tr from-[#0071E3] to-[#5AC8FA]'
            }`}>
              <Server size={28} />
            </div>
            <h1 className={`text-2xl font-semibold tracking-tight ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>
              启动后端
            </h1>
            <p className={`text-[14px] mt-1.5 ${muted}`}>
              后端未运行。填写下方配置后点击启动。首次启动会自动转换 wiki + 生成 index,耗时几分钟。
            </p>
          </div>

          {/* 核心配置 */}
          <div className={`rounded-xl border ${card} mb-4 overflow-hidden`}>
            <div className={`px-5 py-3 border-b text-[13px] font-medium flex items-center gap-2 ${
              isDarkMode ? 'border-[#30363d] bg-[#0d1117]' : 'border-[#e5e5ea] bg-[#fafafa]'
            }`}>
              <span>核心配置</span>
              <span className={`text-[11px] ${muted}`}>wiki 生成必需</span>
            </div>
            <div className="p-5">
              {CORE_FIELDS.map(renderField)}
            </div>
          </div>

          {/* Neo4j (可折叠) */}
          <div className={`rounded-xl border ${card} mb-4 overflow-hidden`}>
            <button
              type="button"
              onClick={() => setNeo4jExpanded(v => !v)}
              className={`w-full px-5 py-3 text-left text-[13px] font-medium flex items-center gap-2 transition-colors ${
                isDarkMode
                  ? 'border-[#30363d] bg-[#0d1117] hover:bg-[#161b22]'
                  : 'border-[#e5e5ea] bg-[#fafafa] hover:bg-[#f0f0f0]'
              } ${neo4jExpanded ? 'border-b' : ''}`}
            >
              {neo4jExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Neo4j 图谱</span>
              <span className={`text-[11px] ${muted}`}>可选,不用则留空</span>
            </button>
            {neo4jExpanded && (
              <div className="p-5">
                {NEO4J_FIELDS.map(renderField)}
              </div>
            )}
          </div>

          {/* 启动按钮 + 状态 */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button
              type="button"
              onClick={handleStart}
              disabled={starting || missingRequired.length > 0}
              title={missingRequired.length > 0 ? `请先填写: ${missingRequired.map(f => f.label).join('、')}` : undefined}
              className={`px-5 py-2.5 rounded-xl text-[14px] font-medium inline-flex items-center gap-2 transition-colors ${
                isDarkMode
                  ? 'bg-[#238636] text-white hover:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed'
                  : 'bg-[#0071E3] text-white hover:bg-[#0077ED] disabled:bg-[#d2d2d7] disabled:text-[#86868b] disabled:cursor-not-allowed'
              }`}
            >
              {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {starting ? '启动中...' : '启动后端'}
            </button>

            {missingRequired.length > 0 && !starting && (
              <div className={`flex items-center gap-1.5 text-[13px] ${isDarkMode ? 'text-[#f0b76b]' : 'text-[#a35b00]'}`}>
                <AlertCircle size={14} />
                <span>请先填写: {missingRequired.map(f => f.label).join('、')}</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-1.5 text-[13px] text-red-500">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {!error && !starting && logs.some(l => l.source === 'info' && l.line.startsWith('启动成功')) && (
              <div className={`flex items-center gap-1.5 text-[13px] ${isDarkMode ? 'text-[#238636]' : 'text-[#0b8a3e]'}`}>
                <CheckCircle2 size={14} />
                <span>启动成功,正在切换...</span>
              </div>
            )}
          </div>

          {/* 日志区 */}
          {logs.length > 0 && (
            <div className={`rounded-xl border ${card} overflow-hidden`}>
              <div className={`px-4 py-2 border-b text-[12px] font-medium ${
                isDarkMode ? 'border-[#30363d] text-[#7d8590] bg-[#0d1117]' : 'border-[#e5e5ea] text-[#86868b] bg-[#f5f5f7]'
              }`}>
                启动日志
              </div>
              <div
                ref={logAreaRef}
                className={`px-4 py-3 text-[12px] font-mono max-h-96 overflow-y-auto ${
                  isDarkMode ? 'bg-[#010409] text-[#c9d1d9]' : 'bg-[#fafafa] text-[#1d1d1f]'
                }`}
              >
                {logs.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.source === 'error'
                        ? 'text-red-500'
                        : l.source === 'stderr'
                        ? isDarkMode ? 'text-[#f0b76b]' : 'text-[#a35b00]'
                        : l.source === 'info'
                        ? isDarkMode ? 'text-[#58a6ff]' : 'text-[#0071E3]'
                        : ''
                    }
                  >
                    {l.line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <DirectoryPicker
        isOpen={pickerField !== null}
        initialPath={pickerField ? (formValues[pickerField.name] || envValues[pickerField.name] || '~') : '~'}
        title={pickerField ? `选择 ${pickerField.label}` : '选择目录'}
        isDarkMode={isDarkMode}
        onClose={() => setPickerField(null)}
        onSelect={p => {
          if (pickerField) handleFieldChange(pickerField.name, p);
          setPickerField(null);
        }}
        // 后端未启动,走 Vite dev 插件的目录浏览端点
        browser={codenexusWikiService.browseDirectoryViaDev.bind(codenexusWikiService)}
      />
    </>
  );
};

export default BackendLauncher;
