from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db

router = APIRouter(prefix="/notepad", tags=["notepad"])


def _read(db: Session) -> schemas.UncertaintyNotepadRead:
    state = db.get(models.UncertaintyNotepad, 1, populate_existing=True)
    return schemas.UncertaintyNotepadRead(
        text=state.text if state else "",
        revision=state.revision if state else 0,
    )


@router.get("", response_model=schemas.UncertaintyNotepadRead)
def read_notepad(db: Session = Depends(get_db)):
    return _read(db)


@router.put("", response_model=schemas.UncertaintyNotepadRead)
def update_notepad(payload: schemas.UncertaintyNotepadUpdate, db: Session = Depends(get_db)):
    # Compare and update in one SQL statement so concurrent devices cannot
    # silently overwrite each other, including the first save of the document.
    if payload.revision == 0:
        try:
            db.add(models.UncertaintyNotepad(id=1, text=payload.text, revision=1))
            db.commit()
            return schemas.UncertaintyNotepadRead(text=payload.text, revision=1)
        except IntegrityError:
            db.rollback()
    else:
        result = db.execute(
            update(models.UncertaintyNotepad)
            .where(models.UncertaintyNotepad.id == 1, models.UncertaintyNotepad.revision == payload.revision)
            .values(text=payload.text, revision=payload.revision + 1)
        )
        if result.rowcount == 1:
            db.commit()
            return schemas.UncertaintyNotepadRead(text=payload.text, revision=payload.revision + 1)
        db.rollback()

    current = _read(db)
    # A response may have been lost after a successful save. Retrying the same
    # text is safe and should not create another version or a false conflict.
    if current.text == payload.text:
        return current
    return JSONResponse(status_code=409, content={
        "detail": "The notepad changed on another device.",
        "current": current.model_dump(),
    })
