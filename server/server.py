from typing import List, Dict, Any
import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import os

# 添加父目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

# 导入后端 mock 函数（待替换为实际实现）
from backend_mock import (
    execute_workflow_mock,
    fetch_page_mock,
    detailed_query_mock,
    expand_query_mock
)

# 导入实际的 expand_query 实现
#from fy.intent_understand.expand_query import expand_user_query

# 创建 FastAPI 应用实例
app = FastAPI(
    title="Java Wiki API",
    description="Wiki 生成服务 API",
    version="1.0.0",
)

# 配置 CORS 中间件，允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 请求/响应模型定义 ====================

class Question(BaseModel):
    """扩展问题模型"""
    id: str = Field(..., description="问题唯一标识")
    query: str = Field(..., description="扩展后的问题内容")
    search_keywords_cn: List[str] = Field(..., description="中文搜索关键词")
    search_keywords_en: List[str] = Field(..., description="英文搜索关键词")
    targets: List[str] = Field(..., description="目标类型列表")


class UserQueryRequest(BaseModel):
    """用户查询请求模型（统一入口）"""
    user_query: str = Field(..., description="用户的原始查询")
    selected_questions: List[Question] | None = Field(
        default=None, description="用户选择的扩展问题子集（可选）"
    )


class ExpandQueryResponse(BaseModel):
    """扩展查询响应模型"""
    questions: List[Question] = Field(..., description="生成的扩展问题列表")


class ExecuteWorkflowResponse(BaseModel):
    """执行工作流响应模型"""
    wiki_root: str = Field(..., description="生成的 Wiki 根目录路径")
    wiki_pages: List[str] = Field(..., description="Wiki 页面路径列表")


class FetchPageRequest(BaseModel):
    """获取页面请求模型"""
    page_path: str = Field(..., description="页面文件路径")


class PageSource(BaseModel):
    """页面来源模型"""
    source_id: str = Field(..., description="来源唯一标识")
    name: str = Field(..., description="文件名")
    lines: List[str] = Field(..., description="行号范围列表")


class FetchPageResponse(BaseModel):
    """获取页面响应模型"""
    content: List[Dict[str, Any]] = Field(..., description="页面内容")
    source: List[PageSource] = Field(..., description="页面来源列表")


class DetailedQueryRequest(BaseModel):
    """详细查询请求模型"""
    page_path: str = Field(..., description="当前页面路径")
    block_ids: List[str] = Field(..., description="用户选中的 block ID 列表")
    user_query: str = Field(..., description="用户的查询指令")


class InsertBlock(BaseModel):
    """插入块模型"""
    after_block: str = Field(..., description="在此 block 之后插入")
    block: Dict[str, Any] = Field(..., description="要插入的 block 内容")


class PageDiffResponse(BaseModel):
    """页面差异响应模型（修改当前页面）"""
    insert_blocks: List[InsertBlock] = Field(default=[], description="要插入的 block 列表")
    delete_blocks: List[str] = Field(default=[], description="要删除的 block ID 列表")
    insert_sources: List[PageSource] = Field(default=[], description="要插入的来源列表")
    delete_sources: List[str] = Field(default=[], description="要删除的来源 ID 列表")


class CreatePageResponse(BaseModel):
    """新建页面响应模型"""
    new_page_path: str = Field(..., description="新页面路径")
    new_page: FetchPageResponse = Field(..., description="新页面内容")


# ==================== API 路由 ====================

@app.post("/api/user_query")
async def user_query(
    request: UserQueryRequest,
) -> ExpandQueryResponse | ExecuteWorkflowResponse:
    """
    用户查询统一入口

    根据请求体判断执行逻辑：
    - 无 selected_questions：执行 expand_query，返回扩展问题列表
    - 有 selected_questions：执行 workflow，返回 Wiki 路径
    """
    if request.selected_questions is None:
        try:
            print(f"收到扩展查询请求: {request.user_query}")
            #result = expand_user_query(request.user_query)
            result = expand_query_mock(request.user_query)
            print(f"扩展查询结果: {result}")
            return ExpandQueryResponse(questions=result)
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"扩展查询失败: {str(e)}")
    else:
        try:
            print(f"收到执行工作流请求: {request.user_query} with {len(request.selected_questions)} questions")
            result = execute_workflow_mock(
                request.user_query,
                request.selected_questions,
                #os.environ.get("WIKI_ROOT_PATH", "user_data/wiki_demo/")
                wiki_root=os.environ.get("WIKI_ROOT_PATH", "")
            )
            return ExecuteWorkflowResponse(**result)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"工作流执行失败: {str(e)}")


@app.post("/api/fetch_page", response_model=FetchPageResponse)
async def fetch_page(request: FetchPageRequest) -> FetchPageResponse:
    """
    获取 Wiki 页面内容

    根据页面路径读取对应的 JSON 文件并返回页面内容。
    """
    try:
        page_data = fetch_page_mock(
            request.page_path,
            wiki_root=os.environ.get("WIKI_ROOT_PATH", "")
        )
        return FetchPageResponse(**page_data)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="页面不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取页面失败: {str(e)}")


@app.post("/api/detailed_query")
async def detailed_query(
    request: DetailedQueryRequest,
) -> PageDiffResponse | CreatePageResponse:
    """
    详细查询接口

    用户选中若干 block 并输入指令，后端根据这些信息细化 wiki 内容。
    返回两种格式之一：
    - PageDiffResponse：修改当前页面的 block
    - CreatePageResponse：新增页面并返回页面内容
    """
    try:
        result = detailed_query_mock(request.page_path, request.block_ids, request.user_query)
        if "new_page_path" in result:
            return CreatePageResponse(**result)
        else:
            return PageDiffResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"详细查询失败: {str(e)}")


# ==================== 启动入口 ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=11219)
