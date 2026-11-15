"""GET /app-config — the switches the app reads before (and after) sign-in.

Public and identity-free: it says only which optional steps are on. Additive fields only
(CLAUDE.md API rules); an older app simply ignores what it does not know.
"""

from fastapi import APIRouter

from app.config import get_settings
from app.schemas.app_config import AppConfigOut

router = APIRouter(tags=["app-config"])


@router.get("/app-config", response_model=AppConfigOut)
def app_config() -> AppConfigOut:
    s = get_settings()
    return AppConfigOut(
        signup_verification_required=s.signup_verification_required,
        # Never on without a way to send the code: a member must never be asked for a code
        # that cannot arrive.
        email_required_from_second_visit=s.email_required_from_second_visit
        and s.email_provider != "log",
    )
