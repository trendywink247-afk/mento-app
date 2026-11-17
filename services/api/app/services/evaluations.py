"""Answer evaluations (DECISIONS T.8). A member sends photos of a written answer; a Mentor or Mento
Verified mentor returns written feedback. Off unless `evaluations_enabled`; no money moves.

Flow: draft (photos added one per request, each under the 5 MB request limit) -> send (the automatic
check) -> open -> claimed -> returned. Open work nobody claims expires; claimed work not returned
goes back to open. Anonymity holds both ways: the mentor never sees who sent it, the member sees
only the mentor's persona name.
"""

from __future__ import annotations

import base64
import binascii
import struct
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.errors import ApiProblem
from app.models.answer_evaluation import AnswerEvaluation, AnswerPage
from app.models.enums import VettingStatus
from app.models.listener import ListenerProfile
from app.services import crisis, safety, tiers
from app.services.matching import blocked_listener_ids

KINDS = ("mains", "essay")
AUDIENCES = ("everyone", "one")
MAX_PAGE_BYTES = 3 * 1024 * 1024  # base64 of this stays under the 5 MB request limit
MAX_PAGES = {"mains": 4, "essay": 12}
MAX_OPEN_PER_MEMBER = 3
OPEN_DAYS = 7  # unclaimed this long: expired, photos wiped
CLAIM_HOURS = 48  # claimed but not returned this long: back to open
KEEP_DAYS = 30  # photos kept this long after feedback, for the member to read beside it
DRAFT_HOURS = 24
MIN_FEEDBACK = 40
MAX_FEEDBACK = 4000

# What a returned evaluation would pay, falling with turnaround from the moment it was sent
# (founder, 2026-11-16: Mains about Rs 35-40, essays Rs 300-500). (hours, paise), first match wins.
TARIFF = {
    "mains": ((24, 4000), (72, 3500), (None, 3000)),
    "essay": ((48, 50000), (96, 40000), (None, 30000)),
}


def payout_for(kind: str, sent_at: datetime, returned_at: datetime) -> int:
    hours = (returned_at - sent_at).total_seconds() / 3600
    for limit, paise in TARIFF[kind]:
        if limit is None or hours <= limit:
            return paise
    return 0  # unreachable: the last step has no limit


# ---- the photo check -----------------------------------------------------------------------

_PNG = b"\x89PNG\r\n\x1a\n"
# PNG chunks that can carry words, places or times: dropped.
_PNG_DROP = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}


def _strip_jpeg(data: bytes) -> bytes | None:
    """Drop APP1..APP15 (EXIF, GPS, XMP, maker notes) and comments; keep APP0 (JFIF), APP14 (Adobe
    colour) and everything from the scan on. None when the file is not a well-formed JPEG."""
    out = bytearray(b"\xff\xd8")
    i = 2
    n = len(data)
    while i + 4 <= n:
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte
            i += 1
            continue
        if marker == 0xDA:  # start of scan: the image itself, copied as is
            out += data[i:]
            return bytes(out)
        (length,) = struct.unpack(">H", data[i + 2 : i + 4])
        if length < 2 or i + 2 + length > n:
            return None
        keep = not ((0xE1 <= marker <= 0xEF and marker != 0xEE) or marker == 0xFE)
        if keep:
            out += data[i : i + 2 + length]
        i += 2 + length
    return None


def _strip_png(data: bytes) -> bytes | None:
    out = bytearray(_PNG)
    i = len(_PNG)
    n = len(data)
    while i + 12 <= n:
        (length,) = struct.unpack(">I", data[i : i + 4])
        kind = data[i + 4 : i + 8]
        end = i + 12 + length
        if end > n:
            return None
        if kind not in _PNG_DROP:
            out += data[i:end]
        i = end
        if kind == b"IEND":
            return bytes(out)
    return None


def clean_photo(content_base64: str) -> tuple[str, bytes]:
    """(content type, bytes with metadata removed) for a JPG or PNG photo, or an ApiProblem."""
    try:
        data = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise ApiProblem(422, "bad_file", "That photo could not be read.") from None
    if not data:
        raise ApiProblem(422, "bad_file", "That photo is empty.")
    if len(data) > MAX_PAGE_BYTES:
        raise ApiProblem(413, "too_big", "That photo is too large. Please send one under 3 MB.")
    if data.startswith(b"\xff\xd8\xff"):
        kind, clean = "image/jpeg", _strip_jpeg(data)
    elif data.startswith(_PNG):
        kind, clean = "image/png", _strip_png(data)
    else:
        raise ApiProblem(422, "bad_type", "Please send a photo (JPG or PNG).")
    if not clean:
        raise ApiProblem(422, "bad_file", "That photo could not be read.")
    return kind, clean


# ---- member side ---------------------------------------------------------------------------


def _mine(db: Session, user_id: str, evaluation_id: str) -> AnswerEvaluation:
    ev = db.get(AnswerEvaluation, evaluation_id)
    if ev is None or ev.user_id != user_id:
        raise ApiProblem(404, "not_found", "Not found.")
    return ev


def can_evaluate(li: ListenerProfile | None) -> bool:
    """Approved Mentors and Mento Verified take evaluations; peer listeners do not."""
    return _can_evaluate(li)


def _can_evaluate(li: ListenerProfile | None) -> bool:
    return (
        li is not None
        and li.vetting_status == VettingStatus.approved
        and tiers.tier_of(li) in (tiers.MENTOR, tiers.VERIFIED)
    )


def start(
    db: Session,
    user_id: str,
    *,
    kind: str,
    audience: str,
    target_listener_id: str | None,
    question: str | None,
    note: str | None,
) -> AnswerEvaluation:
    if kind not in KINDS:
        raise ApiProblem(422, "bad_kind", "Choose Mains answer or essay.")
    if audience not in AUDIENCES:
        raise ApiProblem(422, "bad_audience", "Choose everyone or one mentor.")
    if audience == "one":
        li = db.get(ListenerProfile, target_listener_id) if target_listener_id else None
        if not _can_evaluate(li) or li.id in blocked_listener_ids(db, user_id):
            raise ApiProblem(422, "bad_mentor", "That mentor cannot take evaluations.")
    else:
        target_listener_id = None
    live = db.scalar(
        select(func.count())
        .select_from(AnswerEvaluation)
        .where(
            AnswerEvaluation.user_id == user_id,
            AnswerEvaluation.status.in_(("draft", "open", "claimed")),
        )
    )
    if (live or 0) >= MAX_OPEN_PER_MEMBER:
        raise ApiProblem(
            409, "too_many", "You have answers waiting. Send more once one comes back."
        )
    ev = AnswerEvaluation(
        user_id=user_id,
        kind=kind,
        audience=audience,
        target_listener_id=target_listener_id,
        question=(question or "").strip()[:500] or None,
        note=(note or "").strip()[:500] or None,
        status="draft",
    )
    db.add(ev)
    db.flush()
    return ev


def page_count(db: Session, evaluation_id: str) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(AnswerPage)
            .where(AnswerPage.evaluation_id == evaluation_id)
        )
        or 0
    )


def add_page(db: Session, user_id: str, evaluation_id: str, content_base64: str) -> int:
    ev = _mine(db, user_id, evaluation_id)
    if ev.status != "draft":
        raise ApiProblem(409, "already_sent", "This answer has already been sent.")
    count = page_count(db, ev.id)
    if count >= MAX_PAGES[ev.kind]:
        raise ApiProblem(409, "too_many_pages", f"Up to {MAX_PAGES[ev.kind]} photos.")
    content_type, data = clean_photo(content_base64)
    db.add(
        AnswerPage(
            evaluation_id=ev.id,
            idx=count,
            content_type=content_type,
            size_bytes=len(data),
            content=data,
        )
    )
    db.flush()
    return count + 1


@dataclass
class Sent:
    evaluation: AnswerEvaluation
    crisis: crisis.CrisisResult | None


def send(db: Session, user_id: str, evaluation_id: str, now: datetime | None = None) -> Sent:
    """The automatic check: at least one clean photo, and the member's own words through the
    crisis scan (T&S: every message). A crisis signal still sends the answer, and the member
    gets the helpline card, as a request does."""
    ev = _mine(db, user_id, evaluation_id)
    if ev.status != "draft":
        raise ApiProblem(409, "already_sent", "This answer has already been sent.")
    if page_count(db, ev.id) == 0:
        raise ApiProblem(422, "no_pages", "Add a photo of your answer first.")
    words = " ".join(w for w in (ev.question, ev.note) if w)
    found = None
    if words:
        result = safety.scan_and_flag(db, text=words, user_id=user_id)
        found = result if result.triggered else None
    ev.status = "open"
    ev.sent_at = now or datetime.now(UTC)
    db.flush()
    return Sent(evaluation=ev, crisis=found)


def wipe_pages(db: Session, ev: AnswerEvaluation, now: datetime | None = None) -> None:
    db.execute(update(AnswerPage).where(AnswerPage.evaluation_id == ev.id).values(content=None))
    ev.pages_wiped_at = now or datetime.now(UTC)


def withdraw(db: Session, user_id: str, evaluation_id: str) -> AnswerEvaluation:
    ev = _mine(db, user_id, evaluation_id)
    if ev.status not in ("draft", "open", "claimed"):
        raise ApiProblem(409, "not_open", "This answer is no longer waiting.")
    ev.status = "withdrawn"
    wipe_pages(db, ev)
    db.flush()
    return ev


def mine(db: Session, user_id: str) -> list[AnswerEvaluation]:
    return list(
        db.scalars(
            select(AnswerEvaluation)
            .where(AnswerEvaluation.user_id == user_id, AnswerEvaluation.status != "draft")
            .order_by(AnswerEvaluation.created_at.desc())
            .limit(50)
        )
    )


# ---- mentor side ---------------------------------------------------------------------------


def _visible_to(li: ListenerProfile):
    """Open work this mentor may see: sent to everyone, or to them by name; plus what they hold."""
    return or_(
        (AnswerEvaluation.status == "open")
        & or_(
            AnswerEvaluation.audience == "everyone",
            AnswerEvaluation.target_listener_id == li.id,
        ),
        (AnswerEvaluation.status.in_(("claimed", "returned")))
        & (AnswerEvaluation.listener_id == li.id),
    )


def queue(db: Session, li: ListenerProfile) -> list[AnswerEvaluation]:
    if not _can_evaluate(li):
        return []
    return list(
        db.scalars(
            select(AnswerEvaluation)
            .where(_visible_to(li))
            .order_by(AnswerEvaluation.sent_at.asc())
            .limit(100)
        )
    )


def for_mentor(db: Session, li: ListenerProfile, evaluation_id: str) -> AnswerEvaluation:
    ev = db.get(AnswerEvaluation, evaluation_id)
    if ev is None or not _can_evaluate(li):
        raise ApiProblem(404, "not_found", "Not found.")
    open_to_me = ev.status == "open" and (
        ev.audience == "everyone" or ev.target_listener_id == li.id
    )
    held = ev.listener_id == li.id and ev.status in ("claimed", "returned")
    if not (open_to_me or held):
        raise ApiProblem(404, "not_found", "Not found.")
    return ev


def claim(db: Session, li: ListenerProfile, evaluation_id: str, now: datetime | None = None):
    ev = for_mentor(db, li, evaluation_id)
    if ev.status != "open":
        raise ApiProblem(409, "taken", "Someone else has taken this one.")
    # Compare-and-set, so two mentors tapping at once cannot both hold it.
    took = db.execute(
        update(AnswerEvaluation)
        .where(AnswerEvaluation.id == ev.id, AnswerEvaluation.status == "open")
        .values(status="claimed", listener_id=li.id, claimed_at=now or datetime.now(UTC))
    ).rowcount
    if not took:
        raise ApiProblem(409, "taken", "Someone else has taken this one.")
    db.refresh(ev)
    return ev


def give_back(
    db: Session, li: ListenerProfile, evaluation_id: str, feedback: str, now: datetime | None = None
) -> AnswerEvaluation:
    ev = for_mentor(db, li, evaluation_id)
    if ev.status != "claimed" or ev.listener_id != li.id:
        raise ApiProblem(409, "not_yours", "Take this answer before returning it.")
    text = (feedback or "").strip()
    if len(text) < MIN_FEEDBACK:
        raise ApiProblem(422, "too_short", "Please write a little more feedback.")
    if len(text) > MAX_FEEDBACK:
        raise ApiProblem(422, "too_long", "Please keep feedback under 4,000 characters.")
    at = now or datetime.now(UTC)
    ev.feedback = text
    ev.status = "returned"
    ev.returned_at = at
    ev.payout_paise = payout_for(ev.kind, ev.sent_at or at, at)
    db.flush()
    return ev


def mentor_counts(db: Session, li: ListenerProfile) -> dict[str, int]:
    """For the Earnings card: work waiting for this mentor, work they returned, and what it would
    have paid (a record only)."""
    if not _can_evaluate(li):
        return {"waiting": 0, "returned": 0, "paise": 0}
    waiting = db.scalar(
        select(func.count())
        .select_from(AnswerEvaluation)
        .where(
            or_(
                (AnswerEvaluation.status == "open")
                & or_(
                    AnswerEvaluation.audience == "everyone",
                    AnswerEvaluation.target_listener_id == li.id,
                ),
                (AnswerEvaluation.status == "claimed") & (AnswerEvaluation.listener_id == li.id),
            )
        )
    )
    returned, paise = db.execute(
        select(func.count(), func.coalesce(func.sum(AnswerEvaluation.payout_paise), 0)).where(
            AnswerEvaluation.status == "returned", AnswerEvaluation.listener_id == li.id
        )
    ).one()
    return {"waiting": waiting or 0, "returned": returned or 0, "paise": int(paise or 0)}


# ---- the daily sweep -------------------------------------------------------------------------


def sweep(db: Session, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(UTC)
    counts = {"expired": 0, "reopened": 0, "wiped": 0, "drafts": 0}
    for ev in db.scalars(
        select(AnswerEvaluation).where(
            AnswerEvaluation.status == "open",
            AnswerEvaluation.sent_at < now - timedelta(days=OPEN_DAYS),
        )
    ):
        ev.status = "expired"
        wipe_pages(db, ev, now)
        counts["expired"] += 1
    counts["reopened"] = db.execute(
        update(AnswerEvaluation)
        .where(
            AnswerEvaluation.status == "claimed",
            AnswerEvaluation.claimed_at < now - timedelta(hours=CLAIM_HOURS),
        )
        .values(status="open", listener_id=None, claimed_at=None)
    ).rowcount
    for ev in db.scalars(
        select(AnswerEvaluation).where(
            AnswerEvaluation.status == "returned",
            AnswerEvaluation.pages_wiped_at.is_(None),
            AnswerEvaluation.returned_at < now - timedelta(days=KEEP_DAYS),
        )
    ):
        wipe_pages(db, ev, now)
        counts["wiped"] += 1
    stale = list(
        db.scalars(
            select(AnswerEvaluation.id).where(
                AnswerEvaluation.status == "draft",
                AnswerEvaluation.created_at < now - timedelta(hours=DRAFT_HOURS),
            )
        )
    )
    for ev_id in stale:
        db.delete(db.get(AnswerEvaluation, ev_id))
    counts["drafts"] = len(stale)
    db.flush()
    return counts
