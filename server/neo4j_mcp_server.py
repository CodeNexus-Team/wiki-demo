"""
Neo4j MCP Server

提供 Cypher 查询工具，供 Claude CLI 通过 MCP 协议调用。
启动方式: python neo4j_mcp_server.py
"""

import os
import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

# 加载 .env 环境变量
load_dotenv(Path(__file__).parent / ".env")

# 日志配置
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("neo4j_mcp")
logger.setLevel(logging.DEBUG)
_handler = logging.FileHandler(os.path.join(LOG_DIR, "neo4j_mcp.log"), encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(_handler)

mcp = FastMCP("neo4j-knowledge-graph")


@mcp.tool()
def query_neo4j(cypher_query: str) -> str:
    """执行 Cypher 查询，从 Neo4j 知识图谱获取代码实体和关系信息。

    Args:
        cypher_query: Cypher 查询语句
    """
    neo4j_uri = os.environ.get("NEO4J_URI")
    if not neo4j_uri:
        return "Neo4j 未配置（缺少 NEO4J_URI 环境变量）。请使用其他工具获取代码关系信息。"

    logger.info(f"执行 Cypher 查询: {cypher_query[:300]}")

    try:
        from neo4j import GraphDatabase
        neo4j_user = os.environ.get("NEO4J_USER", "neo4j")
        neo4j_password = os.environ.get("NEO4J_PASSWORD", "")
        driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))

        with driver.session() as session:
            result = session.run(cypher_query)
            records = [dict(record) for record in result]

        driver.close()

        if not records:
            return "查询无结果。"

        output = json.dumps(records, ensure_ascii=False, indent=2, default=str)
        if len(output) > 30000:
            output = output[:30000] + "\n... (结果已截断)"

        logger.info(f"查询成功: {len(records)} 条记录")
        return output
    except ImportError:
        return "Neo4j 驱动未安装。请安装 neo4j 包: pip install neo4j"
    except Exception as e:
        logger.error(f"Neo4j 查询失败: {e}")
        return f"Neo4j 查询失败：{e}"


if __name__ == "__main__":
    mcp.run()
