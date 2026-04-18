import {
  UserQueryRequest,
  ExpandQueryResponse,
  ExecuteWorkflowResponse,
  FetchPageRequest,
  FetchPageResponse,
  DetailedQueryRequest,
  ModifyPageResponse,
  NewPageResponse,
  QaAnswerResponse,
  QaQueryResult,
  ExpandedQuestion,
  WikiPage,
  WikiTreeNode,
  WikiIndex,
  EnvConfigResponse,
  EnvSaveResponse,
  FsBrowseResponse,
  BackendStatus,
  BackendStartEvent,
  BackendRestartEvent,
  DevEnvResponse
} from '../types';
import { wikiPageCache } from './wikiPageCache';

/**
 * CodeNexus Wiki Service
 * 对接自研 AI 组件的后端服务（更新版 API）
 */
class CodeNexusWikiService {
  private baseUrl: string;

  constructor() {
    // 从环境变量读取后端 API 地址
    this.baseUrl = import.meta.env.VITE_CODENEXUS_API_URL || 'http://localhost:11219';
  }

  /**
   * Step 1: 扩展用户查询，生成多个扩展问题供用户选择
   * 使用统一的 /api/user_query 端点（不带 selected_questions）
   * @param userQuery 用户原始查询
   * @returns 扩展问题列表
   */
  async expandQuery(userQuery: string): Promise<ExpandedQuestion[]> {
    const request: UserQueryRequest = {
      user_query: userQuery
      // 不带 selected_questions，后端识别为扩展查询
    };

    console.log('[CodeNexus Service] 发送扩展查询请求:', {
      url: `${this.baseUrl}/api/user_query`,
      request
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/user_query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      console.log('[CodeNexus Service] 扩展查询响应状态:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CodeNexus Service] API 错误响应:', errorText);
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }

      const data: ExpandQueryResponse = await response.json();
      console.log('[CodeNexus Service] 扩展查询成功:', data);
      return data.questions;
    } catch (error) {
      console.error('[CodeNexus Service] 扩展查询失败:', error);
      throw new Error(`扩展查询失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Step 2: 执行工作流，生成 Wiki 文档
   * 使用统一的 /api/user_query 端点（带 selected_questions）
   * @param userQuery 用户原始查询
   * @param selectedQuestions 用户选择的扩展问题
   * @param onProgress 进度回调函数
   * @returns 包含 wiki_root 和 wiki_pages 的对象
   */
  async executeWorkflow(
    userQuery: string,
    selectedQuestions: ExpandedQuestion[],
    onProgress?: (step: string) => void
  ): Promise<ExecuteWorkflowResponse> {
    const request: UserQueryRequest = {
      user_query: userQuery,
      selected_questions: selectedQuestions  // 带上选择的问题，后端识别为执行工作流
    };

    console.log('[CodeNexus Service] 发送工作流执行请求:', {
      url: `${this.baseUrl}/api/user_query`,
      userQuery,
      selectedQuestionsCount: selectedQuestions.length,
      selectedQuestions: selectedQuestions.map(q => q.id)
    });

    try {
      onProgress?.('正在分析代码库范围 (Scope)...');

      const response = await fetch(`${this.baseUrl}/api/user_query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      console.log('[CodeNexus Service] 工作流响应状态:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CodeNexus Service] API 错误响应:', errorText);
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }

      onProgress?.('正在搜索相关实体 (Entities)...');

      const data: ExecuteWorkflowResponse = await response.json();
      console.log('[CodeNexus Service] 工作流执行成功:', data);

      onProgress?.('正在执行 Workflow 生成 Wiki...');

      return data;
    } catch (error) {
      console.error('[CodeNexus Service] 执行工作流失败:', error);
      throw new Error(`执行工作流失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Step 3: 获取 Wiki 页面内容（带缓存）
   * @param pagePath Wiki 页面路径
   * @returns Wiki 页面内容（结构化格式）
   */
  async fetchPage(pagePath: string): Promise<WikiPage> {
    // 先检查缓存
    const cachedPage = wikiPageCache.get(pagePath);
    if (cachedPage) {
      console.log('[CodeNexus Service] 使用缓存的页面:', pagePath);
      return cachedPage;
    }

    const request: FetchPageRequest = {
      page_path: pagePath
    };

    console.log('[CodeNexus Service] 发送获取页面请求:', {
      url: `${this.baseUrl}/api/fetch_page`,
      pagePath
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/fetch_page`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      console.log('[CodeNexus Service] 获取页面响应状态:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CodeNexus Service] API 错误响应:', errorText);
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }

      const data: FetchPageResponse = await response.json();

      // 缓存页面数据
      wikiPageCache.set(pagePath, data);

      return data;
    } catch (error) {
      console.error('获取页面失败:', error);
      throw new Error(`获取页面失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 详细查询：对选中的块进行细化
   * @param pagePath 当前页面路径
   * @param blockIds 选中的块 ID 列表
   * @param userQuery 用户查询指令
   * @returns 修改页面的操作或新页面
   */
  async detailedQuery(
    pagePath: string,
    blockIds: string[],
    userQuery: string,
    onProgress?: (message: string) => void,
    onClarify?: (question: string, options: string[], multiSelect?: boolean) => Promise<string>,
    resumeSessionId?: string
  ): Promise<(ModifyPageResponse | NewPageResponse | QaAnswerResponse) & { session_id?: string }> {
    const request: DetailedQueryRequest = {
      page_path: pagePath,
      block_ids: blockIds,
      user_query: userQuery,
      resume_session_id: resumeSessionId,
    };

    console.log('[CodeNexus Service] 调用 detailedQuery API (SSE):', {
      url: `${this.baseUrl}/api/detailed_query`,
      request
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/detailed_query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      console.log('[CodeNexus Service] detailedQuery API 响应状态:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: (ModifyPageResponse | NewPageResponse | QaAnswerResponse) & { session_id?: string } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);

            if (event.type === 'progress') {
              console.log('[CodeNexus Service] 进度:', event.message);
              onProgress?.(event.message);
            } else if (event.type === 'clarification') {
              // Agent 需要澄清：展示问题给用户，等待回答后提交
              console.log('[CodeNexus Service] 需要澄清:', event.question);
              onProgress?.(`🤔 AI 提问: ${event.question}`);
              if (onClarify) {
                const answer = await onClarify(event.question, event.options || [], event.multi_select || false);
                // 将回答提交给后端，Agent 将在同一会话中继续
                await fetch(`${this.baseUrl}/api/clarification_answer`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    session_key: event.session_key,
                    answer: answer
                  })
                });
                onProgress?.('已提交回答，AI 继续分析...');
              }
            } else if (event.type === 'result') {
              const data = event.data;
              console.log('[CodeNexus Service] detailedQuery 结果:', data);
              if ('qa_answer' in data) {
                finalResult = data as QaAnswerResponse;
              } else if ('new_page_path' in data) {
                finalResult = data as NewPageResponse;
              } else {
                finalResult = data as ModifyPageResponse;
              }
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== payload) throw e;
            console.warn('[CodeNexus Service] SSE 解析跳过:', payload);
          }
        }
      }

      if (!finalResult) {
        throw new Error('未收到查询结果');
      }
      return finalResult;
    } catch (error) {
      console.error('详细查询失败:', error);
      throw new Error(`详细查询失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 完整流程：从用户查询到生成 Wiki
   * @param userQuery 用户原始查询
   * @param onProgress 进度回调函数
   * @param onQuestionSelect 问题选择回调（返回用户选择的问题列表）
   * @returns Wiki 结构（包含 root 和 pages）
   */
  async generateWiki(
    userQuery: string,
    onProgress?: (step: string) => void,
    onQuestionSelect?: (questions: ExpandedQuestion[]) => Promise<ExpandedQuestion[]>
  ): Promise<ExecuteWorkflowResponse> {
    // Step 1: 扩展查询
    onProgress?.('正在分析您的问题，生成扩展查询...');
    const expandedQuestions = await this.expandQuery(userQuery);

    // Step 2: 用户选择问题
    let selectedQuestions: ExpandedQuestion[];
    if (onQuestionSelect) {
      onProgress?.('请选择您感兴趣的问题...');
      selectedQuestions = await onQuestionSelect(expandedQuestions);
    } else {
      // 默认选择所有问题
      selectedQuestions = expandedQuestions;
    }

    if (selectedQuestions.length === 0) {
      throw new Error('请至少选择一个问题');
    }

    // Step 3: 执行工作流
    onProgress?.('开始执行分析工作流...');
    const workflowResult = await this.executeWorkflow(userQuery, selectedQuestions, onProgress);

    onProgress?.('Wiki 生成完成！');
    return workflowResult;
  }

  /**
   * 应用变更：将 page_diff 应用到后端文件
   * @param pagePath 当前页面路径
   * @param pageDiff 要应用的变更
   * @returns 操作结果
   */
  async applyChanges(
    pagePath: string,
    pageDiff: ModifyPageResponse
  ): Promise<{ success: boolean; message: string }> {
    const request = {
      page_path: pagePath,
      page_diff: pageDiff
    };

    console.log('[CodeNexus Service] 调用 applyChanges API:', {
      url: `${this.baseUrl}/api/apply_changes`,
      request
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/apply_changes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      console.log('[CodeNexus Service] applyChanges API 响应状态:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[CodeNexus Service] applyChanges API 响应数据:', data);

      // 清除缓存，下次访问时重新获取
      wikiPageCache.remove(pagePath);

      return data;
    } catch (error) {
      console.error('应用变更失败:', error);
      throw new Error(`应用变更失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 直接扫描 wiki 目录，返回 wiki_root 和所有页面路径（无需查询）
   */
  async scanWikis(): Promise<ExecuteWorkflowResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/scan_wikis`);
      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[CodeNexus Service] 扫描 Wiki 目录失败:', error);
      throw new Error(`扫描 Wiki 目录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取所有已生成的 Wiki 列表（树状结构）
   */
  async listWikis(): Promise<WikiTreeNode[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/list_wikis`);
      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[CodeNexus Service] 获取 Wiki 列表失败:', error);
      throw new Error(`获取 Wiki 列表失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取 wiki_index.json 总览数据
   */
  async fetchWikiIndex(): Promise<WikiIndex | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/wiki_index`);
      if (response.status === 404) {
        // 未生成 index 时返回 null（前端可降级到文件树）
        return null;
      }
      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('[CodeNexus Service] 获取 wiki_index 失败:', error);
      return null;
    }
  }

  /**
   * 自由问答：针对当前 Wiki 页面和源码提问
   *
   * 返回结构对齐 detailedQuery：
   *   - answer: 主回答正文（始终存在）
   *   - session_id: 会话 id
   *   - insert_blocks / delete_blocks / replace_blocks: 可选的 SUGGEST_EDIT 修改建议
   *   - insert_sources / delete_sources: source_id 增删（保持和 ModifyPageResponse 对齐）
   *
   * 当任一 *_blocks 非空时，前端应展示"AI 建议修改 N 处"按钮让用户确认。
   */
  /**
   * 读取 server/.env 配置(供"生成 Wiki"界面的设置表单)。
   * secret 字段的 value 已 mask (例如 "sk-••••bdef"),完整值无法读取。
   */
  async getEnvConfig(): Promise<EnvConfigResponse> {
    const response = await fetch(`${this.baseUrl}/api/env`);
    if (!response.ok) {
      throw new Error(`读取配置失败: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * 保存 server/.env 配置。
   * secret 字段传空字符串表示保持原值不变。保存后需重启后端生效。
   */
  async saveEnvConfig(values: Record<string, string>): Promise<EnvSaveResponse> {
    const response = await fetch(`${this.baseUrl}/api/env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`保存配置失败: ${response.status} ${detail}`);
    }
    return await response.json();
  }

  // ============ 后端启动管理(通过 Vite dev server 插件) ============
  //
  // 这三个方法请求的是 Vite dev server 的 /api/dev/backend/* 端点,不是 Python 后端。
  // 所以用同源相对 URL(没带 baseUrl),浏览器会访问到 :3000 上的 Vite 插件中间件。

  /** 探测后端是否运行 */
  async getBackendStatus(): Promise<BackendStatus> {
    const resp = await fetch('/api/dev/backend/status');
    if (!resp.ok) throw new Error(`状态探测失败: ${resp.status}`);
    return resp.json();
  }

  /**
   * 启动后端。SSE 流式推送进度事件。
   * @param values BackendLauncher 表单里所有字段的当前值(空字符串会被插件跳过不写 .env)。
   *               至少要包含非空的 WIKI_RAW_PATH,否则启动会失败。
   * @param onEvent 每条 SSE 事件回调
   */
  async startBackend(
    values: Record<string, string>,
    onEvent: (ev: BackendStartEvent) => void
  ): Promise<void> {
    const resp = await fetch('/api/dev/backend/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`启动失败: ${resp.status} ${resp.statusText}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as BackendStartEvent);
        } catch {
          // ignore parse error on partial/malformed lines
        }
      }
    }
  }

  /**
   * 读取 server/.env 当前值(走 Vite dev 插件,后端未启动时也可用)。
   * BackendLauncher 挂载时用它预填表单。返回的 values 是原始值(secret 未 mask)。
   */
  async getDevEnv(): Promise<DevEnvResponse> {
    const resp = await fetch('/api/dev/env');
    if (!resp.ok) throw new Error(`读取 .env 失败: ${resp.status}`);
    return resp.json();
  }

  /** 停止本插件 spawn 的后端(外部启动的不会被停) */
  async stopBackend(): Promise<{ stopped: boolean; reason?: string; pid?: number }> {
    const resp = await fetch('/api/dev/backend/stop', { method: 'POST' });
    return resp.json();
  }

  /**
   * 重启后端(保存 .env 后让新配置生效)。SSE 流式推送进度。
   * 内部流程: 停止当前 spawn 的子进程 → 等端口释放 → 从 .env 读 SOURCE_ROOT_PATH → 重新 spawn。
   * 如果端口被外部进程占用(非本插件启动的),不会乱 kill,会返回 external=true。
   */
  async restartBackend(onEvent: (ev: BackendRestartEvent) => void): Promise<void> {
    const resp = await fetch('/api/dev/backend/restart', { method: 'POST' });
    if (!resp.ok || !resp.body) {
      throw new Error(`重启失败: ${resp.status} ${resp.statusText}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as BackendRestartEvent);
        } catch {
          // 忽略部分/格式错误行
        }
      }
    }
  }

  /**
   * 列出指定目录下的子目录(供前端目录选择器用,走后端 API)。
   * @param path 目录绝对路径,'~' 解析为 $HOME,空字符串等价于 '~'
   */
  async browseDirectory(path: string = '~'): Promise<FsBrowseResponse> {
    const url = `${this.baseUrl}/api/fs/browse?path=${encodeURIComponent(path)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`浏览目录失败: ${response.status} ${detail}`);
    }
    return await response.json();
  }

  /**
   * 走 Vite dev 插件的目录浏览接口(后端未启动时可用)。
   * 返回结构与 browseDirectory 完全一致。
   */
  async browseDirectoryViaDev(path: string = '~'): Promise<FsBrowseResponse> {
    const url = `/api/dev/fs/browse?path=${encodeURIComponent(path)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`浏览目录失败: ${response.status} ${detail}`);
    }
    return await response.json();
  }

  async qaQuery(
    pagePath: string,
    userQuery: string,
    onProgress?: (message: string) => void,
    onClarify?: (question: string, options: string[], multiSelect?: boolean) => Promise<string>,
    resumeSessionId?: string
  ): Promise<QaQueryResult> {
    const request: Record<string, unknown> = { page_path: pagePath, user_query: userQuery };
    if (resumeSessionId) {
      request.resume_session_id = resumeSessionId;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/qa_query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let result: QaQueryResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);
            if (event.type === 'progress') {
              onProgress?.(event.message);
            } else if (event.type === 'clarification') {
              console.log('[CodeNexus Service] QA 需要澄清:', event.question);
              onProgress?.(`🤔 AI 提问: ${event.question}`);
              if (onClarify) {
                const clarifyAnswer = await onClarify(event.question, event.options || [], event.multi_select || false);
                await fetch(`${this.baseUrl}/api/clarification_answer`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    session_key: event.session_key,
                    answer: clarifyAnswer
                  })
                });
                onProgress?.('已提交回答，AI 继续分析...');
              }
            } else if (event.type === 'result') {
              result = {
                answer: event.answer ?? '',
                session_id: event.session_id,
                insert_blocks: event.insert_blocks ?? [],
                delete_blocks: event.delete_blocks ?? [],
                replace_blocks: event.replace_blocks ?? [],
                insert_sources: event.insert_sources ?? [],
                delete_sources: event.delete_sources ?? [],
              };
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== payload) throw e;
          }
        }
      }

      if (!result || !result.answer) throw new Error('未收到回答');
      return result;
    } catch (error) {
      console.error('问答查询失败:', error);
      throw new Error(`问答查询失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 清理 Claude CLI session 的本地存储文件（fire-and-forget）
   */
  cleanupSession(sessionId: string): void {
    fetch(`${this.baseUrl}/api/cleanup_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    }).catch(err => console.warn('Session 清理失败（不影响功能）:', err));
  }

  /**
   * 全库搜索 wiki 内容
   */
  async searchWiki(query: string): Promise<Array<{ page_path: string; block_id: string; preview: string }>> {
    if (!query.trim()) return [];
    try {
      const response = await fetch(`${this.baseUrl}/api/search_wiki?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('搜索失败:', error);
      return [];
    }
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
      console.error('连接测试失败:', error);
      return false;
    }
  }
}

// 导出单例
export const codenexusWikiService = new CodeNexusWikiService();
