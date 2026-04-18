import path from 'path';
import fs from 'fs';
import net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 从 server/.env 读取 SOURCE_ROOT_PATH。
// 以前源码必须放在 frontend/public/source-code/,现在由 .env 里的 SOURCE_ROOT_PATH 决定,
// vite dev middleware 从这个目录直接服务源码文件和列表。
function loadSourceRoot(): string {
  const envPath = path.resolve(__dirname, '..', 'server', '.env');
  try {
    const text = fs.readFileSync(envPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^SOURCE_ROOT_PATH\s*=\s*(.*)$/);
      if (m) {
        // 去掉可能包裹的引号
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return v;
      }
    }
  } catch (e) {
    console.warn('[vite] 无法读取 server/.env 的 SOURCE_ROOT_PATH:', e);
  }
  return '';
}

// Path traversal 防护:把相对路径解析为 SOURCE_ROOT 下的绝对路径,越界返回 null。
function safeResolveUnder(root: string, rel: string): string | null {
  const cleanRel = rel.replace(/^[/\\]+/, '');
  const target = path.resolve(root, cleanRel);
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return target;
}

// 源码服务 Vite 插件:
//   GET /api/source-code/files    → 返回 SOURCE_ROOT_PATH 下所有相对路径
//   GET /source-code/<rel>        → 返回指定文件的纯文本内容
function sourceCodeScannerPlugin(): Plugin {
  const SOURCE_ROOT = loadSourceRoot();
  console.log(`[vite] SOURCE_ROOT_PATH: ${SOURCE_ROOT || '(未配置,源码面板不可用)'}`);

  return {
    name: 'source-code-scanner',
    configureServer(server) {
      // 列出所有源码文件(供文件树)
      server.middlewares.use('/api/source-code/files', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (!SOURCE_ROOT || !fs.existsSync(SOURCE_ROOT)) {
          res.end(JSON.stringify({ files: [], error: 'SOURCE_ROOT_PATH 未配置或目录不存在' }));
          return;
        }
        const files: string[] = [];
        (function scan(dir: string, relativePath: string) {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith('.')) continue;
              const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                scan(full, rel);
              } else if (entry.isFile() && entry.name !== 'manifest.json') {
                files.push(rel);
              }
            }
          } catch (e) {
            console.error(`[vite source-code] 扫描失败 ${dir}:`, e);
          }
        })(SOURCE_ROOT, '');
        files.sort();
        res.end(JSON.stringify({ files }));
      });

      // 读取源码文件内容(供源码面板和 mermaid 跳转)
      // URL 形如 /source-code/<rel/path/to/file.java>
      server.middlewares.use('/source-code', (req, res, next) => {
        if (!req.url) return next();
        // 去掉查询参数
        const urlPath = req.url.split('?')[0];
        let rel: string;
        try {
          rel = decodeURIComponent(urlPath);
        } catch {
          rel = urlPath;
        }
        if (!SOURCE_ROOT) {
          res.statusCode = 503;
          res.end('SOURCE_ROOT_PATH 未配置');
          return;
        }
        const target = safeResolveUnder(SOURCE_ROOT, rel);
        if (!target) {
          res.statusCode = 400;
          res.end('Invalid path');
          return;
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
          res.statusCode = 404;
          res.end(`File not found: ${rel}`);
          return;
        }
        try {
          const content = fs.readFileSync(target, 'utf-8');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(content);
        } catch (e) {
          res.statusCode = 500;
          res.end(`Read error: ${e}`);
        }
      });
    }
  };
}

// ==================== Backend Launcher Plugin ====================
//
// 前端"启动后端"按钮的底层实现:
//   GET  /api/dev/backend/status   探测 localhost:11219 是否响应,返回 {running, is_ours}
//   POST /api/dev/backend/start    body: {values: {OPENAI_API_KEY, WIKI_RAW_PATH, ...}}
//                                   → 合并写入 server/.env → spawn `python launch.py <WIKI_RAW_PATH>`
//                                   → SSE 推进度
//   POST /api/dev/backend/stop     kill 本插件 spawn 的子进程 (外部启动的不动)
//   GET  /api/dev/env              读取 server/.env 当前值(后端未启动时供 BackendLauncher 预填表单)

const BACKEND_PORT = 11219;

/** TCP probe 看端口是否被占用(任何进程都算) */
function probeBackendPort(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

/** 把 {KEY: VALUE} 合并写入 server/.env,保留其他未提及的行 */
function upsertServerEnv(serverEnvPath: string, updates: Record<string, string>): void {
  let existing: Record<string, string> = {};
  const lines: string[] = [];
  if (fs.existsSync(serverEnvPath)) {
    const text = fs.readFileSync(serverEnvPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        lines.push(line);
        continue;
      }
      const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) {
        lines.push(line);
        continue;
      }
      existing[m[1]] = m[2];
      lines.push(line);
    }
  }
  // 遍历 updates,更新或追加
  for (const [k, v] of Object.entries(updates)) {
    const escaped = /[\s"'#\\]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
    const newLine = `${k}=${escaped}`;
    if (k in existing) {
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.startsWith(`${k}=`) || t.startsWith(`${k} =`)) {
          lines[i] = newLine;
          break;
        }
      }
    } else {
      lines.push(newLine);
    }
  }
  fs.writeFileSync(serverEnvPath, lines.join('\n') + (lines[lines.length - 1] === '' ? '' : '\n'), 'utf-8');
}

function backendLauncherPlugin(): Plugin {
  // 保存"本插件 spawn 的"子进程句柄。外部启动的后端不在此处管理。
  let childProc: ChildProcess | null = null;

  // Vite 进程退出时清理子进程(避免孤儿)
  const cleanup = () => {
    if (childProc && !childProc.killed) {
      try { childProc.kill('SIGTERM'); } catch {}
      childProc = null;
    }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });

  type Emitter = (type: string, payload?: Record<string, any>) => void;

  /** 从 server/.env 读取指定 key(和 sourceCodeScannerPlugin 的 loadSourceRoot 同一个套路) */
  const readServerEnvValue = (key: string): string => {
    const envPath = path.resolve(__dirname, '..', 'server', '.env');
    if (!fs.existsSync(envPath)) return '';
    try {
      const text = fs.readFileSync(envPath, 'utf-8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const m = trimmed.match(new RegExp(`^${key}\\s*=\\s*(.*)$`));
        if (m) {
          let v = m[1].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          return v;
        }
      }
    } catch {}
    return '';
  };

  /** 等待端口释放(最多 maxWaitMs 毫秒) */
  const waitForPortRelease = async (maxWaitMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!(await probeBackendPort(BACKEND_PORT))) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };

  /** 优雅停止当前 childProc: SIGTERM → 5s 超时 → SIGKILL。返回前等待进程真的退出 */
  const stopCurrent = async (emit: Emitter): Promise<void> => {
    if (!childProc || childProc.killed || childProc.exitCode !== null) {
      childProc = null;
      return;
    }
    emit('progress', { step: 'stopping', message: `正在停止当前后端 (pid=${childProc.pid})...` });
    const proc = childProc;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        resolve();
      }, 5000);
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
      try { proc.kill('SIGTERM'); } catch {}
    });
    childProc = null;
  };

  /**
   * spawn launch.py 并等待端口就绪。start 和 restart 都用这个。
   * 内部把 SSE 事件通过 emit 推送。失败时抛异常(调用方负责 res.end)。
   */
  const spawnAndWait = async (wikiRoot: string, emit: Emitter): Promise<number> => {
    const projectRoot = path.resolve(__dirname, '..');
    const launchScript = path.join(projectRoot, 'launch.py');
    if (!fs.existsSync(launchScript)) {
      throw new Error(`找不到 launch.py: ${launchScript}`);
    }

    emit('progress', { step: 'spawn', message: `启动 python launch.py ${wikiRoot}` });

    const proc = spawn('python3', ['-u', launchScript, wikiRoot, '--port', String(BACKEND_PORT)], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    childProc = proc;

    if (!proc.pid) {
      throw new Error('spawn 失败,未获取到子进程 pid');
    }
    emit('progress', { step: 'spawned', message: `子进程 pid=${proc.pid}` });

    const forwardLine = (source: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) emit('log', { source, line });
      }
    };
    proc.stdout?.on('data', buf => forwardLine('stdout', buf));
    proc.stderr?.on('data', buf => forwardLine('stderr', buf));

    // 轮询 TCP,直到端口可用(最长 10 分钟,覆盖大 wiki 建索引时长)
    const startTs = Date.now();
    const maxWaitMs = 10 * 60 * 1000;
    while (Date.now() - startTs < maxWaitMs) {
      if (proc.exitCode !== null && proc.exitCode !== undefined) {
        throw new Error(`子进程提前退出,exitCode=${proc.exitCode}`);
      }
      if (await probeBackendPort(BACKEND_PORT)) {
        return proc.pid!;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error('等待后端端口可用超时(10 分钟),可能转换/建索引未完成');
  };

  return {
    name: 'backend-launcher',
    configureServer(server) {
      // ---- 状态探测 ----
      server.middlewares.use('/api/dev/backend/status', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const running = await probeBackendPort(BACKEND_PORT);
        const isOurs = !!(childProc && !childProc.killed && childProc.exitCode === null);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          running,
          is_ours: isOurs,
          pid: isOurs ? childProc!.pid : null,
          port: BACKEND_PORT,
        }));
      });

      // ---- 启动 (SSE) ----
      // body: { values: Record<string, string> }
      //   values 由 BackendLauncher 表单填入,至少必须包含非空的 WIKI_RAW_PATH。
      //   插件把整个 values 合并到 server/.env(空字符串跳过,不覆盖已有),
      //   然后用 values.WIKI_RAW_PATH 作参数 spawn launch.py。
      server.middlewares.use('/api/dev/backend/start', async (req, res, next) => {
        if (req.method !== 'POST') return next();

        let bodyRaw = '';
        req.on('data', chunk => { bodyRaw += chunk.toString(); });
        await new Promise<void>(resolve => req.on('end', () => resolve()));
        let body: any = {};
        try { body = JSON.parse(bodyRaw || '{}'); } catch {}
        const values: Record<string, string> = (body && typeof body.values === 'object' && body.values) || {};
        const wikiRoot = (values.WIKI_RAW_PATH || '').trim();

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const emit = (type: string, payload: Record<string, any> = {}) => {
          res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        };

        try {
          if (!wikiRoot) {
            emit('error', { message: '请填写原始 Wiki 根目录 (WIKI_RAW_PATH)' });
            return res.end();
          }
          if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
            emit('error', { message: `目录不存在: ${wikiRoot}` });
            return res.end();
          }

          if (await probeBackendPort(BACKEND_PORT)) {
            emit('progress', { step: 'already-running', message: `后端已在 :${BACKEND_PORT} 上运行,无需重复启动` });
            emit('result', { already_running: true, port: BACKEND_PORT });
            return res.end();
          }

          // 合并写入 .env: 遍历 values,只写非空项(空字符串 = 保留已有值不变)
          const serverEnvPath = path.resolve(__dirname, '..', 'server', '.env');
          const updates: Record<string, string> = {};
          for (const [k, v] of Object.entries(values)) {
            const s = typeof v === 'string' ? v.trim() : '';
            if (s) updates[k] = s;
          }
          try {
            if (Object.keys(updates).length > 0) {
              upsertServerEnv(serverEnvPath, updates);
              emit('progress', { step: 'env', message: `已写入 server/.env (${Object.keys(updates).join(', ')})` });
            } else {
              emit('progress', { step: 'env', message: `无字段变更,跳过 .env 写入` });
            }
          } catch (e) {
            emit('error', { message: `写入 .env 失败: ${e}` });
            return res.end();
          }

          try {
            const pid = await spawnAndWait(wikiRoot, emit);
            emit('result', { already_running: false, port: BACKEND_PORT, pid });
            res.end();
          } catch (err) {
            emit('error', { message: String(err instanceof Error ? err.message : err) });
            res.end();
          }
        } catch (e) {
          emit('error', { message: `启动失败: ${e}` });
          try { res.end(); } catch {}
        }
      });

      // ---- 读取 .env 值(后端未启动时供 BackendLauncher 预填表单)----
      // 返回 raw values,UI 自己决定怎么 mask 展示。
      server.middlewares.use('/api/dev/env', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'application/json');
        const envPath = path.resolve(__dirname, '..', 'server', '.env');
        if (!fs.existsSync(envPath)) {
          res.end(JSON.stringify({ file_exists: false, file_path: envPath, values: {} }));
          return;
        }
        const values: Record<string, string> = {};
        try {
          const text = fs.readFileSync(envPath, 'utf-8');
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
            if (!m) continue;
            let v = m[2].trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            values[m[1]] = v;
          }
          res.end(JSON.stringify({ file_exists: true, file_path: envPath, values }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ detail: String(e) }));
        }
      });

      // ---- 目录浏览(后端未启动时 BackendLauncher 用) ----
      // 和后端的 /api/fs/browse 返回结构一致
      server.middlewares.use('/api/dev/fs/browse', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'application/json');
        try {
          const url = new URL(req.url || '', 'http://localhost');
          let raw = (url.searchParams.get('path') || '~').trim();
          if (!raw || raw === '~') raw = process.env.HOME || '/';
          else if (raw.startsWith('~/')) raw = path.join(process.env.HOME || '/', raw.slice(2));
          raw = path.resolve(raw);

          if (!fs.existsSync(raw) || !fs.statSync(raw).isDirectory()) {
            res.statusCode = 404;
            res.end(JSON.stringify({ detail: `目录不存在: ${raw}` }));
            return;
          }

          const entries: Array<{ name: string; is_dir: boolean }> = [];
          for (const name of fs.readdirSync(raw).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
            if (name.startsWith('.')) continue;
            try {
              const full = path.join(raw, name);
              if (fs.statSync(full).isDirectory()) {
                entries.push({ name, is_dir: true });
              }
            } catch { /* skip inaccessible */ }
          }
          const parent = path.dirname(raw);
          res.end(JSON.stringify({ path: raw, parent: parent === raw ? null : parent, entries }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ detail: String(e) }));
        }
      });

      // ---- 重启 (SSE) ----
      // 场景: 用户保存 .env 后需要让后端看到新配置,由前端主动调用本端点。
      // 流程: 停止当前子进程(若存在) → 等端口释放 → 从 .env 读 WIKI_RAW_PATH → 重新 spawn
      server.middlewares.use('/api/dev/backend/restart', async (req, res, next) => {
        if (req.method !== 'POST') return next();

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const emit = (type: string, payload: Record<string, any> = {}) => {
          res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        };

        try {
          // 1. 从 .env 读 WIKI_RAW_PATH (未转换的 wiki 根目录,launch.py 的参数)
          const wikiRoot = readServerEnvValue('WIKI_RAW_PATH').trim();
          if (!wikiRoot) {
            emit('error', { message: 'server/.env 未配置 WIKI_RAW_PATH,请先通过启动界面指定 wiki 根目录' });
            return res.end();
          }
          if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
            emit('error', { message: `WIKI_RAW_PATH 指向的目录不存在: ${wikiRoot}` });
            return res.end();
          }

          // 2. 如果 childProc 是本插件自己 spawn 的 → 停掉
          //    如果端口被外部进程占用 → 不乱 kill, 直接跳过重启
          const hasOurs = !!(childProc && !childProc.killed && childProc.exitCode === null);
          if (hasOurs) {
            await stopCurrent(emit);
          } else if (await probeBackendPort(BACKEND_PORT)) {
            emit('progress', {
              step: 'external',
              message: '端口被外部进程占用(非本插件启动),跳过自动重启。请手动重启后端。',
            });
            emit('result', { restarted: false, external: true, port: BACKEND_PORT });
            return res.end();
          }

          // 3. 等端口彻底释放
          emit('progress', { step: 'waiting', message: '等待端口释放...' });
          const released = await waitForPortRelease(5000);
          if (!released) {
            emit('error', { message: '端口 5s 内未释放,重启失败' });
            return res.end();
          }

          // 4. 重新 spawn
          try {
            const pid = await spawnAndWait(wikiRoot, emit);
            emit('result', { restarted: true, port: BACKEND_PORT, pid });
            res.end();
          } catch (err) {
            emit('error', { message: String(err instanceof Error ? err.message : err) });
            res.end();
          }
        } catch (e) {
          emit('error', { message: `重启失败: ${e}` });
          try { res.end(); } catch {}
        }
      });

      // ---- 停止 ----
      server.middlewares.use('/api/dev/backend/stop', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        res.setHeader('Content-Type', 'application/json');
        if (!childProc || childProc.killed || childProc.exitCode !== null) {
          res.end(JSON.stringify({ stopped: false, reason: '本插件未启动过后端,或已退出' }));
          return;
        }
        try {
          childProc.kill('SIGTERM');
          res.end(JSON.stringify({ stopped: true, pid: childProc.pid }));
          childProc = null;
        } catch (e) {
          res.end(JSON.stringify({ stopped: false, reason: String(e) }));
        }
      });
    },
  };
}


export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), sourceCodeScannerPlugin(), backendLauncherPlugin()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'import.meta.env.VITE_CODENEXUS_API_URL': JSON.stringify(env.VITE_CODENEXUS_API_URL)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
