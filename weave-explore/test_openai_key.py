import os
from pathlib import Path

from openai import OpenAI


def load_dotenv(path: str = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if value:
            os.environ[key.strip()] = value


load_dotenv()

client = OpenAI()

response = client.responses.create(
    model=os.environ.get("OPENAI_MODEL", "gpt-5.5-2026-04-23"),
    input="Reply with exactly: ok",
)

print(response.output_text)
