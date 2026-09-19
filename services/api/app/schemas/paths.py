"""Path (Communities)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PathTree(BaseModel):
    """Pathfinder question tree — the client walks it blindly (data-driven)."""

    root: str
    nodes: dict


class PathChoice(BaseModel):
    community: str = Field(min_length=1, max_length=32)
    stage: str = Field(min_length=1, max_length=48)


class PathCommunityOut(BaseModel):
    slug: str
    name: str
    tagline: str


class PathStageOut(BaseModel):
    id: str
    title: str
    blurb: str


class PathSeasonalOut(BaseModel):
    """The emotional-calendar card active right now."""

    title: str
    body: str


class PathState(BaseModel):
    community: PathCommunityOut | None
    stage: PathStageOut | None
    prompts: list[str]
    seasonal: PathSeasonalOut | None
    listeners_online: int
