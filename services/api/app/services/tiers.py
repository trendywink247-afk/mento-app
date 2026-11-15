"""Three tiers (DECISIONS R.4) and who may take which request (R.5) — one place.

    listener  Peer listener: has not cleared prelims. Listens; does not mentor.
    mentor    Cleared prelims or mains, proof checked by an admin (`ListenerProfile.tier`).
    verified  Mento Verified: in-service, invite-only (`ListenerProfile.certified_exam`).

Request audiences (ConversationRequest.audience / MatchAsk.audience / MatchRequest.audience):

    any         every approved mentor (older builds, signup's instant connect)
    in_service  Mento Verified only            (DECISIONS Q.3, kept for older builds)
    peer        everyone but Mento Verified    (Q.3, kept for older builds)
    listeners   "Connect now": listeners and Mentors, never Mento Verified (R.5)
    mentorship  "Start mentorship": Mentors and Mento Verified, never listeners (R.5)

Every rule below exists twice, once over Python values and once over SQL expressions, so
the inbox listing, the live-event recipients and the accept check can never disagree.
"""

from __future__ import annotations

from sqlalchemy import String, and_, false, literal, or_
from sqlalchemy.sql.elements import ColumnElement

LISTENER = "listener"
MENTOR = "mentor"
VERIFIED = "verified"
TIERS = (LISTENER, MENTOR, VERIFIED)

AUDIENCES = ("any", "in_service", "peer", "listeners", "mentorship")


def tier_of(profile) -> str:
    """The one tier a mentor profile holds. Mento Verified wins; then an admin-set Mentor."""
    if bool(getattr(profile, "certified_exam", False)):
        return VERIFIED
    if getattr(profile, "tier", None) == MENTOR:
        return MENTOR
    return LISTENER


def audience_allows(audience: str, tier: str) -> bool:
    if audience == "in_service":
        return tier == VERIFIED
    if audience in ("peer", "listeners"):
        return tier != VERIFIED
    if audience == "mentorship":
        return tier in (MENTOR, VERIFIED)
    return True


def audiences_for(tier: str) -> list[str]:
    """The `audience` values a mentor of this tier may take (for an inbox query)."""
    return [a for a in AUDIENCES if audience_allows(a, tier)]


def _expr(value) -> ColumnElement:
    """A column, attribute or SQL expression passes through; a Python value becomes a literal."""
    if isinstance(value, ColumnElement) or hasattr(value, "__clause_element__"):
        return value
    if value is None or isinstance(value, str):
        return literal(value, String(16))
    return literal(value)


def is_mentor_clause(certified, tier) -> ColumnElement[bool]:
    """SQL: the profile is a Mentor or Mento Verified."""
    certified, tier = _expr(certified), _expr(tier)
    return or_(certified.is_(True), and_(tier.is_not(None), tier == MENTOR))


def audience_clause(audience, certified, tier) -> ColumnElement[bool]:
    """SQL: a mentor with these columns may take a request with this `audience` column."""
    a, certified = _expr(audience), _expr(certified)
    return or_(
        a == "any",
        and_(a == "in_service", certified.is_(True)),
        and_(a.in_(("peer", "listeners")), certified.is_(False)),
        and_(a == "mentorship", is_mentor_clause(certified, tier)),
    )


def pool_clause(audience: str, certified, tier) -> ColumnElement[bool] | None:
    """SQL filter on mentor profiles for picking someone for `audience` (None = no filter)."""
    if audience == "in_service":
        return _expr(certified).is_(True)
    if audience in ("peer", "listeners"):
        return _expr(certified).is_(False)
    if audience == "mentorship":
        return is_mentor_clause(certified, tier)
    if audience not in AUDIENCES:
        return false()
    return None
