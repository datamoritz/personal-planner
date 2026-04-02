from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    API_SECRET: str = ""
    ENV: str = "production"
    OPENAI_API_KEY: str = ""
    OPENAI_EMOJI_MODEL: str = "gpt-4.1-mini"
    OPENAI_TASK_MODEL: str = "gpt-4.1-mini"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://personal-planner.vercel.app",
    ]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
