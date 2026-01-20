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

def fetch_page_mock(page_path: str, wiki_root: str = "user_data/wiki_demo/") -> Dict:
    import json
    import os

    # 去掉前导斜杠，避免 os.path.join 将其视为绝对路径
    page_path = page_path.lstrip('/')

    # 构建完整路径
    # 如果 wiki_root 是绝对路径，直接使用；否则相对于当前文件目录
    if os.path.isabs(wiki_root):
        json_path = os.path.join(wiki_root, page_path)
    else:
        json_path = os.path.join(os.path.dirname(__file__), wiki_root, page_path)

    print(f"Fetching page from: {json_path}")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    page_content = data['markdown_content']
    page_source = data['source_id']

    return {
        "content": page_content,
        "source": page_source,
    }

def detailed_query_mock(page_path: str, block_ids: List[str], user_query: str) -> Dict:
    # will implement this later
    page_diff = {
        "insert_blocks": [
            {
                "after_block": "S1",
                "block": {
                    "type": "section",
                    "id": "13",
                    "title": "新增块的标题",
                    "content": []             
                }
            }
        ],
        "delete_blocks": [
            "S2"
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

    create_page = {
        "new_page_path": "/path/to/new/page.json",
        "new_page": {
            "content": [
                {
                    "type":"section",
                    "id":"4238",
                    "title":"新增页面标题",
                    "content":[
                        {
                            "type":"text",
                            "id":"4327",
                            "content":{
                                "markdown":"新增页面内容123"
                            },
                            "source_id":["643142"]
                        },
                        {
                            "type":"section",
                            "id":"278",
                            "title":"1.1 新增标题",
                            "content":[]             
                        }
                    ]
                }
            ],
            "source": [
                {
                    "source_id":"643142",
                    "name":"new_reference.py",
                    "lines": [
                        "123-127",
                    ]
                }
            ]
        }
    }

    # 可能返回这两种格式的数据
    if(len(user_query) % 2 == 0):
        return page_diff
    else:
        return create_page
