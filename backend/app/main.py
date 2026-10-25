from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import check_db_connection
from app.routers import ai, apple_calendar, email, email_automations, google, mandala, media, notepad, planner, projects, recurrent_tasks, sessions, tags, tasks, workload
from app.auth import authorize_request
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="Planner API", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def private_access(request: Request, call_next):
    try:
        await run_in_threadpool(authorize_request, request)
    except HTTPException as error:
        return JSONResponse(status_code=error.status_code, content={'detail': error.detail}, headers={'Cache-Control': 'no-store', 'X-Planner-Auth': 'required'})
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

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
app.include_router(email_automations.router)
app.include_router(ai.router)
app.include_router(media.router)
app.include_router(workload.router)
app.include_router(mandala.router)
app.include_router(notepad.router)
app.include_router(sessions.router)


@app.get("/")
def root():
    return {"message": "Planner API is running", "env": settings.ENV}


@app.get("/health")
def health():
    try:
        check_db_connection()
        return {"status": "ok", "database": "connected"}
    except Exception:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "database": "disconnected"},
        )
