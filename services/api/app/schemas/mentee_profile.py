"""The mentorship intake form / mentee profile (DECISIONS R.6, R.14). Every field optional."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.listeners import SupportOut

Stage = Literal["prelims", "mains", "interview"]


class Attempt(BaseModel):
    """One UPSC attempt and the marks the member chose to give for it (R.14). Mains and
    Optional marks exist only for an attempt that reached Mains; Interview only one that
    reached the Interview. Fields beyond what the stage allows are dropped, never refused."""

    year: int = Field(ge=2000, le=2100)
    # The furthest stage written that year.
    stage: Stage = "prelims"
    prelims_gs: float | None = Field(default=None, ge=0, le=200)
    prelims_csat: float | None = Field(default=None, ge=0, le=200)
    mains_gs1: float | None = Field(default=None, ge=0, le=250)
    mains_gs2: float | None = Field(default=None, ge=0, le=250)
    mains_gs3: float | None = Field(default=None, ge=0, le=250)
    mains_gs4: float | None = Field(default=None, ge=0, le=250)
    optional_1: float | None = Field(default=None, ge=0, le=250)
    optional_2: float | None = Field(default=None, ge=0, le=250)
    interview: float | None = Field(default=None, ge=0, le=275)

    @model_validator(mode="after")
    def _only_what_the_stage_allows(self) -> Attempt:
        if self.stage == "prelims":
            for f in (
                "mains_gs1",
                "mains_gs2",
                "mains_gs3",
                "mains_gs4",
                "optional_1",
                "optional_2",
            ):
                setattr(self, f, None)
        if self.stage != "interview":
            self.interview = None
        return self


MARK_FIELDS = (
    "prelims_gs",
    "prelims_csat",
    "mains_gs1",
    "mains_gs2",
    "mains_gs3",
    "mains_gs4",
    "optional_1",
    "optional_2",
    "interview",
)

Visibility = Literal["nobody", "mentors", "everyone"]


class MenteeProfileIn(BaseModel):
    exam: Literal["upsc"] | None = None
    current_stage: (
        Literal["starting", "prelims_prep", "mains_prep", "interview_prep", "between_attempts"]
        | None
    ) = None
    attempts_count: int | None = Field(default=None, ge=0, le=10)
    furthest_stage: Literal["none", "prelims", "mains", "interview"] | None = None
    optional_subject: str | None = Field(default=None, max_length=40)
    prep_mode: Literal["self", "coaching", "both", "working"] | None = None
    language: str | None = Field(default=None, max_length=8)
    help_with: list[
        Literal[
            "strategy",
            "answer_writing",
            "optional",
            "current_affairs",
            "revision",
            "motivation",
            "interview",
            "other",
        ]
    ] = Field(default_factory=list, max_length=8)
    # Crisis-scanned when saved (a mentor reads it with the request).
    note: str | None = Field(default=None, max_length=200)
    attempts: list[Attempt] = Field(default_factory=list, max_length=10)
    # Who may see marks (R.14): nobody, mentors only (Mentor + Mento Verified), or everyone.
    marks_visibility: Visibility = "mentors"


class MenteeProfileOut(MenteeProfileIn):
    updated_at: str | None = None
    # The helpline card, when the note tripped the crisis scan (the profile is still saved).
    support: SupportOut | None = None


class MenteeBriefOut(BaseModel):
    """What the mentor receiving this member's request sees (R.6): no name, no contact.
    `attempts` carries marks only when `marks_visibility` allows this mentor's tier."""

    exam: str | None = None
    current_stage: str | None = None
    attempts_count: int | None = None
    furthest_stage: str | None = None
    optional_subject: str | None = None
    prep_mode: str | None = None
    language: str | None = None
    help_with: list[str] = []
    note: str | None = None
    attempts: list[Attempt] = []
    marks_shown: bool = False
