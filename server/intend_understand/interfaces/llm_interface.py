from typing import Optional
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage

class LLMInterface:
    """
    极简 LLM 封装：
      - 只支持 OpenAI
      - 暴露 .llm 给 LangChain LCEL 使用
      - 附带一个简单的 generate_with_retry
    """

    def __init__(
        self,
        openai_api_key: str,
        openai_api_base: Optional[str] = None,
        model: str = "gpt-4.1",
        temperature: float = 0.7,
        max_tokens: int = 16000,
        retry_count: int = 3,
    ):
        self.retry_count = retry_count

        # 这里的参数名根据你当前的 LangChain 版本来：
        # 老版本：ChatOpenAI(openai_api_key=..., openai_api_base=..., model_name=...)
        # 新版本：ChatOpenAI(api_key=..., base_url=..., model=...)
        self.llm = ChatOpenAI(
            openai_api_key=openai_api_key,
            openai_api_base=openai_api_base,
            model_name=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def generate_with_retry(
        self,
        system_prompt: str,
        user_prompt: str,
        retry_count: Optional[int] = None,
    ) -> str:
        """简单的带重试的对话封装（不影响你用 .llm 做 LCEL）"""
        retries = retry_count if retry_count is not None else self.retry_count
        last_error: Optional[Exception] = None

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]

        for _ in range(retries + 1):
            try:
                resp = await self.llm.agenerate([messages])
                return resp.generations[0][0].text
            except Exception as e:
                last_error = e

        raise last_error or Exception(f"LLM failed after {retries} retries")