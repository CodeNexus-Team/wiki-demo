# Server API 文档

所有API的请求体和返回都是JSON格式。

## 1. POST /api/user_query

用户查询统一入口，根据请求体判断执行逻辑：
- 无 `selected_questions` 字段：执行扩展查询（预分析 step1），返回扩展问题列表
- 有 `selected_questions` 字段：执行工作流（预分析 step2 + workflow），返回 Wiki 路径

### 输入

- user_query (str)：用户的原始查询
- selected_questions (List[Dict], 可选)：用户选择的扩展问题子集

### 输入示例（扩展查询）

```json
{
  "user_query": "代码中生成订单唯一ID的具体算法实现是什么？"
}
```

### 输入示例（执行工作流）

```json
{
  "user_query": "代码中生成订单唯一ID的具体算法实现是什么？",
  "selected_questions": [
    {
      "id": "BEG_Q1",
      "query": "如果我想了解订单唯一ID生成的相关代码，应该从哪些包或文件开始阅读？主要实现入口在哪里？",
      "search_keywords_cn": [
        "订单ID生成入口",
        "代码包结构",
        "主实现文件"
      ],
      "search_keywords_en": [
        "order id generation entry",
        "code package structure",
        "main implementation file"
      ],
      "targets": [
        "Class",
        "File"
      ]
    }
  ]
}
```

### 执行过程

根据 `selected_questions` 字段是否存在：

**无 selected_questions**：调用 expand_query 函数（预分析 step1）

**有 selected_questions**：调用 execute_workflow 函数：
1. 预分析 step2，生成 scope_results, filtered_entities
2. 根据 scope 选择要执行的 workflow
3. 将 entities 输入 workflow，开始执行
4. workflow 执行完成，生成完整 wiki，返回存储 wiki 文件的文件夹路径

### 输出（扩展查询）

- questions (List[Dict])：其中每个 Dict 是一个扩展问题，包括 id (str), query (str), search_keywords_cn (List[str]), search_keywords_en (List[str]), targets (List[str])

### 输出示例（扩展查询）

```json
{
  "questions": [
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
}
```

### 输出（执行工作流）

- wiki_root (str)：Wiki 根目录路径
- wiki_pages (List[str])：Wiki 页面路径列表

### 输出示例（执行工作流）

```json
{
  "wiki_root": "/path/to/wiki",
  "wiki_pages": [
    "/path/to/wiki/summary.json",
    "/path/to/wiki/page-1.json",
    "/path/to/wiki/module-A/page_A1.json",
    "/path/to/wiki/module-A/pageA2.json",
    "/path/to/wiki/module-A/submodule-AA/pageAA.json",
    "/path/to/wiki/module-B/pageB1.json",
    "/path/to/wiki/conclusion.json"
  ]
}
```

## 2. POST /api/fetch_page

用户点击 wiki 页面，返回对应的页面内容

### 输入

- page_path (str)：页面路径

### 输入示例

```json
{
  "page_path": "/path/to/page.json"
}
```

### 执行过程

后端调用 fetch_page 函数，读取对应的文件并发送

### 输出

- content (List[Dict])：页面内容，包含嵌套的 section、text、chart 等组件。每个内容块可包含 source_id (List[str]) 字段，引用一个或多个来源
- source (List[Dict])：页面来源列表，每个来源包含 source_id (str)、name (str)、lines (List[str])

### 输出示例

```json
{
  "content": [
    {
      "type": "section",
      "id": "1",
      "title": "6.数据结构说明",
      "content": [
        {
          "type": "text",
          "id": "2",
          "content": {
            "markdown": "下面是内容"
          },
          "source_id": ["566"]
        }
      ]
    }
  ],
  "source": [
    {
      "source_id": "566",
      "name": "index.html",
      "lines": ["80-100"]
    }
  ]
}
```

## 3. POST /api/detailed_query

用户在 wiki 页面上选中若干 block 并输入指令，后端根据这些信息细化 wiki 内容。返回两种格式之一：修改当前页面的 block，或新增一个页面。

### 输入

- page_path (str)：当前页面路径
- block_ids (List[str])：用户选中的 block ID 列表
- user_query (str)：用户的查询指令

### 输入示例

```json
{
  "page_path": "/path/to/current/page.json",
  "block_ids": ["2", "5"],
  "user_query": "请详细解释这部分的实现逻辑"
}
```

### 执行过程

后端调用 detailed_query 函数，根据选中的 block 和用户指令生成细化内容

### 输出（修改当前页面）

- insert_blocks (List[Dict])：要插入的 block 列表，每个包含 after_block (str) 和 block (Dict)
- delete_blocks (List[str])：要删除的 block ID 列表
- insert_sources (List[Dict])：要插入的来源列表
- delete_sources (List[str])：要删除的来源 ID 列表

### 输出示例（修改当前页面）

```json
{
  "insert_blocks": [
    {
      "after_block": "3",
      "block": {
        "type": "section",
        "id": "13",
        "title": "新增块的标题",
        "content": []
      }
    }
  ],
  "delete_blocks": ["2"],
  "insert_sources": [
    {
      "source_id": "4322",
      "name": "new_source.java",
      "lines": ["12-34"]
    }
  ],
  "delete_sources": ["566"]
}
```

### 输出（新增页面）

- new_page_path (str)：新页面路径
- new_page (Dict)：新页面内容，格式同 /api/fetch_page 的输出

### 输出示例（新增页面）

```json
{
  "new_page_path": "/path/to/new/page.json",
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
          }
        ]
      }
    ],
    "source": [
      {
        "source_id": "643142",
        "name": "new_reference.py",
        "lines": ["123-127"]
      }
    ]
  }
}
```
