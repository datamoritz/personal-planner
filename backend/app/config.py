from typing import List

from pydantic import field_validator
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

    APPLE_ICLOUD_EMAIL: str = ""
    APPLE_ICLOUD_APP_PASSWORD: str = ""
    APPLE_CALDAV_URL: str = "https://caldav.icloud.com"

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://personal-planner.vercel.app",
    ]

    @field_validator("APPLE_CALDAV_URL", mode="before")
    @classmethod
    def default_apple_caldav_url(cls, value: str | None) -> str:
        if value is None or not str(value).strip():
            return "https://caldav.icloud.com"
        return str(value).strip()

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
