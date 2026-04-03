"""
Ask User MCP Server

提供结构化澄清工具，供 Claude CLI 通过 MCP 协议调用。
通过临时文件与 FastAPI 服务通信：
  1. 模型调用 ask_user → 写问题到 {session}.question.json → 阻塞等待
  2. FastAPI 检测到调用 → 读取问题 → SSE 推送前端 → 用户回答
  3. FastAPI 写回答到 {session}.answer.json
  4. MCP 工具读到回答 → 返回 tool_result → 模型继续推理
"""

import os
import json
import time
import logging
from mcp.server.fastmcp import FastMCP

# 日志
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
logger = logging.getLogger("ask_user_mcp")
logger.setLevel(logging.DEBUG)
_handler = logging.FileHandler(os.path.join(LOG_DIR, "ask_user_mcp.log"), encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(_handler)

# 通信目录（由 agent.py 通过环境变量传入）
COMM_DIR = os.environ.get("ASK_USER_COMM_DIR", "/tmp/ask_user_comm")
os.makedirs(COMM_DIR, exist_ok=True)

mcp = FastMCP("ask-user")


@mcp.tool()
def ask_user(question: str, options: list[str], multi_select: bool = False) -> str:
    """向用户提出澄清问题并等待回答。当你需要澄清用户意图、确认修改方向、
    或在多种可能的执行方式之间做选择时，使用此工具。

    Args:
        question: 要问用户的问题。应清晰具体，不要使用 block ID，
                  而是用内容标题或摘要来指代。
                  例如："你希望对「模块功能概述」这段内容做哪种修改？"
        options: 2~5 个可选方向。最后一个选项应为"其他（请在输入框说明）"。
                 每个选项要简洁，让用户一眼看懂。
        multi_select: 是否允许用户同时选择多个选项。默认 False（单选）。
                      当选项之间不互斥时设为 True，例如"你希望补充哪些内容？"
    """
    logger.info(f"ask_user 被调用: question={question}, options={options}, multi_select={multi_select}")

    # 写问题文件
    question_file = os.path.join(COMM_DIR, "pending.question.json")
    answer_file = os.path.join(COMM_DIR, "pending.answer.json")

    # 清理可能残留的旧文件
    if os.path.exists(answer_file):
        os.remove(answer_file)

    question_data = {"question": question, "options": options, "multi_select": multi_select}
    with open(question_file, 'w', encoding='utf-8') as f:
        json.dump(question_data, f, ensure_ascii=False)

    logger.info(f"已写入问题文件: {question_file}")

    # 阻塞等待回答（轮询，最多等 5 分钟）
    timeout = 300
    poll_interval = 0.5
    elapsed = 0

    while elapsed < timeout:
        if os.path.exists(answer_file):
            try:
                with open(answer_file, 'r', encoding='utf-8') as f:
                    answer_data = json.load(f)
                answer = answer_data.get("answer", "")
                logger.info(f"收到用户回答: {answer}")

                # 清理文件
                os.remove(answer_file)
                if os.path.exists(question_file):
                    os.remove(question_file)

                return f"用户选择了: {answer}。请根据用户的选择继续执行。"
            except (json.JSONDecodeError, IOError) as e:
                logger.warning(f"读取回答文件失败，重试: {e}")

        time.sleep(poll_interval)
        elapsed += poll_interval

    # 超时
    logger.warning("等待用户回答超时")
    if os.path.exists(question_file):
        os.remove(question_file)
    return "用户未在规定时间内回答。请根据你的最佳判断继续执行。"


if __name__ == "__main__":
    mcp.run()
