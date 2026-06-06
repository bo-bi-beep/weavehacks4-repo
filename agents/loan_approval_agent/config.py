import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
DB_PATH: str = os.getenv("DB_PATH", "loan_agent.db")
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))

WANDB_API_KEY: str = os.getenv("WANDB_API_KEY", "")
WANDB_ENTITY: str = os.getenv("WANDB_ENTITY", "")
WANDB_PROJECT: str = os.getenv("WANDB_PROJECT", "loan-approval-agent")
