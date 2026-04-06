from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import check_db_connection
from app.routers import ai, apple_calendar, email, google, planner, projects, recurrent_tasks, tags, tasks

app = FastAPI(title="Planner API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router)
app.include_router(projects.router)
app.include_router(planner.router)
app.include_router(recurrent_tasks.router)
app.include_router(tags.router)
app.include_router(google.router)
app.include_router(apple_calendar.router)
app.include_router(email.router)
app.include_router(ai.router)


@app.get("/")
def root():
    return {"message": "Planner API is running", "env": settings.ENV}


@app.get("/health")
def health():
    try:
        check_db_connection()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "database": "disconnected", "detail": str(e)},
        )
