
import { GoogleGenAI } from "@google/genai";
import mermaid from 'mermaid';
import { AnalysisType, WikiBlock, BlockOperation } from "../types";

// Initialize mermaid for syntax validation (no rendering needed here)
mermaid.initialize({
  startOnLoad: false,
  suppressErrorRendering: true,
  securityLevel: 'loose',
});

const REPO_CONTEXT = `
项目名称: CloudMart (Java Spring Cloud 微服务示例)
技术栈: Java 17, Spring Boot 3, Spring Cloud (Gateway, Eureka, OpenFeign), Docker, Kubernetes, MySQL, Redis.

模块列表:
1. cloudmart-gateway: API 网关, 认证鉴权 (JWT).
2. cloudmart-user: 用户管理, 个人资料, 地址管理.
3. cloudmart-product: 商品目录, 库存查询 (与库存服务交互).
4. cloudmart-order: 订单处理, 状态机 (已创建 -> 已支付 -> 已发货).
   - OrderController.java: 订单接口
   - OrderService.java: 订单业务逻辑
5. cloudmart-payment: 支付集成 (模拟 Stripe/PayPal).
6. cloudmart-inventory: 库存管理, 库存锁定机制.
   - InventoryService.java: 库存核心逻辑

核心业务流程:
- 下单流程: 用户创建订单 -> 验证库存 -> 锁定库存 -> 创建支付凭证 -> 确认支付 -> 更新订单状态.
- 搜索流程: 基于 Redis 缓存的商品目录搜索.

架构模式:
- 熔断器 (Circuit Breaker - Resilience4j)
- 分布式链路追踪 (Micrometer/Zipkin)
- 事件驱动 (Kafka 处理订单创建事件)
`;

const SYSTEM_INSTRUCTION = `
你是一位资深技术架构师和代码分析专家。
你的任务是基于给定的代码库上下文，根据用户的具体指令生成专业的 WIKI 文档。
请严格遵循以下规则：
1. **必须使用中文（简体）回答**。
2. **必须使用 Markdown 格式** 进行排版。
3. **标题严禁包含序号**：
   - ✅ 正确: \`# 核心架构\`, \`## 订单流程\`
   - ❌ 错误: \`# 1. 核心架构\`, \`## 2.1 订单流程\`
   - 原因：WIKI 系统会自动处理章节编号。
4. **必须使用 Mermaid.js 语法** 绘制图表。
   - Mermaid 代码块必须包裹在 \`\`\`mermaid \n ... \n \`\`\` 中。
   - **Mermaid 语法严禁使用导致解析错误的写法**：
     - **Rule 1 (Flowchart 节点)**: 所有的节点 Label 必须且只能用双引号包裹字符串。
       - ✅ 正确: \`nodeA["用户下单"]\`, \`nodeB["检查库存(Inventory)"]\`
       - ❌ 错误: \`nodeA[用户下单]\`, \`nodeB[检查库存]\` (禁止不加引号)
     - **Rule 2 (Sequence Diagram)**: \`activate\` 和 \`deactivate\` 必须严格成对。如果不确定激活状态，请不要使用 activate/deactivate。

5. **源代码映射 (Source Code Mapping) - 重要**:
   - 每当你生成一个 Mermaid 图表后，你**必须**紧接着生成一个特殊的 JSON 代码块，用于映射图表中的节点到源代码文件。
   - 代码块语言标记为 \`json\`，且 JSON 内容必须包含 \`sourceMapping\` 键。
   - 格式示例：
     \`\`\`mermaid
     graph TD
       A["创建订单(OrderService)"] --> B["锁定库存(InventoryService)"]
     \`\`\`
     \`\`\`json
     {
       "sourceMapping": {
         "A": { "file": "cloudmart-order/src/main/java/com/cloudmart/order/service/OrderService.java", "line": 15 },
         "B": { "file": "cloudmart-inventory/src/main/java/com/cloudmart/inventory/service/InventoryService.java", "line": 20 }
       }
     }
     \`\`\`
   - 请尽量根据 \`REPO_CONTEXT\` 猜测合理的文件路径和行号。

6. **Refine Blocks (Refine Mode) 特殊规则**:
   - 当处于 Refine Mode 时，你的输出必须是一个 JSON 对象。
   - JSON 对象必须包含 "operations" 数组。
   - **顺序至关重要**：operations 数组中的顺序就是执行顺序。
   - **插入逻辑**：如果你对同一个 targetId 执行多次 INSERT_AFTER，请确保按照你希望它们出现的顺序排列。例如先插入段落，再插入图表，数组中就应该是 [段落Op, 图表Op]。

输出风格要求专业、清晰，类似高质量的技术文档网站。
`;

export const AVAILABLE_MODELS = [
  { id: 'codenexus-wiki', name: 'CodeNexus Wiki' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' }
];

export const SUGGESTIONS: Record<AnalysisType, string[]> = {
  [AnalysisType.DASHBOARD]: [
    "生成当前系统的整体健康状况报告",
    "列出代码量(LOC)最多的前三个模块",
    "分析当前系统的技术债务和改进点",
    "统计各模块的单元测试覆盖率估算",
    "识别系统中可能存在的单点故障",
    "分析提交记录最活跃的开发时段",
    "生成项目依赖库的许可证合规性概览",
    "评估系统的可扩展性瓶颈",
    "列出近期修复的 Critical 级别 Bug",
    "概括当前架构的主要设计原则"
  ],
  [AnalysisType.ARCHITECTURE]: [
    "生成高层架构概览图 (C4 Container)",
    "分析 Gateway 网关的路由与鉴权策略",
    "展示 Order 服务与 Inventory 服务的交互关系",
    "列出所有使用的中间件及其用途",
    "绘制微服务之间的依赖关系矩阵",
    "分析配置中心(Config Server)的工作机制",
    "解释服务发现(Eureka)的注册流程",
    "评估当前架构对高并发场景的支持程度",
    "分析日志收集与监控的架构方案",
    "展示 Docker 容器化部署的拓扑结构"
  ],
  [AnalysisType.API_ANALYSIS]: [
    "列出 Order 服务的所有关键 REST 接口",
    "生成 '创建订单' 接口的时序图",
    "分析 User 服务的 API 数据契约定义",
    "检查潜在的 API 安全隐患 (OWASP Top 10)",
    "生成 Product 服务商品搜索接口的文档",
    "分析接口响应时间的 P99 延迟分布",
    "列出所有需要 JWT 鉴权的接口路径",
    "评估 API 版本控制策略 (v1 vs v2)",
    "分析接口幂等性设计的实现细节",
    "生成 Swagger/OpenAPI 规范片段"
  ],
  [AnalysisType.BUSINESS_FLOW]: [
    "分析‘端到端下单’的完整业务流程",
    "绘制订单状态流转图 (State Diagram)",
    "分析‘库存不足’时的异常处理流程",
    "梳理用户注册与登录的业务逻辑",
    "分析用户取消订单的后续补偿机制",
    "绘制退款流程的跨服务交互图",
    "分析优惠券核销的业务规则实现",
    "梳理购物车添加商品的逻辑流程",
    "分析用户修改收货地址的影响范围",
    "绘制定时任务触发的业务流程图"
  ],
  [AnalysisType.CONTROL_FLOW]: [
    "分析库存扣减的并发控制逻辑 (Redis Lock)",
    "分析支付成功回调的幂等性处理",
    "绘制订单服务的核心算法流程图",
    "分析网关层的异常熔断处理逻辑",
    "分析 Kafka 消息消费的重试机制",
    "追踪分布式事务的最终一致性实现",
    "分析缓存穿透/击穿的防护策略",
    "绘制限流算法(Rate Limiter)的执行流",
    "分析数据库死锁的潜在风险点",
    "代码级分析：用户密码加密与校验逻辑"
  ],
  [AnalysisType.DATABASE]: [
    "生成核心业务表 (User, Order, Product) 的 ER 图",
    "分析 Order 表的索引设计与优化建议",
    "解释数据一致性方案 (最终一致性)",
    "列出所有外键约束关系",
    "分析 Redis 中存储的数据结构设计",
    "评估数据库分库分表的必要性",
    "分析历史订单数据的归档策略",
    "检查是否存在 N+1 查询性能问题",
    "生成数据库表结构的变更日志摘要",
    "分析敏感字段(PII)的存储加密方案"
  ],
};

class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  getSuggestions(type: AnalysisType): string[] {
    return SUGGESTIONS[type] || [];
  }
  
  private resolveModel(modelId: string): string {
    if (modelId === 'gpt-4o') return 'gemini-3-pro-preview';
    if (modelId === 'gpt-3.5-turbo') return 'gemini-2.5-flash';
    return modelId;
  }

  private async validateMermaidSyntax(content: string, onProgress?: (step: string) => void): Promise<string | null> {
    const regex = /```mermaid\n([\s\S]*?)\n```/g;
    let match;
    let count = 0;
    while ((match = regex.exec(content)) !== null) {
      count++;
      const code = match[1];
      try {
        onProgress?.(`正在校验第 ${count} 个 Mermaid 图表语法...`);
        await mermaid.parse(code);
      } catch (error) {
        console.warn("Mermaid Syntax Validation Error:", error);
        return (error as Error).message;
      }
    }
    return null;
  }

  // --- 1. Full Analysis Generation ---
  async analyze(
    type: AnalysisType, 
    userInstruction: string, 
    modelId: string,
    onProgress?: (step: string) => void
  ): Promise<string> {
    const resolvedModel = this.resolveModel(modelId);
    const fullPrompt = `
    ${REPO_CONTEXT}
    当前分析模块: ${type}
    用户指令: ${userInstruction}
    请根据上述上下文和用户指令，生成详细的 WIKI 文档内容。
    注意：如果你生成了 Mermaid 图表，必须在后面紧跟一个 sourceMapping JSON 块。
    `;

    let generatedText = "";

    try {
      onProgress?.(`构建代码库上下文...`);
      await new Promise(resolve => setTimeout(resolve, 500)); // Fake delay for UX

      onProgress?.('请求智能引擎进行分析...');
      const response = await this.ai.models.generateContent({
        model: resolvedModel,
        contents: fullPrompt,
        config: { systemInstruction: SYSTEM_INSTRUCTION }
      });
      generatedText = response.text || "未能生成分析结果。";
      
      onProgress?.(`接收到响应，正在解析内容结构...`);

      // Retry loop for validation
      let retries = 0;
      const MAX_RETRIES = 3;
      let validationError = await this.validateMermaidSyntax(generatedText, onProgress);

      while (retries < MAX_RETRIES && validationError) {
        onProgress?.(`发现 Mermaid 语法错误，尝试自动修复 (第 ${retries + 1} 次)...`);
        console.log(`Attempting to fix Mermaid syntax error (Try ${retries + 1})...`);
        const fixPrompt = `
        Critical Error: The Mermaid code in your previous response is invalid.
        Error Details: ${validationError}
        Please REWRITE the entire response with corrected Mermaid syntax.
        Remember: Double quotes for labels, balanced activate/deactivate.
        `;
        const fixResponse = await this.ai.models.generateContent({
            model: resolvedModel,
            contents: [
                { role: 'user', parts: [{ text: fullPrompt }] },
                { role: 'model', parts: [{ text: generatedText }] },
                { role: 'user', parts: [{ text: fixPrompt }] }
            ],
            config: { systemInstruction: SYSTEM_INSTRUCTION }
        });
        if (fixResponse.text) {
            generatedText = fixResponse.text;
            validationError = await this.validateMermaidSyntax(generatedText, onProgress);
        }
        retries++;
      }

      if (validationError) {
          throw new Error(`Mermaid 图表语法错误，且经过多次自动修复仍失败。错误详情: ${validationError}`);
      }

      onProgress?.(`分析完成，准备渲染...`);
      return generatedText;
    } catch (error) {
      console.error("Gemini API Error:", error);
      throw error; 
    }
  }

  // --- 2. Atomic Block Update ---
  async refineBlocks(
    referencedBlocks: WikiBlock[], 
    instruction: string,
    modelId: string,
    onProgress?: (step: string) => void
  ): Promise<BlockOperation[]> {
    const resolvedModel = this.resolveModel(modelId);
    
    onProgress?.(`加载引用对象上下文 (${referencedBlocks.length} blocks)...`);

    // Enhance context with Type and Content
    const blocksContext = referencedBlocks.map(b => 
      `[BLOCK_ID: ${b.id}] [TYPE: ${b.type}]${b.level ? ` [LEVEL: ${b.level}]` : ''}\n${b.content}`
    ).join('\n\n----------------\n\n');

    const prompt = `
    ${REPO_CONTEXT}

    CONTEXT (The user is referencing these specific parts of the WIKI):
    ${blocksContext}

    USER INSTRUCTION: "${instruction}"

    TASK:
    Based on the instruction, generate a list of operations to modify the WIKI structure.
    
    IMPORTANT RULES:
    1. Return ONLY a valid JSON object with a key "operations".
    2. **Sequence Matters**: The order of operations in the JSON array IS the order they will be executed.
    3. **Insertion Order**: If multiple blocks are inserted after the same ID, they will appear in the document in the exact order they appear in the JSON array.
    4. **No Numbers in Headings**: If inserting a heading, do NOT include numbers like "1.2". Just "Title".
    5. **Mermaid Syntax**: Ensure Flowchart labels have double quotes.
    6. **Heading Levels**: If inserting a 'heading', you MUST provide a 'level' (1-6) that fits the hierarchy.
    7. **Mermaid Mapping**: If inserting 'mermaid', you generally cannot attach metadata in this JSON mode easily, but make sure the mermaid syntax is perfect.
    
    Expected JSON Format:
    {
      "operations": [
        { "action": "UPDATE", "targetId": "...", "content": "New content..." },
        { "action": "INSERT_AFTER", "targetId": "...", "type": "paragraph", "content": "First new paragraph..." },
        { "action": "INSERT_AFTER", "targetId": "...", "type": "mermaid", "content": "graph TD..." }
      ]
    }
    `;

    try {
      onProgress?.('发送优化指令...');
      const response = await this.ai.models.generateContent({
        model: resolvedModel,
        contents: prompt,
        config: { 
            responseMimeType: "application/json",
            systemInstruction: SYSTEM_INSTRUCTION 
        }
      });

      const resultText = response.text || "{}";
      
      onProgress?.(`解析操作指令...`);
      // Parse JSON
      const result = JSON.parse(resultText);
      
      return result.operations || [];
    } catch (error) {
      console.error("Refine Blocks Error:", error);
      return [];
    }
  }
}

export const geminiService = new GeminiService();
