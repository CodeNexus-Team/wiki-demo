from typing import List, Dict, Any, Optional
from uuid import uuid4
import sys
import json
import asyncio
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import os
from dotenv import load_dotenv

# 加载 .env 环境变量
load_dotenv(Path(__file__).parent / ".env")

# 添加父目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

# 导入后端 mock 函数（待替换为实际实现）
from backend_mock import (
    execute_workflow_mock,
    detailed_query_mock,
    expand_query_mock
)
from agent import run_detailed_query, run_qa_query, cleanup_session

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
    block_ids: List[str] = Field(default_factory=list, description="用户选中的 block ID 列表")
    user_query: str = Field(..., description="用户的查询指令")
    resume_session_id: Optional[str] = Field(None, description="恢复之前会话的 session_id（追问时使用）")


class QaQueryRequest(BaseModel):
    """自由问答请求模型"""
    page_path: str = Field(..., description="当前页面路径")
    user_query: str = Field(..., description="用户的问题")
    resume_session_id: Optional[str] = Field(None, description="恢复之前会话的 session_id（追问时使用）")


class ClarificationAnswerRequest(BaseModel):
    """澄清回答请求模型"""
    session_key: str = Field(..., description="SSE 返回的会话标识")
    answer: str = Field(..., description="用户对澄清问题的回答")


# 全局：等待用户回答的 Future 字典
_pending_clarifications: Dict[str, asyncio.Future] = {}


class InsertBlock(BaseModel):
    """插入块模型"""
    after_block: str = Field(..., description="在此 block 之后插入")
    block: Dict[str, Any] = Field(..., description="要插入的 block 内容")


class ReplaceBlock(BaseModel):
    """替换块模型"""
    target: str = Field(..., description="要替换的 block ID")
    new_content: Dict[str, Any] = Field(..., description="新的内容，如 {markdown: '...'}")
    source_ids: List[str] = Field(default=[], description="关联的源码 ID 列表")


class PageDiffResponse(BaseModel):
    """页面差异响应模型（修改当前页面）"""
    insert_blocks: List[InsertBlock] = Field(default=[], description="要插入的 block 列表")
    delete_blocks: List[str] = Field(default=[], description="要删除的 block ID 列表")
    replace_blocks: List[ReplaceBlock] = Field(default=[], description="要原地替换的 block 列表")
    insert_sources: List[PageSource] = Field(default=[], description="要插入的来源列表")
    delete_sources: List[str] = Field(default=[], description="要删除的来源 ID 列表")


class CreatePageResponse(BaseModel):
    """新建页面响应模型"""
    new_page_path: str = Field(..., description="新页面路径")
    new_page: FetchPageResponse = Field(..., description="新页面内容")


class ApplyChangesRequest(BaseModel):
    """应用变更请求模型"""
    page_path: str = Field(..., description="当前页面路径")
    page_diff: PageDiffResponse = Field(..., description="要应用的变更")


# ==================== 文件操作函数（真实实现） ====================

def fetch_page(page_path: str, wiki_root: str) -> Dict[str, Any]:
    """
    获取 Wiki 页面内容

    Args:
        page_path: 页面路径
        wiki_root: wiki 根目录

    Returns:
        包含 content 和 source 的字典
    """
    # 去掉前导斜杠，避免 os.path.join 将其视为绝对路径
    page_path = page_path.lstrip('/')

    # 构建完整路径
    if os.path.isabs(wiki_root):
        json_path = os.path.join(wiki_root, page_path)
    else:
        json_path = os.path.join(os.path.dirname(__file__), wiki_root, page_path)

    print(f"Fetching page from: {json_path}")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    return {
        "content": data['markdown_content'],
        "source": data['source_id'],
    }


def apply_changes(page_path: str, page_diff: Dict[str, Any], wiki_root: str) -> Dict[str, Any]:
    """
    应用变更到页面文件

    Args:
        page_path: 页面路径
        page_diff: 变更内容，包含 insert_blocks, delete_blocks, insert_sources, delete_sources
        wiki_root: wiki 根目录

    Returns:
        操作结果
    """
    # 读取当前页面内容
    page_path_clean = page_path.lstrip('/')
    if os.path.isabs(wiki_root):
        json_path = os.path.join(wiki_root, page_path_clean)
    else:
        json_path = os.path.join(os.path.dirname(__file__), wiki_root, page_path_clean)

    with open(json_path, 'r', encoding='utf-8') as f:
        page_data = json.load(f)

    blocks = page_data.get('markdown_content', [])

    # 1. 原地替换 replace_blocks（直接更新目标 block 的内容，不改变树结构）
    def replace_block_content(block_list: list, target_id: str, new_content: dict, source_ids: list) -> bool:
        for block in block_list:
            if block.get("id") == target_id:
                # 保留 block 的 type/id/title 等元数据，只替换内容
                if block.get("type") == "text":
                    block["content"] = new_content
                    if source_ids:
                        block["source_id"] = source_ids
                elif block.get("type") == "section":
                    # section 块：替换其子内容为一个新的 text block
                    block["content"] = [{
                        "type": "text",
                        "id": f"NEW_{target_id}",
                        "content": new_content,
                        "source_id": source_ids,
                    }]
                return True
            children = block.get("content")
            if isinstance(children, list):
                if replace_block_content(children, target_id, new_content, source_ids):
                    return True
        return False

    for replace_item in page_diff.get("replace_blocks", []):
        target_id = replace_item["target"]
        success = replace_block_content(
            blocks,
            replace_item["target"],
            replace_item["new_content"],
            replace_item.get("source_ids", []),
        )
        print(f"  replace {target_id}: {'成功' if success else '未找到目标block'}")

    # 2. 插入 insert_blocks
    # 与前端逻辑一致：
    # - 如果目标块是 section 类型：新块作为第一个子节点插入
    # - 如果目标块是非 section 类型：新块作为下一个兄弟节点插入
    def insert_after_block(block_list: list, after_id: str, new_block: dict) -> bool:
        for i, block in enumerate(block_list):
            if block.get("id") == after_id:
                if block.get("type") == "section":
                    if "content" not in block or not isinstance(block["content"], list):
                        block["content"] = []
                    block["content"].insert(0, new_block)
                else:
                    block_list.insert(i + 1, new_block)
                return True
            if "content" in block and isinstance(block["content"], list):
                if insert_after_block(block["content"], after_id, new_block):
                    return True
        return False

    for insert_item in page_diff.get("insert_blocks", []):
        after_id = insert_item["after_block"]
        new_block = insert_item["block"]
        insert_after_block(blocks, after_id, new_block)

    # 2. 再删除 delete_blocks
    delete_ids = set(page_diff.get("delete_blocks", []))

    def remove_blocks(block_list: list, ids_to_remove: set) -> list:
        result = []
        for block in block_list:
            if block.get("id") not in ids_to_remove:
                if "content" in block and isinstance(block["content"], list):
                    block["content"] = remove_blocks(block["content"], ids_to_remove)
                result.append(block)
        return result

    blocks = remove_blocks(blocks, delete_ids)

    # 3. 更新 sources
    sources = page_data.get("source_id", [])
    delete_source_ids = set(page_diff.get("delete_sources", []))
    sources = [s for s in sources if s.get("source_id") not in delete_source_ids]
    sources.extend(page_diff.get("insert_sources", []))

    # 4. 保存修改后的文件
    page_data["markdown_content"] = blocks
    page_data["source_id"] = sources

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(page_data, f, ensure_ascii=False, indent=2)

    print(f"Applied changes to: {json_path}")
    return {
        "success": True,
        "message": f"变更已应用到 {page_path}",
        "updated_path": json_path
    }


# ==================== 文件扫描函数 ====================

def list_wiki_pages(wiki_root: str) -> List[Dict[str, Any]]:
    """
    扫描 wiki_result 目录，返回树状结构的 wiki 列表
    复用 execute_workflow_mock 中的扫描逻辑，但返回树形结构
    """
    if os.path.isabs(wiki_root):
        base_dir = wiki_root
    else:
        base_dir = os.path.join(os.path.dirname(__file__), wiki_root)

    if not os.path.isdir(base_dir):
        return []

    def build_tree(dir_path: str, rel_prefix: str = "") -> List[Dict[str, Any]]:
        items = []
        try:
            entries = sorted(os.listdir(dir_path))
        except OSError:
            return items

        for entry in entries:
            # 跳过隐藏目录/文件（如 .index/.meta）
            if entry.startswith("."):
                continue

            full_path = os.path.join(dir_path, entry)
            rel_path = os.path.join(rel_prefix, entry) if rel_prefix else entry

            if os.path.isdir(full_path):
                children = build_tree(full_path, rel_path)
                items.append({
                    "name": entry,
                    "path": rel_path,
                    "type": "directory",
                    "children": children,
                })
            elif entry.endswith(".json"):
                items.append({
                    "name": entry[:-5],
                    "path": rel_path,
                    "type": "file",
                })
        return items

    return build_tree(base_dir)


# ==================== API 路由 ====================

@app.get("/api/list_wikis")
async def list_wikis_api() -> List[Dict[str, Any]]:
    """
    获取所有已生成的 Wiki 列表（树状结构）
    """
    try:
        wiki_root = os.environ.get("WIKI_ROOT_PATH", "")
        return list_wiki_pages(wiki_root)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取 Wiki 列表失败: {str(e)}")


@app.get("/api/wiki_index")
async def wiki_index_api() -> Dict[str, Any]:
    """
    获取 wiki_index.json 总览数据。
    返回 LLM 生成的页面摘要、关键词、跨页引用等元信息，
    供前端总览页和 AI 路由使用。
    """
    try:
        wiki_root = os.environ.get("WIKI_ROOT_PATH", "")
        if os.path.isabs(wiki_root):
            base_dir = wiki_root
        else:
            base_dir = os.path.join(os.path.dirname(__file__), wiki_root)
        index_path = os.path.join(base_dir, ".index", "wiki_index.json")

        if not os.path.isfile(index_path):
            raise HTTPException(status_code=404, detail="wiki_index.json 不存在，请先运行 build_wiki_index.py 生成")

        with open(index_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取 wiki_index 失败: {str(e)}")


@app.get("/api/search_wiki")
async def search_wiki_api(q: str) -> List[Dict[str, Any]]:
    """
    全库搜索 wiki 内容，返回包含搜索词的 block 列表。
    """
    if not q.strip():
        return []

    wiki_root = os.environ.get("WIKI_ROOT_PATH", "")
    if os.path.isabs(wiki_root):
        base_dir = wiki_root
    else:
        base_dir = os.path.join(os.path.dirname(__file__), wiki_root)

    import glob as glob_mod

    results = []

    def make_preview(text: str, query: str, radius: int = 50) -> str:
        """以匹配词为中心截取上下文"""
        text_flat = text.replace("\n", " ")
        idx = text_flat.find(query)
        if idx == -1:
            return text_flat[:120]
        start = max(0, idx - radius)
        end = min(len(text_flat), idx + len(query) + radius)
        preview = text_flat[start:end]
        if start > 0:
            preview = "..." + preview
        if end < len(text_flat):
            preview = preview + "..."
        return preview

    def search_blocks(blocks: list, query: str, page_path: str):
        for block in blocks:
            # text block
            content = block.get("content")
            if isinstance(content, dict):
                md = content.get("markdown", "")
                if query in md:
                    results.append({
                        "page_path": page_path,
                        "block_id": block.get("id", ""),
                        "preview": make_preview(md, query),
                    })
            # section title
            title = block.get("title", "")
            if title and query in title:
                results.append({
                    "page_path": page_path,
                    "block_id": block.get("id", ""),
                    "preview": make_preview(title, query),
                })
            # recurse children
            children = block.get("content")
            if isinstance(children, list):
                search_blocks(children, query, page_path)

    pattern = os.path.join(base_dir, "**", "*.json")
    for json_file in glob_mod.glob(pattern, recursive=True):
        rel_path = os.path.relpath(json_file, base_dir)
        # 跳过隐藏目录（.index/.meta）下的文件
        if any(part.startswith(".") for part in rel_path.split(os.sep)):
            continue
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            page_content = data.get("markdown_content", [])
            search_blocks(page_content, q.strip(), rel_path)
        except Exception:
            continue

    return results


@app.get("/api/scan_wikis")
async def scan_wikis_api() -> ExecuteWorkflowResponse:
    """
    直接扫描 wiki 目录，返回 wiki_root 和所有页面路径（无需查询）
    """
    try:
        wiki_root = os.environ.get("WIKI_ROOT_PATH", "")

        if os.path.isabs(wiki_root):
            base_dir = wiki_root
        else:
            base_dir = os.path.join(os.path.dirname(__file__), wiki_root)

        import glob
        pattern = os.path.join(base_dir, "**", "*.json")
        json_files = glob.glob(pattern, recursive=True)
        # 排除隐藏目录（如 .index/.meta）下的文件
        wiki_pages = [
            os.path.relpath(f, base_dir)
            for f in json_files
            if not any(part.startswith(".") for part in os.path.relpath(f, base_dir).split(os.sep))
        ]

        return ExecuteWorkflowResponse(
            wiki_root=wiki_root,
            wiki_pages=wiki_pages,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"扫描 Wiki 目录失败: {str(e)}")


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
async def fetch_page_api(request: FetchPageRequest) -> FetchPageResponse:
    """
    获取 Wiki 页面内容

    根据页面路径读取对应的 JSON 文件并返回页面内容。
    """
    try:
        page_data = fetch_page(
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
):
    """
    详细查询接口（SSE 流式响应）

    通过 Server-Sent Events 实时推送进度，最后一个事件为完整结果。
    事件格式：
    - progress      : {"type": "progress",      "message": "..."}
    - clarification  : {"type": "clarification", "question": "...", "session_key": "..."}
    - result         : {"type": "result",        "data": { ... }}
    - error          : {"type": "error",         "message": "..."}
    """
    async def event_stream():
        progress_queue: asyncio.Queue = asyncio.Queue()

        def on_progress(msg: str):
            progress_queue.put_nowait(("progress", msg))

        async def on_clarify(clarify_data: dict) -> str:
            """当 Agent 需要澄清时调用：发送 SSE 事件（含选项），等待用户回答"""
            session_key = str(uuid4())
            future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
            _pending_clarifications[session_key] = future

            # 通过 queue 通知 SSE 流发送 clarification 事件（含 options）
            progress_queue.put_nowait(("clarification", clarify_data, session_key))

            # 阻塞等待用户通过 /api/clarification_answer 提交回答
            answer = await future
            _pending_clarifications.pop(session_key, None)
            return answer

        try:
            print(f"收到详细查询请求: page_path={request.page_path}, block_ids={request.block_ids}, "
                  f"user_query={request.user_query}, resume_session_id={request.resume_session_id}")
            wiki_root = os.environ.get("WIKI_ROOT_PATH", "")

            # Start the agent in a background task
            task = asyncio.create_task(run_detailed_query(
                request.page_path,
                request.block_ids,
                request.user_query,
                wiki_root=wiki_root,
                on_progress=on_progress,
                on_clarify=on_clarify,
                resume_session_id=request.resume_session_id,
            ))

            # Drain events while the agent is running
            while not task.done():
                try:
                    item = await asyncio.wait_for(progress_queue.get(), timeout=0.3)
                except asyncio.TimeoutError:
                    continue

                if isinstance(item, tuple) and item[0] == "clarification":
                    _, clarify_data, session_key = item
                    yield f"data: {json.dumps({'type': 'clarification', 'question': clarify_data['question'], 'options': clarify_data.get('options', []), 'multi_select': clarify_data.get('multi_select', False), 'session_key': session_key}, ensure_ascii=False)}\n\n"
                elif isinstance(item, tuple) and item[0] == "progress":
                    _, msg = item
                    yield f"data: {json.dumps({'type': 'progress', 'message': msg}, ensure_ascii=False)}\n\n"

            # Drain any remaining events
            while not progress_queue.empty():
                item = progress_queue.get_nowait()
                if isinstance(item, tuple) and item[0] == "progress":
                    _, msg = item
                    yield f"data: {json.dumps({'type': 'progress', 'message': msg}, ensure_ascii=False)}\n\n"

            result = task.result()
            print(f"详细查询结果: {result}")

            if "new_page_path" in result:
                # 写入新页面文件
                new_page_path = result["new_page_path"].lstrip("/")
                if os.path.isabs(wiki_root):
                    new_json_path = os.path.join(wiki_root, new_page_path)
                else:
                    new_json_path = os.path.join(os.path.dirname(__file__), wiki_root, new_page_path)

                os.makedirs(os.path.dirname(new_json_path), exist_ok=True)
                new_file_content = {
                    "markdown_content": result["new_page"]["content"],
                    "source_id": result["new_page"]["source"]
                }
                with open(new_json_path, 'w', encoding='utf-8') as f:
                    json.dump(new_file_content, f, ensure_ascii=False, indent=2)
                print(f"新页面已写入: {new_json_path}")

            yield f"data: {json.dumps({'type': 'result', 'data': result}, ensure_ascii=False)}\n\n"

        except TimeoutError as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'详细查询失败: {str(e)}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/clarification_answer")
async def clarification_answer(request: ClarificationAnswerRequest):
    """
    用户回答澄清问题。

    前端收到 SSE clarification 事件后，展示问题给用户，
    用户回答后 POST 到此端点，Agent 将在同一会话中继续执行。
    """
    future = _pending_clarifications.get(request.session_key)
    if not future:
        raise HTTPException(status_code=404, detail="没有待回答的澄清问题，可能已超时或已回答")
    future.set_result(request.answer)
    return {"status": "ok", "message": "回答已提交，Agent 将继续执行"}


class CleanupSessionRequest(BaseModel):
    """清理会话请求模型"""
    session_id: str = Field(..., description="要清理的 Claude CLI session ID")


@app.post("/api/cleanup_session")
async def cleanup_session_api(request: CleanupSessionRequest):
    """
    清理 Claude CLI session 的本地存储文件。
    仅允许清理本 agent 创建的 session，防止误删其他会话。
    """
    try:
        result = cleanup_session(request.session_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"清理 session 失败: {str(e)}")


@app.post("/api/qa_query")
async def qa_query(request: QaQueryRequest):
    """
    Wiki & 源码自由问答（SSE 流式响应）

    事件类型:
    - progress    : {"type": "progress", "message": "..."}
    - result      : {"type": "result", "answer": "..."}
    - error       : {"type": "error", "message": "..."}
    """
    async def event_stream():
        progress_queue: asyncio.Queue = asyncio.Queue()

        def on_progress(msg: str):
            progress_queue.put_nowait(("progress", msg))

        async def on_clarify(clarify_data: dict) -> str:
            """当 Agent 需要澄清时调用：发送 SSE 事件，等待用户回答"""
            session_key = str(uuid4())
            future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
            _pending_clarifications[session_key] = future

            progress_queue.put_nowait(("clarification", clarify_data, session_key))

            answer = await future
            _pending_clarifications.pop(session_key, None)
            return answer

        try:
            wiki_root = os.environ.get("WIKI_ROOT_PATH", "")

            task = asyncio.create_task(run_qa_query(
                request.page_path,
                request.user_query,
                wiki_root=wiki_root,
                on_progress=on_progress,
                on_clarify=on_clarify,
                resume_session_id=request.resume_session_id,
            ))

            while not task.done():
                try:
                    item = await asyncio.wait_for(progress_queue.get(), timeout=0.3)
                except asyncio.TimeoutError:
                    continue
                if isinstance(item, tuple) and item[0] == "clarification":
                    _, clarify_data, session_key = item
                    yield f"data: {json.dumps({'type': 'clarification', 'question': clarify_data['question'], 'options': clarify_data.get('options', []), 'multi_select': clarify_data.get('multi_select', False), 'session_key': session_key}, ensure_ascii=False)}\n\n"
                elif isinstance(item, tuple) and item[0] == "progress":
                    _, msg = item
                    yield f"data: {json.dumps({'type': 'progress', 'message': msg}, ensure_ascii=False)}\n\n"

            # Drain remaining progress
            while not progress_queue.empty():
                item = progress_queue.get_nowait()
                if isinstance(item, tuple) and item[0] == "progress":
                    _, msg = item
                    yield f"data: {json.dumps({'type': 'progress', 'message': msg}, ensure_ascii=False)}\n\n"

            qa_result = task.result()
            # 兼容新格式：可能包含 insert_blocks / delete_blocks / replace_blocks 作为建议修改
            result_payload = {
                "type": "result",
                "answer": qa_result.get("answer", ""),
                "session_id": qa_result.get("session_id"),
                "insert_blocks": qa_result.get("insert_blocks", []),
                "delete_blocks": qa_result.get("delete_blocks", []),
                "replace_blocks": qa_result.get("replace_blocks", []),
                "insert_sources": qa_result.get("insert_sources", []),
                "delete_sources": qa_result.get("delete_sources", []),
            }
            yield f"data: {json.dumps(result_payload, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'问答失败: {str(e)}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/apply_changes")
async def apply_changes_api(request: ApplyChangesRequest) -> Dict[str, Any]:
    """
    应用变更接口

    用户确认变更后，将 page_diff 应用到对应的页面文件。
    """
    try:
        page_diff_data = request.page_diff.model_dump()
        print(f"收到应用变更请求: page_path={request.page_path}, "
              f"replace_blocks={len(page_diff_data.get('replace_blocks', []))}, "
              f"insert_blocks={len(page_diff_data.get('insert_blocks', []))}, "
              f"delete_blocks={len(page_diff_data.get('delete_blocks', []))}")
        result = apply_changes(
            request.page_path,
            request.page_diff.model_dump(),
            wiki_root=os.environ.get("WIKI_ROOT_PATH", "")
        )
        print(f"应用变更结果: {result}")
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"应用变更失败: {str(e)}")


# ==================== .env 配置管理 ====================
#
# 给前端"生成 Wiki"界面提供 .env 编辑能力:
#   GET  /api/env       返回当前 .env 内容(secret 字段 mask 显示) + 字段 schema 供前端渲染表单
#   POST /api/env       接收前端提交的配置,原子覆盖写入 server/.env
#
# Secret 字段(API KEY / 密码)处理:
#   - GET 返回 preview (例如 "sk-••••bdef",只露首尾 4 个字符)
#   - POST 如果 secret 字段提交空字符串 → 保持原值不变(方便"不改 key 只改其他字段")
#   - POST 如果 secret 字段提交非空字符串 → 覆盖为新值

_ENV_FILE = Path(__file__).parent / ".env"

# .env 字段 schema——前端按此渲染表单。顺序决定 UI 顺序。
_ENV_SCHEMA = [
    # 核心组: wiki 生成必须
    {
        "name": "OPENAI_API_KEY",
        "label": "OpenAI API Key",
        "description": "wiki 生成必需。也可以是第三方兼容服务的 key。",
        "placeholder": "sk-...",
        "is_secret": True, "required": True, "group": "core",
    },
    {
        "name": "OPENAI_BASE_URL",
        "label": "OpenAI Base URL",
        "description": "可选。第三方兼容服务地址(如国内代理),留空则用官方。",
        "placeholder": "https://api.openai.com/v1",
        "is_secret": False, "required": False, "group": "core",
    },
    {
        "name": "OPENAI_MODEL",
        "label": "OpenAI Model",
        "description": "生成 wiki 索引时用的模型。默认 gpt-4o-mini。",
        "placeholder": "gpt-4o-mini",
        "is_secret": False, "required": False, "group": "core",
    },
    {
        "name": "SOURCE_ROOT_PATH",
        "label": "业务源码根目录",
        "description": "项目业务代码(Java / Python 等)的绝对路径。Claude CLI 的 Read 工具会从这里读源码,供 agent 回答问题或修改 wiki 时对照。和 Wiki 根目录是不同概念。",
        "placeholder": "/Users/you/code/your-project",
        "is_secret": False, "required": False, "group": "core",
        "type": "directory",
    },
    {
        "name": "WIKI_RAW_PATH",
        "label": "原始 Wiki 根目录",
        "description": "未转换的 wiki 根目录(含 .md / .meta.json)。启动时 launch.py 会把它转换到 <路径>/wiki_result。前端'启动后端'界面填写的就是这个。WIKI_ROOT_PATH 由此自动拼装,不需要单独配置。",
        "placeholder": "/Users/you/code/your-wiki",
        "is_secret": False, "required": True, "group": "core",
        "type": "directory",
    },
    # Neo4j 组: 可选功能
    {
        "name": "NEO4J_URI",
        "label": "Neo4j URI",
        "description": "可选。若配置图谱则填写 bolt:// 或 neo4j:// 地址。",
        "placeholder": "neo4j://127.0.0.1:7687",
        "is_secret": False, "required": False, "group": "neo4j",
    },
    {
        "name": "NEO4J_USER",
        "label": "Neo4j 用户名",
        "description": "默认 neo4j。",
        "placeholder": "neo4j",
        "is_secret": False, "required": False, "group": "neo4j",
    },
    {
        "name": "NEO4J_PASSWORD",
        "label": "Neo4j 密码",
        "description": "Neo4j 密码。",
        "placeholder": "",
        "is_secret": True, "required": False, "group": "neo4j",
    },
    # 高级组: 通常不需要改
    {
        "name": "CLAUDE_MODEL",
        "label": "Claude Model",
        "description": "Claude CLI 模型,可选 sonnet/opus/haiku。默认 sonnet。",
        "placeholder": "sonnet",
        "is_secret": False, "required": False, "group": "advanced",
    },
    {
        "name": "CLAUDE_MAX_TOKENS",
        "label": "Claude Max Tokens",
        "description": "Claude 单次输出 token 上限。默认 4096。",
        "placeholder": "4096",
        "is_secret": False, "required": False, "group": "advanced",
    },
    {
        "name": "MAX_TOOL_ROUNDS",
        "label": "Agent 最大工具轮次",
        "description": "Agent 在一次对话里最多调用多少轮工具。默认 15。",
        "placeholder": "15",
        "is_secret": False, "required": False, "group": "advanced",
    },
    {
        "name": "OPENAI_MAX_TOKENS",
        "label": "OpenAI Max Tokens",
        "description": "wiki 索引生成时 OpenAI 输出 token 上限。默认 600。",
        "placeholder": "600",
        "is_secret": False, "required": False, "group": "advanced",
    },
    {
        "name": "OPENAI_NO_JSON_MODE",
        "label": "OpenAI 禁用 JSON Mode",
        "description": "某些第三方服务不支持 response_format,此时填 1 禁用。",
        "placeholder": "",
        "is_secret": False, "required": False, "group": "advanced",
    },
    {
        "name": "ASK_USER_COMM_DIR",
        "label": "Ask-user MCP 通信目录",
        "description": "澄清机制的文件通信目录,一般保持默认。",
        "placeholder": "/tmp/ask_user_comm",
        "is_secret": False, "required": False, "group": "advanced",
        "type": "directory",
    },
]

_ENV_VAR_NAMES = {item["name"] for item in _ENV_SCHEMA}
_ENV_SECRET_NAMES = {item["name"] for item in _ENV_SCHEMA if item.get("is_secret")}


def _parse_env_file(path: Path) -> Dict[str, str]:
    """解析 .env 文件为 {key: value} dict。保持简单,支持引号包裹和 # 注释。"""
    result: Dict[str, str] = {}
    if not path.is_file():
        return result
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return result
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        key, val = s.split("=", 1)
        key = key.strip()
        val = val.strip()
        # 去掉包裹的单/双引号
        if len(val) >= 2 and ((val[0] == val[-1] == '"') or (val[0] == val[-1] == "'")):
            val = val[1:-1]
        result[key] = val
    return result


def _mask_secret(value: str) -> str:
    """把 secret 字段 mask 为 'sk-••••bdef' 形式(首尾各 4 字符)"""
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return value[:4] + "•" * max(4, len(value) - 8) + value[-4:]


def _atomic_write_env(path: Path, vars_map: Dict[str, str]) -> None:
    """原子写入 .env 文件。先写临时文件再 rename,防止崩溃破坏原文件。
    写入格式: 每行 KEY=VALUE,值含空格/引号时用双引号包裹。
    只写入 schema 里定义且值非空的变量,按 schema 顺序排列(保证输出稳定)。

    跳过空值的原因: `os.environ.get(name, default)` 在 key 存在但值为空时返回 "",
    会让 `int("")` 之类的解析代码崩溃。干脆不写这些空行,由应用侧用默认值兜底。
    """
    lines: List[str] = []
    lines.append("# Auto-generated by /api/env endpoint. Do not edit manually while server is running.")
    lines.append("")
    # 先按 group 分组过滤出有值的字段,再输出
    group_order = ["core", "neo4j", "advanced"]
    group_titles = {
        "core": "Core (wiki 生成必需)",
        "neo4j": "Neo4j 图谱(可选)",
        "advanced": "高级调优(通常不改)",
    }
    for group in group_order:
        group_items = [item for item in _ENV_SCHEMA if item.get("group") == group]
        # 过滤出有值的字段,空值跳过
        non_empty = [
            (item["name"], vars_map.get(item["name"], ""))
            for item in group_items
            if vars_map.get(item["name"], "").strip()
        ]
        if not non_empty:
            continue
        lines.append(f"# ==================== {group_titles.get(group, group)} ====================")
        for name, value in non_empty:
            if any(c in value for c in ' \t#"\'\\'):
                escaped = value.replace("\\", "\\\\").replace('"', '\\"')
                lines.append(f'{name}="{escaped}"')
            else:
                lines.append(f"{name}={value}")
        lines.append("")
    text = "\n".join(lines).rstrip() + "\n"

    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(text, encoding="utf-8")
    os.replace(str(tmp_path), str(path))


class EnvWriteRequest(BaseModel):
    """前端提交的 env 字段。缺失或空字符串的 secret 字段表示保持原值。"""
    values: Dict[str, str] = Field(default_factory=dict)


@app.get("/api/env")
async def get_env_config() -> Dict[str, Any]:
    """
    读取 server/.env 内容,返回当前值 + 字段 schema。
    - 若文件不存在,file_exists=False,前端应强制显示配置界面
    - secret 字段的 value 返回 preview (首尾 4 字符),完整值只通过 POST 写入,不可读取
    """
    file_exists = _ENV_FILE.is_file()
    current = _parse_env_file(_ENV_FILE)

    vars_info: Dict[str, Any] = {}
    for item in _ENV_SCHEMA:
        name = item["name"]
        raw_value = current.get(name, "")
        is_secret = bool(item.get("is_secret"))
        configured = bool(raw_value)
        value_display = _mask_secret(raw_value) if (is_secret and raw_value) else raw_value
        vars_info[name] = {
            "value": value_display,
            "configured": configured,
            "is_secret": is_secret,
        }

    return {
        "file_exists": file_exists,
        "file_path": str(_ENV_FILE),
        "vars": vars_info,
        "schema": _ENV_SCHEMA,
    }


@app.post("/api/env")
async def save_env_config(request: EnvWriteRequest) -> Dict[str, Any]:
    """
    覆盖写入 server/.env。
    - 只接受 schema 里定义的变量,未知变量被忽略(白名单安全)
    - secret 字段如果提交空字符串,保持原值不变
    - 原子写入:失败不破坏原文件
    """
    submitted = request.values or {}
    # 读当前值(用于 secret 保留)
    current = _parse_env_file(_ENV_FILE)

    final_vars: Dict[str, str] = {}
    changed: List[str] = []

    for item in _ENV_SCHEMA:
        name = item["name"]
        is_secret = bool(item.get("is_secret"))
        old_value = current.get(name, "")

        if name not in submitted:
            # 前端没传这个字段 → 保持原值
            final_vars[name] = old_value
            continue

        new_value = submitted[name] or ""
        # secret 字段提交空字符串 → 保持原值(允许"不改 key,只改其他")
        if is_secret and not new_value:
            final_vars[name] = old_value
            continue

        final_vars[name] = new_value
        if new_value != old_value:
            changed.append(name)

    try:
        _atomic_write_env(_ENV_FILE, final_vars)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入 .env 失败: {e}")

    return {
        "success": True,
        "file_path": str(_ENV_FILE),
        "changed": changed,
        "message": "配置已保存。请重启后端以使新配置生效。",
    }


# ==================== 本地目录浏览(给前端目录选择器用) ====================
#
# 仅用于本地运行的 demo 场景。浏览器沙盒拿不到任意绝对路径,所以提供一个服务端
# "列出目录下子目录"的 API,前端做一个选择器 Modal 让用户一步步点进去。
#
# 安全约束: 只读,只列子目录(不读文件内容),隐藏目录默认过滤。

@app.get("/api/fs/browse")
async def fs_browse(path: str = "~") -> Dict[str, Any]:
    """
    列出指定目录下的子目录。
    - path: 目录绝对路径。支持 '~' 解析为 $HOME,空字符串回退到 $HOME
    - 返回: {path, parent, entries: [{name, is_dir}, ...]}
    - entries 只包含子目录(不含文件),按字母序排列,默认过滤隐藏目录(. 开头)
    """
    raw = (path or "~").strip()
    if raw == "" or raw == "~":
        raw = os.path.expanduser("~")
    else:
        raw = os.path.expanduser(raw)
    raw = os.path.abspath(raw)

    if not os.path.isdir(raw):
        raise HTTPException(status_code=404, detail=f"目录不存在: {raw}")

    entries: List[Dict[str, Any]] = []
    try:
        for name in sorted(os.listdir(raw), key=lambda s: s.lower()):
            if name.startswith("."):
                continue
            full = os.path.join(raw, name)
            try:
                if os.path.isdir(full):
                    entries.append({"name": name, "is_dir": True})
            except OSError:
                # 符号链接循环 / 权限问题,跳过
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"无权访问: {raw}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取目录失败: {e}")

    parent = os.path.dirname(raw)
    if parent == raw:
        parent = None  # 已经是文件系统根目录

    return {"path": raw, "parent": parent, "entries": entries}


# ==================== 启动入口 ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=11219)
