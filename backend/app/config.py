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
    EMAIL_AUTOMATION_CALENDAR_LABEL: str = "Planner/Calendar"
    EMAIL_AUTOMATION_TASK_LABEL: str = "Planner/Tasks"
    EMAIL_AUTOMATION_PROCESSED_LABEL: str = "Planner/Processed"
    EMAIL_AUTOMATION_ERROR_LABEL: str = "Planner/Error"
    EMAIL_AUTOMATION_TIMEZONE: str = "America/Denver"
    GOOGLE_DEFAULT_CALENDAR_NAME: str = "Atlanta"
    GOOGLE_EVENTS_CALENDAR_NAME: str = "Events"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""
    WATCHMODE_API_KEY: str = ""

    APPLE_ICLOUD_EMAIL: str = ""
    APPLE_ICLOUD_APP_PASSWORD: str = ""
    APPLE_CALDAV_URL: str = "https://caldav.icloud.com"
    APPLE_CARDDAV_URL: str = "https://contacts.icloud.com"

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://personal-planner.vercel.app",
        "https://personal-planner-sooty.vercel.app",
    ]

    @field_validator("APPLE_CALDAV_URL", mode="before")
    @classmethod
    def default_apple_caldav_url(cls, value: str | None) -> str:
        if value is None or not str(value).strip():
            return "https://caldav.icloud.com"
        return str(value).strip()

    @field_validator("APPLE_CARDDAV_URL", mode="before")
    @classmethod
    def default_apple_carddav_url(cls, value: str | None) -> str:
        if value is None or not str(value).strip():
            return "https://contacts.icloud.com"
        return str(value).strip()

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
