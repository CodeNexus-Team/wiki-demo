from typing import List, Dict
def expand_query_mock(user_query: str) -> List[Dict]:
    # will implement this later
    questions = [
        {
            "id": "PM_Q1",
            "query": "订单唯一编号（ID）在商城业务中是如何保证全局唯一性的？生成规则是否支持高并发、顺序性或追溯性等业务需求？",
            "search_keywords_cn": [
                "订单唯一性",
                "ID生成规则",
                "高并发订单号",
                "业务唯一标识"
            ],
            "search_keywords_en": [
                "order unique id",
                "ID generation rule",
                "concurrent order number",
                "business unique identifier"
            ],
            "targets": [
                "Class",
                "Method"
            ]
        },
        {
            "id": "ARC_Q2",
            "query": "订单号生成与订单业务模块之间的依赖关系如何设计？是否存在专门的ID生成器服务或工具组件，支持多模块复用？",
            "search_keywords_cn": [
                "ID生成器服务",
                "工具组件",
                "模块依赖",
                "复用"
            ],
            "search_keywords_en": [
                "id generator service",
                "utility component",
                "module dependency",
                "reuse"
            ],
            "targets": [
                "Class",
                "Method"
            ]
        }
    ]
    return questions

def execute_workflow_mock(user_query: str, selected_questions: List[Dict], wiki_root: str) -> str:
    # will implement this later
    import os
    import glob

    #wiki_root = "user_data/wiki_demo/"
    wiki_root_abs = os.path.join(os.path.dirname(__file__), wiki_root)
    print(f"Generating wiki pages at: {wiki_root_abs}")
    # 递归读取 wiki_root 下所有 .json 文件
    pattern = os.path.join(wiki_root_abs, "**", "*.json")
    json_files = glob.glob(pattern, recursive=True)

    # 转换为相对于 wiki_root 的路径
    wiki_pages = [os.path.relpath(f, wiki_root_abs) for f in json_files]

    return {
        "wiki_root": wiki_root,
        "wiki_pages": wiki_pages,
    }

def detailed_query_mock(page_path: str, block_ids: List[str], user_query: str, wiki_root: str = "user_data/wiki_demo/") -> Dict:
    import json
    import os

    # 读取当前页面内容
    page_path_clean = page_path.lstrip('/')
    if os.path.isabs(wiki_root):
        json_path = os.path.join(wiki_root, page_path_clean)
    else:
        json_path = os.path.join(os.path.dirname(__file__), wiki_root, page_path_clean)

    with open(json_path, 'r', encoding='utf-8') as f:
        page_data = json.load(f)

    blocks = page_data.get('markdown_content', [])

    # insert_block: 删除第二个块，插入到第一个块之后
    page_diff = None
    if len(blocks) >= 2:
        first_block = blocks[0]
        second_block = blocks[1]
        first_block_id = first_block.get('id', 'block_0')
        second_block_id = second_block.get('id', 'block_1')

        page_diff = {
            "insert_blocks": [
                {
                    "after_block": first_block_id,
                    "block": {
                        "type": "section",
                        "id": second_block_id,
                        "title": "插入的块标题",
                        "content": [
                                {
                                    "type": "text",
                                    "id": "S114514",
                                    "content": {
                                        "markdown": "yuanshenniubi"
                                    },
                                    "source_id": []
                            }
                        ]
                    }
                }
            ],
            "delete_blocks": [
                second_block_id
            ],
            "insert_sources": [
                {
                    "source_id": "4322",
                    "name": "new_source.java",
                    "lines": [
                        "12-34"
                    ]
                }
            ],
            "delete_sources": [
                "566"
            ]
        }

    # create_page: 在根目录下创建新文件
    create_page = {
        "new_page_path": "/new_page_from_query.json",
        "new_page": {
            "content": [
                {
                    "type": "section",
                    "id": "4238",
                    "title": "新增页面标题",
                    "content": [
                        {
                            "type": "text",
                            "id": "4327",
                            "content": {
                                "markdown": "新增页面内容123"
                            },
                            "source_id": ["643142"]
                        },
                        {
                            "type": "section",
                            "id": "278",
                            "title": "1.1 新增标题",
                            "content": []
                        }
                    ]
                }
            ],
            "source": [
                {
                    "source_id": "643142",
                    "name": "new_reference.py",
                    "lines": [
                        "123-127",
                    ]
                }
            ]
        }
    }

    # 根据 user_query 长度决定返回哪种格式
    if len(user_query) % 2 == 0 and page_diff:
        print("Returning page diff (preview only, not applying changes).")
        # 只返回 diff 数据供前端预览，不修改文件
        # 文件的实际修改由前端确认后通过 apply_changes API 执行
        return page_diff
    else:
        # 创建新的 JSON 文件
        new_page_path = create_page["new_page_path"].lstrip('/')
        if os.path.isabs(wiki_root):
            new_json_path = os.path.join(wiki_root, new_page_path)
        else:
            new_json_path = os.path.join(os.path.dirname(__file__), wiki_root, new_page_path)

        # 构建文件内容（与现有页面格式一致）
        new_file_content = {
            "markdown_content": create_page["new_page"]["content"],
            "source_id": create_page["new_page"]["source"]
        }

        with open(new_json_path, 'w', encoding='utf-8') as f:
            json.dump(new_file_content, f, ensure_ascii=False, indent=2)

        print(f"Created new page at: {new_json_path}")
        return create_page
