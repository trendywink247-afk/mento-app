"""Onboarding + the member's own account."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.services import companions


class OnboardingStart(BaseModel):
    dob: date
    email: EmailStr | None = None  # optional, recovery only
    # Coerced, never rejected (services/companions): an older build with a retired
    # colour name must still get a person in. Unknown → None.
    companion_animal: str | None = Field(default=None, max_length=32)
    companion_colour: str | None = Field(default=None, max_length=32)
    # The member's own name for the companion — same never-reject rule: a name that
    # fails services/companions.clean_name is dropped, never a reason to refuse.
    companion_name: str | None = None
    # T3.2: a refresh-capable client asks for a short access token + refresh token
    # pair. Older clients omit it and keep getting the long-lived session token.
    refresh: bool = False
    device_id: str | None = Field(default=None, max_length=64)
    # The app's random per-install id (T3.7/T3.8). Stored only as a SHA-256; a
    # re-join and age-gate signal, never an identity. Older builds omit it.
    install_id: str | None = Field(default=None, max_length=128)
    # T3.9: the member agreed to the current terms on the way in (the age step).
    terms_accepted: bool = False

    @field_validator("companion_animal")
    @classmethod
    def _known_animal(cls, v: str | None) -> str | None:
        return companions.coerce_animal(v)

    @field_validator("companion_colour")
    @classmethod
    def _known_colour(cls, v: str | None) -> str | None:
        return companions.coerce_colour(v)

    @field_validator("companion_name")
    @classmethod
    def _kept_name(cls, v: str | None) -> str | None:
        return companions.coerce_name(v)


class PersonaOut(BaseModel):
    id: str
    persona_name: str
    persona_avatar: str


class OnboardingResult(BaseModel):
    session_token: str  # Mento anonymous JWT (the access token when refresh was asked)
    stream_token: str  # Stream Chat client token
    user: PersonaOut
    # Only when the client asked for `refresh` (T3.2).
    refresh_token: str | None = None
    expires_in: int | None = None


class MeOut(BaseModel):
    """What the app may read back about its own account: persona + companion.
    Never DOB, age or email."""

    id: str
    persona_name: str
    persona_avatar: str
    companion_animal: str | None
    companion_colour: str | None
    # Computed, never the DOB itself (lane u6, founder ruling D 2026-09-19): whether the
    # account passed the server-side age gate, and whether the member side has what it
    # needs (age gate + companion) — so "I'd rather talk today" asks only what is missing.
    has_dob: bool = True
    member_setup_complete: bool = False
    # Only ever returned to the member themself (never in a mentor or admin payload).
    companion_name: str | None = None
    # Standing (T3.7): "active" | "suspended" | "banned"; `status_until` bounds a
    # suspension or ban (null = until lifted). Additive; older builds ignore them.
    status: str = "active"
    status_until: str | None = None
    # Terms (T3.9): accepted the CURRENT version; `terms_required` = the gate is on and
    # they have not — the app then asks before any chat starts. Additive.
    terms_accepted: bool = False
    terms_required: bool = False
    # A recovery code exists (T3.5); the code itself is never readable again.
    has_recovery: bool = False


class CompanionUpdateIn(BaseModel):
    """PUT /me/companion. PATCH semantics: a field left out is unchanged, `null`
    clears it, an unknown value is a 422 naming the allowed set. `companion_name` is
    checked in the router (services/companions.clean_name) so its refusal carries
    `code: companion_name_invalid`; the bound here only caps the body."""

    companion_animal: str | None = Field(default=None, max_length=32)
    companion_colour: str | None = Field(default=None, max_length=32)
    companion_name: str | None = Field(default=None, max_length=companions.NAME_MAX * 8)

    @field_validator("companion_animal")
    @classmethod
    def _allowed_animal(cls, v: str | None) -> str | None:
        return None if v is None else companions.require_animal(v)

    @field_validator("companion_colour")
    @classmethod
    def _allowed_colour(cls, v: str | None) -> str | None:
        return None if v is None else companions.require_colour(v)

    @model_validator(mode="after")
    def _something_to_change(self) -> CompanionUpdateIn:
        if not self.model_fields_set:
            raise ValueError("send companion_animal, companion_colour and/or companion_name")
        return self


class RecoveryOut(BaseModel):
    """A fresh recovery code (T3.5) — returned once, never stored in the clear."""

    phrase: str


class RecoverIn(BaseModel):
    phrase: str = Field(max_length=64)
    device_id: str | None = Field(default=None, max_length=64)
