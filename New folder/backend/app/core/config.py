from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Pipeline Ops Backend"
    model_service_url: str = "http://localhost:8001"
    allow_mutating_actions: bool = False
    environment: str = "development"

    model_config = SettingsConfigDict(env_prefix="PIPELINE_OPS_", extra="ignore")


settings = Settings()
