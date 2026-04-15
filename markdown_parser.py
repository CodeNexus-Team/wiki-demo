import json
import re
import uuid
import os
import argparse
import sys
from pathlib import Path
from neo4j import GraphDatabase

# 加载 server/.env（Neo4j 连接凭据与 neo4j_mcp_server.py 共享同一份 .env）
try:
    from dotenv import load_dotenv
    _ENV_PATH = Path(__file__).parent / "server" / ".env"
    if _ENV_PATH.exists():
        load_dotenv(_ENV_PATH)
except ImportError:
    pass

class MarkdownToJsonParser:
    # Neo4j 连接配置（从环境变量读取，默认值仅作 fallback）
    NEO4J_URI = os.environ.get("NEO4J_URI", "neo4j://127.0.0.1:7687")
    NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
    NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")

    def __init__(self):
        self.global_id_counter = 0
        self.source_registry = [] # 用于存储 source_id 定义
        self.current_source_ids = [] # 临时存储当前解析到的引用ID
        self._neo4j_driver = None
        self._neo4j_name_cache = {}  # 缓存已查询的 neo4j id -> name 映射

    def _get_neo4j_driver(self):
        """获取 Neo4j 驱动连接（延迟初始化）。凭据缺失或连接失败时返回 None，调用方需做降级。"""
        if self._neo4j_driver is None:
            if not self.NEO4J_PASSWORD:
                print("警告: NEO4J_PASSWORD 未配置，跳过 Neo4j 查询。请检查 server/.env", file=sys.stderr)
                return None
            try:
                self._neo4j_driver = GraphDatabase.driver(
                    self.NEO4J_URI,
                    auth=(self.NEO4J_USER, self.NEO4J_PASSWORD)
                )
            except Exception as e:
                print(f"警告: Neo4j 驱动初始化失败: {e}", file=sys.stderr)
                return None
        return self._neo4j_driver

    def _query_neo4j_name(self, node_id):
        """根据 neo4j 节点 ID 查询对应的 name 字段

        支持数字 ID（使用 id()）和字符串 element ID（使用 elementId()）
        """
        if node_id in self._neo4j_name_cache:
            return self._neo4j_name_cache[node_id]

        driver = self._get_neo4j_driver()
        if driver is None:
            # 凭据缺失或连接失败,缓存 None 避免重复警告
            self._neo4j_name_cache[node_id] = None
            return None

        try:
            with driver.session() as session:
                # 尝试将 node_id 转为整数，如果成功则使用 id() 查询
                try:
                    int_id = int(node_id)
                    result = session.run(
                        "MATCH (n) WHERE id(n) = $node_id RETURN n.name AS name",
                        node_id=int_id
                    )
                except ValueError:
                    # 如果不是整数，使用 elementId() 查询
                    result = session.run(
                        "MATCH (n) WHERE elementId(n) = $node_id RETURN n.name AS name",
                        node_id=node_id
                    )
                record = result.single()
                if record and record["name"]:
                    name = record["name"]
                    self._neo4j_name_cache[node_id] = name
                    return name
        except Exception as e:
            print(f"警告: 查询 Neo4j 节点 {node_id} 失败: {e}")

        return None

    def _build_neo4j_source(self, neo4j_id):
        """根据 neo4j_id 映射构建 neo4j_source 映射

        neo4j_id 的值可能是单个 ID 字符串/数字，也可能是 ID 列表
        """
        neo4j_source = {}
        if isinstance(neo4j_id, list):
            # neo4j_id 是纯 ID 列表，转为 dict 格式处理
            neo4j_id = {str(i): nid for i, nid in enumerate(neo4j_id)}
        if not isinstance(neo4j_id, dict):
            return neo4j_source
        for key, node_id in neo4j_id.items():
            if isinstance(node_id, list):
                # 如果是列表，查询每个 ID 的 name
                names = []
                for nid in node_id:
                    name = self._query_neo4j_name(str(nid))
                    if name:
                        names.append(name)
                if names:
                    neo4j_source[key] = names
            else:
                # 单个 ID
                name = self._query_neo4j_name(str(node_id))
                if name:
                    neo4j_source[key] = name
        return neo4j_source

    def close(self):
        """关闭 Neo4j 连接"""
        if self._neo4j_driver:
            self._neo4j_driver.close()
            self._neo4j_driver = None

    def _generate_id(self):
        """生成全局唯一的简短ID，例如 S1, S2"""
        self.global_id_counter += 1
        return f"S{self.global_id_counter}"

    def _is_block_diagram(self, mermaid_code):
        """判断是否为 block 类型的 mermaid 图"""
        return 'Block:' in mermaid_code and 'Package:' in mermaid_code

    def _is_cfg_diagram(self, mermaid_code):
        """判断是否为 CFG 类型的 mermaid 图"""
        return 'flowchart' in mermaid_code and 'subgraph' in mermaid_code

    def _is_sequence_diagram(self, mermaid_code):
        """判断是否为时序图类型的 mermaid 图"""
        return 'sequenceDiagram' in mermaid_code

    def _is_class_diagram(self, mermaid_code):
        """判断是否为 UML 类图类型的 mermaid 图"""
        return 'classDiagram' in mermaid_code

    def _extract_class_diagram_nodes(self, mermaid_code, mapping_file_path=None):
        """
        提取 UML 类图类型 mermaid 图中的节点
        类图包含类定义和类之间的关系，格式如:
        - class ClassName { ... }
        - ClassA --> ClassB : relationship

        如果提供 mapping_file_path，则从文件中读取真实的 mapping 和 id_list
        """
        # 提取类定义: class ClassName {，类名可能包含泛型参数如 CommonResult~T~
        class_pattern = r'class\s+([\w~]+)\s*\{'
        class_matches = re.findall(class_pattern, mermaid_code)
        classes = set(class_matches)

        # 提取关系中的类名: ClassA --> ClassB 或 ClassA ..|> ClassB
        relation_pattern = r'([\w~]+)\s*(?:-->|\.\.>|\.\.|>)\s*([\w~]+)'
        relation_matches = re.findall(relation_pattern, mermaid_code)
        for source, target in relation_matches:
            classes.add(source)
            classes.add(target)

        # 如果提供了 mapping 文件，从中查找对应的 source_id
        if mapping_file_path and os.path.exists(mapping_file_path):
            with open(mapping_file_path, 'r', encoding='utf-8') as f:
                mapping_data = json.load(f)

            full_mapping = mapping_data.get('mapping', {})
            full_id_list = mapping_data.get('id_list', [])

            # 只保留图中实际使用的节点的映射
            filtered_mapping = {}
            used_source_ids = set()

            for class_name in classes:
                if class_name in full_mapping:
                    source_id = full_mapping[class_name]
                    filtered_mapping[class_name] = source_id
                    used_source_ids.add(source_id)

            # 只保留使用到的 source_id 对应的 id_list 条目
            filtered_id_list = [item for item in full_id_list if item['source_id'] in used_source_ids]

            return filtered_mapping, filtered_id_list

        return {}, []

    def _extract_sequence_mermaid_nodes(self, mermaid_code, mapping_file_path=None):
        """
        提取时序图类型 mermaid 图中的节点
        时序图包含参与者和方法调用，格式如:
        - participant Name as DisplayName
        - A->>B: A.method

        如果提供 mapping_file_path，则从文件中读取真实的 mapping 和 id_list
        """
        # 提取参与者: participant Name as DisplayName
        participant_pattern = r'participant\s+(\w+)\s+as\s+(\w+)'
        participant_matches = re.findall(participant_pattern, mermaid_code)
        participants = set()
        for _, display_name in participant_matches:
            participants.add(display_name)

        # 提取方法调用: A->>B: Label 或 A-->>B: Label
        arrow_pattern = r'\w+\s*-[->]+\s*\w+\s*:\s*(.+)'
        arrow_matches = re.findall(arrow_pattern, mermaid_code)
        method_calls = set()
        for label in arrow_matches:
            label = label.strip()
            if label and label != 'implemented_by':
                method_calls.add(label)

        # 合并所有需要映射的节点
        all_nodes = participants | method_calls
        #print(f"提取到的时序图节点: {all_nodes}")
        # 如果提供了 mapping 文件，从中查找对应的 source_id
        if mapping_file_path and os.path.exists(mapping_file_path):
            with open(mapping_file_path, 'r', encoding='utf-8') as f:
                mapping_data = json.load(f)

            full_mapping = mapping_data.get('mapping', {})
            full_id_list = mapping_data.get('id_list', [])

            # 只保留图中实际使用的节点的映射
            filtered_mapping = {}
            used_source_ids = set()

            for node in all_nodes:
                if node in full_mapping:
                    source_id = full_mapping[node]
                    filtered_mapping[node] = source_id
                    used_source_ids.add(source_id)
                else:
                    #pass
                    print(f"警告: 时序图节点 '{node}' 未在 mapping 中找到对应的 source_id")

            # 只保留使用到的 source_id 对应的 id_list 条目
            filtered_id_list = [item for item in full_id_list if item['source_id'] in used_source_ids]

            return filtered_mapping, filtered_id_list

        return {}, []

    def _extract_block_mermaid_nodes(self, mermaid_code, mapping_file_path=None):
        """
        提取 block 类型 mermaid 图中的类和方法节点
        只提取：
        - 类节点 (使用 {} 语法)
        - 方法节点 (使用 (()) 语法)

        如果提供 mapping_file_path，则从文件中读取真实的 mapping 和 id_list
        """
        # 提取类节点: classXxx{ClassName}
        class_pattern = r'(\w+)\{([^}]+)\}'
        class_matches = re.findall(class_pattern, mermaid_code)
        class_map = {}
        for node_id, class_name in class_matches:
            class_name = class_name.strip('"')
            class_map[node_id] = class_name

        # 提取方法节点: methodXxx((methodName))
        method_pattern = r'(\w+)\(\(([^)]+)\)\)'
        method_matches = re.findall(method_pattern, mermaid_code)
        method_map = {}
        for node_id, method_name in method_matches:
            method_name = method_name.strip('"')
            method_map[node_id] = method_name

        # 查找类与方法的关系: classNode --> methodNode
        arrow_pattern = r'(\w+)\s*-->\s*(\w+)'
        arrow_matches = re.findall(arrow_pattern, mermaid_code)
        method_to_class = {}
        for source, target in arrow_matches:
            if source in class_map and target in method_map:
                method_to_class[target] = source

        # 如果提供了 mapping 文件，使用真实的映射数据
        if mapping_file_path and os.path.exists(mapping_file_path):
            with open(mapping_file_path, 'r', encoding='utf-8') as f:
                mapping_data = json.load(f)

            node_to_source_id = mapping_data.get('mapping', {})
            full_id_list = mapping_data.get('id_list', [])
            final_mapping = {}
            used_source_ids = set()

            # 为类节点创建映射: node_id -> source_id
            for node_id in class_map.keys():
                if node_id in node_to_source_id:
                    source_id = node_to_source_id[node_id]
                    final_mapping[node_id] = source_id
                    used_source_ids.add(source_id)

            # 为方法节点创建映射: node_id -> source_id
            for node_id in method_map.keys():
                if node_id in node_to_source_id:
                    source_id = node_to_source_id[node_id]
                    final_mapping[node_id] = source_id
                    used_source_ids.add(source_id)

            # 只保留使用到的 source_id 对应的 id_list 条目
            filtered_id_list = [item for item in full_id_list if item['source_id'] in used_source_ids]

            return final_mapping, filtered_id_list

        # 如果没有 mapping 文件，返回简单的节点映射
        mapping = {}
        for node_id, class_name in class_map.items():
            mapping[class_name] = node_id

        for node_id, method_name in method_map.items():
            if node_id in method_to_class:
                class_node = method_to_class[node_id]
                class_name = class_map[class_node]
                mapping[f"{class_name}.{method_name}"] = node_id
            else:
                mapping[method_name] = node_id

        return mapping, []

    def _extract_cfg_mermaid_nodes(self, mermaid_code, mapping_file_path=None):
        """
        提取 CFG 类型 mermaid 图中的节点
        CFG 图使用 flowchart 语法，节点格式如: A1["描述"]

        如果提供 mapping_file_path，则从文件中读取真实的 mapping 和 id_list
        """
        # 提取节点: A1["描述"] 或 A1[描述]，支持多行内容
        node_pattern = r'(\w+)\[[\s\S]*?\]'
        node_matches = re.findall(node_pattern, mermaid_code)
        nodes = set(node_matches)

        # 如果提供了 mapping 文件，从中查找对应的 source_id
        if mapping_file_path and os.path.exists(mapping_file_path):
            with open(mapping_file_path, 'r', encoding='utf-8') as f:
                mapping_data = json.load(f)

            full_mapping = mapping_data.get('mapping', {})
            full_id_list = mapping_data.get('id_list', [])

            # 只保留图中实际使用的节点的映射
            filtered_mapping = {}
            used_source_ids = set()

            for node in nodes:
                if node in full_mapping:
                    source_id = full_mapping[node]
                    filtered_mapping[node] = source_id
                    used_source_ids.add(source_id)

            # 只保留使用到的 source_id 对应的 id_list 条目
            filtered_id_list = [item for item in full_id_list if item['source_id'] in used_source_ids]

            return filtered_mapping, filtered_id_list

        # 如果没有 mapping 文件，返回简单的节点映射
        mapping = {node_id: "1" for node_id in nodes}
        return mapping, []

    def _extract_mermaid_nodes(self, mermaid_code, mapping_file_path=None):
        """
        从 mermaid 代码中提取节点并生成映射
        根据图表类型使用不同的提取策略
        """
        # 判断是否为时序图类型图表
        if self._is_sequence_diagram(mermaid_code):
            return self._extract_sequence_mermaid_nodes(mermaid_code, mapping_file_path)

        # 判断是否为 UML 类图类型图表
        if self._is_class_diagram(mermaid_code):
            return self._extract_class_diagram_nodes(mermaid_code, mapping_file_path)

        # 判断是否为 CFG 类型图表
        if self._is_cfg_diagram(mermaid_code):
            return self._extract_cfg_mermaid_nodes(mermaid_code, mapping_file_path)

        # 判断是否为 block 类型图表
        if self._is_block_diagram(mermaid_code):
            return self._extract_block_mermaid_nodes(mermaid_code, mapping_file_path)

        # 通用提取逻辑（其他类型的 mermaid 图）
        mapping = {}
        node_patterns = [
            r'(\w+)\[.*?\]',
            r'(\w+)\(.*?\)',
            r'(\w+)\{.*?\}',
            r'(\w+)\>.*?\]',
            r'(\w+)\[\[.*?\]\]',
            r'(\w+)\[\(.*?\)\]',
            r'(\w+)\(\(.*?\)\)',
            r'(\w+)\>\>.*?\>\>',
        ]

        for pattern in node_patterns:
            matches = re.findall(pattern, mermaid_code)
            for node_id in matches:
                if node_id and node_id not in mapping:
                    mapping[node_id] = "1"

        arrow_pattern = r'(\w+)\s*(?:-->|---|-\.->|\-\.-|==>|==|->|-)\s*(\w+)'
        arrow_matches = re.findall(arrow_pattern, mermaid_code)
        for source, target in arrow_matches:
            if source and source not in mapping:
                mapping[source] = "1"
            if target and target not in mapping:
                mapping[target] = "1"

        return mapping, []

    def parse_markdown_fragment(self, markdown_text, source_id=None, mapping=None):
        """
        解析单个 markdown 片段

        Args:
            markdown_text: markdown 文本内容
            source_id: 该片段对应的 source_id 列表
            mapping: mermaid 图的 mapping（如果有）

        Returns:
            解析后的节点列表
        """
        if source_id is None:
            source_id = []

        lines = markdown_text.split('\n')

        # 根容器
        root = []
        # 栈结构：用于处理嵌套章节
        stack = [{"level": 0, "content": root}]

        # 缓冲器：用于积累纯文本内容
        text_buffer = []

        # 状态标记
        in_code_block = False
        code_block_content = []
        code_block_lang = ""

        def flush_text_buffer():
            """将积累的文本转换为Text节点并写入当前章节"""
            if text_buffer:
                content = "\n".join(text_buffer).strip()
                if content:
                    text_node = {
                        "type": "text",
                        "id": self._generate_id(),
                        "content": {
                            "markdown": content
                        },
                        "source_id": source_id
                    }
                    stack[-1]["content"].append(text_node)
                text_buffer.clear()

        i = 0
        while i < len(lines):
            line = lines[i]
            stripped_line = line.strip()

            # 1. 处理代码块 (Mermaid 或其他)
            if stripped_line.startswith("```"):
                if in_code_block:
                    # 代码块结束
                    in_code_block = False
                    flush_text_buffer()

                    code_content_str = "\n".join(code_block_content)

                    if code_block_lang == "mermaid":
                        # 生成 Chart 节点
                        # 使用提供的 mapping（即使为空），只有 mapping 为 None 时才自动提取
                        if mapping is None:
                            chart_mapping, _ = self._extract_mermaid_nodes(code_content_str)
                        else:
                            chart_mapping = mapping

                        chart_node = {
                            "type": "chart",
                            "id": self._generate_id(),
                            "content": {
                                "mapping": chart_mapping,
                                "mermaid": code_content_str
                            },
                            "source_id": source_id
                        }
                        stack[-1]["content"].append(chart_node)
                    else:
                        # 非mermaid代码块作为普通文本处理
                        full_code_md = f"```{code_block_lang}\n{code_content_str}\n```"
                        text_node = {
                            "type": "text",
                            "id": self._generate_id(),
                            "content": {
                                "markdown": full_code_md
                            },
                            "source_id": source_id
                        }
                        stack[-1]["content"].append(text_node)

                    code_block_content = []
                else:
                    # 代码块开始
                    flush_text_buffer()
                    in_code_block = True
                    code_block_lang = stripped_line.replace("```", "").strip()

            elif in_code_block:
                # 检测行尾粘连的 ```（如 "end```" 或 "content```"）
                if stripped_line.endswith("```") and stripped_line != "```" and not stripped_line.startswith("```"):
                    content_part = line[:line.rfind("```")]
                    if content_part.strip():
                        code_block_content.append(content_part)
                    in_code_block = False
                    flush_text_buffer()
                    code_content_str = "\n".join(code_block_content)

                    if code_block_lang == "mermaid":
                        if mapping is None:
                            chart_mapping, _ = self._extract_mermaid_nodes(code_content_str)
                        else:
                            chart_mapping = mapping
                        chart_node = {
                            "type": "chart",
                            "id": self._generate_id(),
                            "content": {
                                "mapping": chart_mapping,
                                "mermaid": code_content_str
                            },
                            "source_id": source_id
                        }
                        stack[-1]["content"].append(chart_node)
                    else:
                        full_code_md = f"```{code_block_lang}\n{code_content_str}\n```"
                        text_node = {
                            "type": "text",
                            "id": self._generate_id(),
                            "content": {
                                "markdown": full_code_md
                            },
                            "source_id": source_id
                        }
                        stack[-1]["content"].append(text_node)

                    code_block_content = []
                else:
                    code_block_content.append(line)

            # 2. 处理标题 (Section)
            elif re.match(r'^#{1,6}\s', line):
                flush_text_buffer()

                header_level = len(line.split()[0])

                new_section = {
                    "type": "section",
                    "id": self._generate_id(),
                    "title": line.strip(),
                    "content": []
                }

                while stack[-1]["level"] >= header_level:
                    stack.pop()

                parent = stack[-1]
                parent["content"].append(new_section)
                stack.append({"level": header_level, "content": new_section["content"]})

            # 3. 普通文本
            else:
                text_buffer.append(line)

            i += 1

        flush_text_buffer()
        return root

    def parse_json(self, json_data, file_path=None):
        """
        解析 JSON 格式的输入

        Args:
            json_data: 包含 wiki 数组和 source_id_list 的字典
            file_path: 可选的文件路径，用于在内容不以一级标题开头时自动生成标题

        Returns:
            解析后的完整输出结构
        """
        wiki_items = json_data.get("wiki", [])
        source_id_list = json_data.get("source_id_list", [])

        # 根容器和栈（跨所有 wiki 元素保持状态）
        root = []
        stack = [{"level": 0, "content": root}]

        for item in wiki_items:
            # 读取 neo4j_id 字段
            item_neo4j_id = item.get("neo4j_id", {})

            # 判断是 markdown 类型还是 mermaid 类型
            if "markdown" in item:
                # markdown 类型
                markdown_text = item["markdown"]
                item_source_id = item.get("source_id", [])

                # 解析 markdown 片段，合并到当前结构
                self._parse_and_merge(markdown_text, item_source_id, None, stack, item_neo4j_id)

            elif "mermaid" in item:
                # mermaid 类型
                mermaid_text = item["mermaid"]
                item_mapping = item.get("mapping", {})
                item_source_id = item.get("source_id", [])

                # 解析 mermaid 片段（可能包含标题），合并到当前结构
                self._parse_and_merge(mermaid_text, item_source_id, item_mapping, stack, item_neo4j_id)

        # 检查是否以一级标题开头，如果不是且提供了 file_path，则自动添加
        if file_path and root:
            first_item = root[0]
            # 检查第一个元素是否是一级标题（type 为 section 且 title 以 "# " 开头但不是 "## "）
            is_h1 = (
                first_item.get("type") == "section" and
                first_item.get("title", "").startswith("# ") and
                not first_item.get("title", "").startswith("## ")
            )

            if not is_h1:
                # 从文件路径提取文件名（去除扩展名，包括 .meta.json）
                file_name = os.path.basename(file_path)
                # 移除 .meta.json 或 .json 扩展名
                if file_name.endswith('.meta.json'):
                    file_name = file_name[:-len('.meta.json')]
                elif file_name.endswith('.json'):
                    file_name = file_name[:-len('.json')]
                else:
                    file_name = os.path.splitext(file_name)[0]

                # 创建一级标题 section，将原有内容作为其子内容
                h1_section = {
                    "type": "section",
                    "id": self._generate_id(),
                    "title": f"# {file_name}",
                    "content": root,
                    "neo4j_id": {},
                    "neo4j_source": {}
                }
                root = [h1_section]

        # 构建最终输出
        final_output = {
            "markdown_content": root,
            "source_id": source_id_list
        }

        return final_output

    def _parse_and_merge(self, markdown_text, source_id, mapping, stack, neo4j_id=None):
        """
        解析 markdown 片段并合并到现有结构中

        Args:
            markdown_text: markdown 文本
            source_id: source_id 列表
            mapping: mermaid mapping（可为 None）
            stack: 当前栈状态
            neo4j_id: neo4j_id 映射（可为 None）
        """
        if neo4j_id is None:
            neo4j_id = {}
        # 根据 neo4j_id 查询对应的 name，构建 neo4j_source
        neo4j_source = self._build_neo4j_source(neo4j_id) if neo4j_id else {}
        lines = markdown_text.split('\n')

        text_buffer = []
        in_code_block = False
        code_block_content = []
        code_block_lang = ""

        def flush_text_buffer():
            if text_buffer:
                content = "\n".join(text_buffer).strip()
                if content:
                    text_node = {
                        "type": "text",
                        "id": self._generate_id(),
                        "content": {
                            "markdown": content
                        },
                        "source_id": source_id
                    }
                    stack[-1]["content"].append(text_node)
                text_buffer.clear()

        i = 0
        while i < len(lines):
            line = lines[i]
            stripped_line = line.strip()

            if stripped_line.startswith("```"):
                if in_code_block:
                    in_code_block = False
                    flush_text_buffer()

                    code_content_str = "\n".join(code_block_content)

                    if code_block_lang == "mermaid":
                        # 使用提供的 mapping（即使为空），只有 mapping 为 None 时才自动提取
                        if mapping is None:
                            chart_mapping, _ = self._extract_mermaid_nodes(code_content_str)
                        else:
                            chart_mapping = mapping

                        chart_node = {
                            "type": "chart",
                            "id": self._generate_id(),
                            "content": {
                                "mapping": chart_mapping,
                                "mermaid": code_content_str
                            },
                            "source_id": source_id,
                            "neo4j_id": neo4j_id,
                            "neo4j_source": neo4j_source
                        }
                        stack[-1]["content"].append(chart_node)
                    else:
                        full_code_md = f"```{code_block_lang}\n{code_content_str}\n```"
                        text_node = {
                            "type": "text",
                            "id": self._generate_id(),
                            "content": {
                                "markdown": full_code_md
                            },
                            "source_id": source_id
                        }
                        stack[-1]["content"].append(text_node)

                    code_block_content = []
                else:
                    flush_text_buffer()
                    in_code_block = True
                    code_block_lang = stripped_line.replace("```", "").strip()

            elif in_code_block:
                # 检测行尾粘连的 ```（如 "end```" 或 "content```"）
                if stripped_line.endswith("```") and stripped_line != "```" and not stripped_line.startswith("```"):
                    # 将 ``` 之前的内容作为代码块的最后一行
                    content_part = line[:line.rfind("```")]
                    if content_part.strip():
                        code_block_content.append(content_part)
                    # 关闭代码块（模拟遇到独立的 ```）
                    in_code_block = False
                    flush_text_buffer()

                    code_content_str = "\n".join(code_block_content)

                    if code_block_lang == "mermaid":
                        if mapping is None:
                            chart_mapping, _ = self._extract_mermaid_nodes(code_content_str)
                        else:
                            chart_mapping = mapping

                        chart_node = {
                            "type": "chart",
                            "id": self._generate_id(),
                            "content": {
                                "mapping": chart_mapping,
                                "mermaid": code_content_str
                            },
                            "source_id": source_id,
                            "neo4j_id": neo4j_id,
                            "neo4j_source": neo4j_source
                        }
                        stack[-1]["content"].append(chart_node)
                    else:
                        full_code_md = f"```{code_block_lang}\n{code_content_str}\n```"
                        text_node = {
                            "type": "text",
                            "id": self._generate_id(),
                            "content": {
                                "markdown": full_code_md
                            },
                            "source_id": source_id
                        }
                        stack[-1]["content"].append(text_node)

                    code_block_content = []
                else:
                    code_block_content.append(line)

            elif re.match(r'^#{1,6}\s', line):
                flush_text_buffer()

                header_level = len(line.split()[0])
                title_text = line.strip()

                # 从标题中提取章节号（如 "## 2.1 标题" -> "2.1"）
                section_num_match = re.search(r'^#+\s*(\d+(?:\.\d+)*)', title_text)
                section_neo4j_id = {}
                section_neo4j_source = {}
                if section_num_match:
                    section_num = section_num_match.group(1)
                    if section_num in neo4j_id:
                        section_neo4j_id = {section_num: neo4j_id[section_num]}
                        # 查询对应的 name
                        if section_num in neo4j_source:
                            section_neo4j_source = {section_num: neo4j_source[section_num]}

                new_section = {
                    "type": "section",
                    "id": self._generate_id(),
                    "title": title_text,
                    "content": [],
                    "neo4j_id": section_neo4j_id,
                    "neo4j_source": section_neo4j_source
                }

                while stack[-1]["level"] >= header_level:
                    stack.pop()

                parent = stack[-1]
                parent["content"].append(new_section)
                stack.append({"level": header_level, "content": new_section["content"]})

            else:
                text_buffer.append(line)

            i += 1

        flush_text_buffer()

    def parse(self, markdown_text, input_file_path=None):
        """主解析函数（保留原有接口，兼容旧用法）"""
        lines = markdown_text.split('\n')

        # 确定 mapping 文件路径
        mapping_file_path = None
        if input_file_path:
            base_name = os.path.splitext(input_file_path)[0]
            mapping_file_path = f"{base_name}_mapping.json"
            print(f"尝试使用 mapping 文件: {mapping_file_path}")

        # 根容器
        root = []
        stack = [{"level": 0, "content": root}]
        text_buffer = []
        in_code_block = False
        code_block_content = []
        code_block_lang = ""
        all_id_lists = []

        def flush_text_buffer():
            if text_buffer:
                content = "\n".join(text_buffer).strip()
                if content:
                    text_node = {
                        "type": "text",
                        "id": self._generate_id(),
                        "content": {
                            "markdown": content
                        },
                        "source_id": ["1"]
                    }
                    stack[-1]["content"].append(text_node)
                text_buffer.clear()

        i = 0
        while i < len(lines):
            line = lines[i]
            stripped_line = line.strip()

            if stripped_line.startswith("```"):
                if in_code_block:
                    in_code_block = False
                    flush_text_buffer()
                    code_content_str = "\n".join(code_block_content)

                    if code_block_lang == "mermaid":
                        mapping, id_list = self._extract_mermaid_nodes(code_content_str, mapping_file_path)
                        if id_list:
                            all_id_lists.extend(id_list)

                        chart_node = {
                            "type": "chart",
                            "id": self._generate_id(),
                            "content": {
                                "mapping": mapping,
                                "mermaid": code_content_str
                            },
                            "source_id": ["1"]
                        }
                        stack[-1]["content"].append(chart_node)
                    else:
                        full_code_md = f"```{code_block_lang}\n{code_content_str}\n```"
                        text_node = {
                            "type": "text",
                            "id": self._generate_id(),
                            "content": {
                                "markdown": full_code_md
                            },
                            "source_id": ["1"]
                        }
                        stack[-1]["content"].append(text_node)

                    code_block_content = []
                else:
                    flush_text_buffer()
                    in_code_block = True
                    code_block_lang = stripped_line.replace("```", "").strip()

            elif in_code_block:
                # 检测行尾粘连的 ```（如 "end```" 或 "content```"）
                if stripped_line.endswith("```") and stripped_line != "```" and not stripped_line.startswith("```"):
                    content_part = line[:line.rfind("```")]
                    if content_part.strip():
                        code_block_content.append(content_part)
                    in_code_block = False
                    flush_text_buffer()
                    code_content_str = "\n".join(code_block_content)

                    if code_block_lang == "mermaid":
                        mapping_data, id_list = self._extract_mermaid_nodes(code_content_str, mapping_file_path)
                        if id_list:
                            all_id_lists.extend(id_list)
                        chart_node = {
                            "type": "chart",
                            "id": self._generate_id(),
                            "content": {
                                "mapping": mapping_data,
                                "mermaid": code_content_str
                            },
                            "source_id": ["1"]
                        }
                        stack[-1]["content"].append(chart_node)
                    else:
                        full_code_md = f"```{code_block_lang}\n{code_content_str}\n```"
                        text_node = {
                            "type": "text",
                            "id": self._generate_id(),
                            "content": {
                                "markdown": full_code_md
                            },
                            "source_id": ["1"]
                        }
                        stack[-1]["content"].append(text_node)

                    code_block_content = []
                else:
                    code_block_content.append(line)

            elif re.match(r'^#{1,6}\s', line):
                flush_text_buffer()
                header_level = len(line.split()[0])

                new_section = {
                    "type": "section",
                    "id": self._generate_id(),
                    "title": line.strip(),
                    "content": []
                }

                while stack[-1]["level"] >= header_level:
                    stack.pop()

                parent = stack[-1]
                parent["content"].append(new_section)
                stack.append({"level": header_level, "content": new_section["content"]})

            else:
                text_buffer.append(line)

            i += 1

        flush_text_buffer()

        if all_id_lists:
            source_registry = all_id_lists
        else:
            source_registry = [
                {
                    "source_id": "1",
                    "name": "mall/mall-portal/src/main/java/com/macro/mall/portal/controller/AlipayController.java",
                    "lines": [
                        "32-74"
                    ]   
                }
            ]

        final_output = {
            "markdown_content": root,
            "source_id": source_registry
        }

        return final_output

# --- 使用示例 ---


def main():
    # 1. 设置命令行参数解析
    parser = argparse.ArgumentParser(description="Markdown/JSON 转 JSON 转换器")
    parser.add_argument("input_file", help="输入文件路径 (支持 .json 或 .md 格式)")
    parser.add_argument("-o", "--output", help="输出的 JSON 文件路径 (可选)", default=None)

    args = parser.parse_args()

    input_path = args.input_file
    base_name = os.path.splitext(input_path)[0]
    file_ext = os.path.splitext(input_path)[1].lower()

    # 2. 确定输出文件路径
    if args.output:
        output_path = args.output
    elif file_ext == '.json':
        # JSON 输入: {原文件名}_output.json
        output_path = f"{base_name}_output.json"
    else:
        # Markdown 输入: {原文件名}.json (保持原有行为)
        output_path = f"{base_name}.json"

    # 3. 检查输入文件是否存在
    if not os.path.exists(input_path):
        print(f"错误: 找不到输入文件 '{input_path}'")
        sys.exit(1)

    parser_obj = None
    try:
        print(f"正在读取文件: {input_path} ...")
        parser_obj = MarkdownToJsonParser()

        if file_ext == '.json':
            # 4a. JSON 输入模式
            with open(input_path, 'r', encoding='utf-8') as f:
                json_data = json.load(f)

            result = parser_obj.parse_json(json_data, input_path)
        else:
            # 4b. Markdown 输入模式 (保持原有行为)
            with open(input_path, 'r', encoding='utf-8') as f:
                md_content = f.read()

            result = parser_obj.parse(md_content, input_path)

        # 5. 写入 JSON 文件
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=4, ensure_ascii=False)

        print(f"转换成功!")
        print(f"输出文件: {output_path}")

    except json.JSONDecodeError as e:
        print(f"错误: JSON 解析失败 - {str(e)}")
        sys.exit(1)
    except Exception as e:
        print(f"错误: {str(e)}")
        sys.exit(1)
    finally:
        # 关闭 Neo4j 连接
        if parser_obj:
            parser_obj.close()

if __name__ == "__main__":
    main()     