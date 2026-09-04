"""Path (Communities): the Pathfinder tree + the user's chosen path.

A community is a lens (matching preference, tuned prompts, seasonal support copy) —
never a feed. No new PII: community + journey stage are coarse, self-declared, and
clearable; nothing here links to identity beyond the existing anonymous user row.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.schemas import PathChoice, PathState, PathTree
from app.security import current_user_id
from app.services import paths

router = APIRouter(prefix="/paths", tags=["paths"])


@router.get("/tree", response_model=PathTree)
def pathfinder_tree() -> PathTree:
    return PathTree(**paths.tree_payload())


def _state(db: Session, user: User) -> PathState:
    if not user.community_slug or not user.journey_stage:
        return PathState(community=None, stage=None, prompts=[], seasonal=None, listeners_online=0)
    slug, stage = user.community_slug, user.journey_stage
    online = db.execute(
        select(func.count())
        .select_from(ListenerProfile)
        .where(
            ListenerProfile.vetting_status == VettingStatus.approved,
            ListenerProfile.status == ListenerStatus.online,
            # Null community = serves everyone; never show an empty room.
            (ListenerProfile.community_slug == slug) | (ListenerProfile.community_slug.is_(None)),
        )
    ).scalar_one()
    return PathState(
        community=paths.community_info(slug),
        stage=paths.stage_info(slug, stage),
        prompts=paths.prompts_for(slug, stage),
        seasonal=paths.seasonal_card(slug),
        listeners_online=online,
    )


@router.get("/me", response_model=PathState)
def my_path(user_id: str = Depends(current_user_id), db: Session = Depends(get_db)) -> PathState:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return _state(db, user)


@router.put("/me", response_model=PathState)
def choose_path(
    payload: PathChoice,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> PathState:
    if not paths.is_valid(payload.community, payload.stage):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown community or stage")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    user.community_slug = payload.community
    user.journey_stage = payload.stage
    db.commit()
    db.refresh(user)
    return _state(db, user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def leave_path(user_id: str = Depends(current_user_id), db: Session = Depends(get_db)):
    # reason: no `-> None` — PEP 563 stringifies it and FastAPI 0.115 then infers a body,
    # which trips the 204-must-be-bodyless assert at import time.
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    user.community_slug = None
    user.journey_stage = None
    db.commit()
