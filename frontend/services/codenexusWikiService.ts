import {
  UserQueryRequest,
  ExpandQueryResponse,
  ExecuteWorkflowResponse,
  FetchPageRequest,
  FetchPageResponse,
  DetailedQueryRequest,
  ModifyPageResponse,
  NewPageResponse,
  ExpandedQuestion,
  WikiPage
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
    userQuery: string
  ): Promise<ModifyPageResponse | NewPageResponse> {
    const request: DetailedQueryRequest = {
      page_path: pagePath,
      block_ids: blockIds,
      user_query: userQuery
    };

    console.log('[CodeNexus Service] 调用 detailedQuery API:', {
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

      const data = await response.json();

      console.log('[CodeNexus Service] detailedQuery API 响应数据:', data);

      // 根据返回的字段判断是修改页面还是新增页面
      if ('new_page_path' in data) {
        console.log('[CodeNexus Service] 响应类型: NewPageResponse (新增页面)');
        return data as NewPageResponse;
      } else {
        console.log('[CodeNexus Service] 响应类型: ModifyPageResponse (修改页面)');
        return data as ModifyPageResponse;
      }
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
