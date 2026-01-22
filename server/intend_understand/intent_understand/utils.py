# utils.py
from __future__ import annotations

import os
import sys
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv, find_dotenv
from neo4j import GraphDatabase, Driver

# ===== 路径与 .env 初始化（从 notebook 里那段 _here / ROOT / sys.path 搬过来） =====
def _here() -> Path:
    """Return current file dir in .py; fallback to CWD in notebooks."""
    try:
        return Path(__file__).resolve().parent  # .py 场景
    except NameError:
        return Path.cwd().resolve()             # .ipynb 场景

THIS_DIR = _here()
CANDIDATES = [THIS_DIR, THIS_DIR.parent, THIS_DIR.parent.parent]
ROOT = next((p for p in CANDIDATES if (p / "interfaces").exists()), THIS_DIR)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

dotenv_path = find_dotenv(usecwd=True)
load_dotenv(dotenv_path if dotenv_path else None)

# ===== 环境变量 =====
NEO4J_URI: str | None = os.getenv("NEO4J_URI")
NEO4J_USER: str | None = os.getenv("NEO4J_USER")
NEO4J_PASSWORD: str | None = os.getenv("NEO4J_PASSWORD")

OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL: str | None = os.getenv("OPENAI_BASE_URL")

# ===== LLM 接口 =====
from interfaces.llm_interface import LLMInterface

def get_llm():
    """
    统一构造 LangChain LLM 实例，供 expand_keyword / expand_query 使用。
    """
    llm_config = {
        "openai_api_key": OPENAI_API_KEY,
        "openai_api_base": OPENAI_BASE_URL,
    }
    interface = LLMInterface(**llm_config)
    return interface.llm

# ===== Neo4j Driver 工具 =====
def get_neo4j_driver() -> Driver:
    """
    生成 Neo4j Driver 实例（调用方负责关闭或在模块级缓存）。
    """
    if not all((NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)):
        raise RuntimeError("Neo4j 环境变量未配置完整")
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

# ===== JSON 工具 =====
def to_json_str(obj: Any, fallback_empty: str) -> str:
    """
    将传入对象尽量序列化为 JSON 字符串；若为 str 则原样返回（strip）。
    当为空/None 或序列化失败时，返回 fallback_empty（如 "[]" 或 "{}"）。
    """
    if obj is None:
        return fallback_empty
    if isinstance(obj, str):
        s = obj.strip()
        return s if s else fallback_empty
    try:
        return json.dumps(obj, ensure_ascii=False)
    except Exception:
        return fallback_empty

# ===== Lucene / 文本规范化工具 =====
# 把 _boost / _escape_lucene / _dedup_keep_order / _name_to_search_text 搬到这里
def _boost(score: float, base: float = 1.0, span: float = 4.0) -> float:
    """
    把 [0,1] 的置信度映射成 Lucene 的 boost 系数 (base ~ base+span)。
    例如 base=1, span=4 -> [1,5]。
    """
    try:
        s = max(0.0, min(1.0, float(score)))
    except Exception:
        s = 0.0
    return round(base + span * s, 2)

_LUCENE_SPECIALS = r'+-!():^[]{}~"\\'

def _escape_lucene(s: str, keep_wildcard: bool = False) -> str:
    specials = _LUCENE_SPECIALS if not keep_wildcard else r'+-!():^[]{}~"\\'
    return re.sub(r'([{}])'.format(re.escape(specials)), r'\\\1', s)

def _dedup_keep_order(items: List[str]) -> List[str]:
    seen, out = set(), []
    for t in items:
        if t and t not in seen:
            out.append(t); seen.add(t)
    return out


_CAMEL_LOWER_TO_UPPER = re.compile(r'(?<=[a-z0-9])(?=[A-Z])')
_CAMEL_ACRONYM_TO_WORD = re.compile(r'(?<=[A-Z])(?=[A-Z][a-z])')
_SEP_TO_SPACE = re.compile(r'[\\/._\-]+')
_NON_ALNUM_TO_SPACE = re.compile(r'[^A-Za-z0-9 ]+')


def _name_to_search_text(name: Any) -> str:
    """
    将任意 name 规范化为适合全文检索的空格分词串（仅含 a-z0-9 与空格）。
    处理步骤：
      1) 统一路径/分隔符为空格
      2) 驼峰/帕斯卡切分
      3) 非字母数字字符去噪
      4) 多空格折叠、转小写
    """
    if not isinstance(name, str) or not name.strip():
        return ""
    s = name.strip()

    # 1) 统一常见分隔符为空格（含 / \ . _ -）
    s = _SEP_TO_SPACE.sub(" ", s)

    # 2) 驼峰与缩写边界插空格：e.g., "XMLHttpRequest" -> "XML Http Request"
    s = _CAMEL_ACRONYM_TO_WORD.sub(" ", s)
    s = _CAMEL_LOWER_TO_UPPER.sub(" ", s)

    # 3) 去除其它符号，仅保留字母数字和空格
    s = _NON_ALNUM_TO_SPACE.sub(" ", s)

    # 4) 折叠多余空格、转小写
    s = " ".join(s.split()).lower()
    return s
# ===== root_info 工具（统一一个版本） =====
def get_root_info() -> str:
    """
    查找 name 为 "root" 的 Block 节点，返回其 semantic_explanation。
    （用你 notebook 里第二个 get_root_info 实现）
    """
    cypher = """
    MATCH (b:Block {name: $name})
    RETURN b.semantic_explanation AS semexp
    LIMIT 1
    """
    driver = get_neo4j_driver()
    try:
        with driver.session() as session:
            rec = session.run(cypher, {"name": "root"}).single()
            if rec is None:
                return ""
            return (rec.get("semexp") or "").strip()
    finally:
        driver.close()
