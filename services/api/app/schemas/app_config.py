"""What the app may switch on without a release (DECISIONS R.10, R.11)."""

from pydantic import BaseModel


class AppConfigOut(BaseModel):
    # R.11: a verification step at signup. A stub today: the step is empty and skipped
    # while this is false (the default).
    signup_verification_required: bool = False
    # R.10: from the second visit a member adds and confirms an email. Off until an email
    # service is configured (EMAIL_PROVIDER), the privacy policy says so, and it is reviewed.
    email_required_from_second_visit: bool = False
