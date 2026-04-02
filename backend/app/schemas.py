import uuid
from datetime import datetime, date, time
from typing import List, Optional

from pydantic import BaseModel, model_validator


# ---------------------------------------------------------------------------
# Recurrent tasks
# ---------------------------------------------------------------------------

class RecurringTaskGenerationRequest(BaseModel):
    start_date: date
    end_date: date


class RecurringTaskGenerationResponse(BaseModel):
    created_count: int
    created_task_ids: list[int]


class RecurrentTaskBase(BaseModel):
    project_id: Optional[int] = None
    title: str
    location: str = "backlog"
    notes: Optional[str] = None
    recurrence_rule: str
    default_start_time: Optional[time] = None
    default_end_time: Optional[time] = None
    is_active: bool = True


class RecurrentTaskCreate(RecurrentTaskBase):
    client_id: Optional[uuid.UUID] = None


class RecurrentTaskUpdate(BaseModel):
    project_id: Optional[int] = None
    title: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    recurrence_rule: Optional[str] = None
    default_start_time: Optional[time] = None
    default_end_time: Optional[time] = None
    is_active: Optional[bool] = None


class RecurrentTaskRead(RecurrentTaskBase):
    id: int
    client_id: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Calendar entries
# ---------------------------------------------------------------------------

class CalendarEntryBase(BaseModel):
    title: str
    notes: Optional[str] = None
    entry_date: date
    start_time: time
    end_time: time


class CalendarEntryCreate(CalendarEntryBase):
    client_id: Optional[uuid.UUID] = None


class CalendarEntryUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    entry_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None


class CalendarEntryRead(CalendarEntryBase):
    id: int
    client_id: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Google Calendar events
# ---------------------------------------------------------------------------

class GoogleTimedEventCreate(BaseModel):
    title: str
    date: date
    end_date: Optional[date] = None
    start_time: time
    end_time: time
    notes: Optional[str] = None
    tz: str = "America/Denver"


class GoogleTimedEventOut(BaseModel):
    id: str
    title: str
    startDate: str
    endDate: str
    date: str
    startTime: str
    endTime: str
    notes: Optional[str] = None
    createdAt: str
    updatedAt: str


class GoogleTimedEventUpdate(BaseModel):
    title: str
    date: date
    end_date: Optional[date] = None
    start_time: time
    end_time: time
    notes: Optional[str] = None
    tz: str = "America/Denver"


class GoogleAllDayEventCreate(BaseModel):
    title: str
    date: date
    end_date: Optional[date] = None
    notes: Optional[str] = None


class GoogleAllDayEventOut(BaseModel):
    id: str
    title: str
    date: str
    endDate: str
    source: str = "google"
    notes: Optional[str] = None
    createdAt: str
    updatedAt: str


class GoogleAllDayEventUpdate(BaseModel):
    title: str
    date: date
    end_date: Optional[date] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# AI helpers
# ---------------------------------------------------------------------------

class EmojiSuggestionRequest(BaseModel):
    title: str


class EmojiSuggestionResponse(BaseModel):
    emoji: str


# ---------------------------------------------------------------------------
# Google connection status
# ---------------------------------------------------------------------------

class GoogleConnectionStatus(BaseModel):
    connected: bool
    gmailReady: bool
    needsReconnect: bool = False


# ---------------------------------------------------------------------------
# Email helpers
# ---------------------------------------------------------------------------

class RecentEmailItem(BaseModel):
    id: str
    subject: str
    snippet: str
    sender: str | None = None
    receivers: list[str] = []
    receivedAt: str


class EmailContent(BaseModel):
    id: str
    subject: str
    body: str


class EmailTaskSuggestion(BaseModel):
    title: str | None = None
    notes: str | None = None
    taskDate: str | None = None
    startTime: str | None = None
    endTime: str | None = None
    location: str | None = None
    status: str | None = None
    tagName: str | None = None
    projectTitle: str | None = None


class EmailTaskSuggestionRequest(BaseModel):
    promptAddition: str | None = None


# ---------------------------------------------------------------------------
# AI helpers
# ---------------------------------------------------------------------------

class EmojiSuggestionRequest(BaseModel):
    title: str


class EmojiSuggestionResponse(BaseModel):
    emoji: str


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectCreate(BaseModel):
    client_id: Optional[uuid.UUID] = None
    tag_id: int | None = None
    title: str
    color: str | None = None


class ProjectUpdate(BaseModel):
    tag_id: int | None = None
    title: Optional[str] = None
    color: Optional[str] = None
    is_finished: Optional[bool] = None
    sort_order: Optional[int] = None


class ProjectOut(BaseModel):
    id: int
    client_id: Optional[uuid.UUID] = None
    tag_id: int | None
    title: str
    color: str | None
    is_finished: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

class TaskCreate(BaseModel):
    client_id: Optional[uuid.UUID] = None
    title: str
    notes: str | None = None
    location: str = "backlog"
    status: str = "pending"
    task_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    project_id: int | None = None
    recurrent_task_id: int | None = None
    tag_id: int | None = None
    sort_order: int = 0


class TaskRead(BaseModel):
    id: int
    client_id: Optional[uuid.UUID] = None
    title: str
    location: str
    notes: Optional[str] = None
    status: str
    task_date: Optional[date] = None  # nullable in model — fixed from non-optional
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    project_id: Optional[int] = None
    recurrent_task_id: Optional[int] = None
    tag_id: Optional[int] = None
    sort_order: int
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TaskUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    location: Optional[str] = None
    status: str | None = None
    task_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    project_id: int | None = None
    recurrent_task_id: int | None = None
    tag_id: int | None = None
    sort_order: int | None = None
    completed_at: datetime | None = None


class TaskOut(BaseModel):
    id: int
    client_id: Optional[uuid.UUID] = None
    title: str
    notes: str | None
    location: str  # was missing from original TaskOut
    status: str
    task_date: date | None
    start_time: time | None
    end_time: time | None
    project_id: int | None
    recurrent_task_id: int | None
    tag_id: int | None
    sort_order: int
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BulkTaskCreate(BaseModel):
    tasks: List[TaskCreate] | str

    @model_validator(mode="before")
    @classmethod
    def parse_tasks_string(cls, values: dict) -> dict:
        import json
        raw = values.get("tasks")
        if isinstance(raw, str):
            try:
                values["tasks"] = json.loads(raw)
            except json.JSONDecodeError as e:
                raise ValueError(f"tasks string is not valid JSON: {e}")
        return values

    @model_validator(mode="after")
    def tasks_not_empty(self) -> "BulkTaskCreate":
        if not self.tasks:
            raise ValueError("tasks must be a non-empty array")
        return self


class BulkTaskOut(BaseModel):
    count: int
    created: List[TaskOut]


class ProjectWithTasksCreate(BaseModel):
    project: "ProjectCreate | str"
    tasks: List[TaskCreate] | str

    @model_validator(mode="before")
    @classmethod
    def parse_strings(cls, values: dict) -> dict:
        import json
        for field in ("project", "tasks"):
            raw = values.get(field)
            if isinstance(raw, str):
                try:
                    values[field] = json.loads(raw)
                except json.JSONDecodeError as e:
                    raise ValueError(f"'{field}' string is not valid JSON: {e}")
        return values

    @model_validator(mode="after")
    def tasks_not_empty(self) -> "ProjectWithTasksCreate":
        if not self.tasks:
            raise ValueError("tasks must be a non-empty array")
        return self


class ProjectWithTasksOut(BaseModel):
    project: ProjectOut
    tasks_count: int
    tasks: List[TaskOut]


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

class TagCreate(BaseModel):
    client_id: Optional[uuid.UUID] = None
    name: str
    color: Optional[str] = None


class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class TagRead(BaseModel):
    id: int
    client_id: Optional[uuid.UUID] = None
    name: str
    color: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

class AgendaResponse(BaseModel):
    tasks: list[TaskRead]
    calendar_entries: list[CalendarEntryRead]
