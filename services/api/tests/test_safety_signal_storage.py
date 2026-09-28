"""T8.5 — a safety flag stores signal, category, score and source. Never text.

Invariant 5 (program plan): `safety_flags` holds the type, category and score of a
signal — which lane raised it, how sure it was — and nothing a person wrote. These
tests pin both halves: the new columns are filled, and no column on the row carries
any fragment of the message.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import String, select

from app.models.enums import SafetySignal
from app.models.safety import FLAG_SOURCES, SafetyFlag
from app.services import safety
from tests.conftest import requires_postgres

pytestmark = requires_postgres

MESSAGE = "honestly I want to end my life tonight, nobody would notice"


def _only_flag(db_session) -> SafetyFlag:
    return db_session.execute(select(SafetyFlag)).scalar_one()


def test_lexicon_flag_records_category_score_and_source(db_session) -> None:
    result = safety.scan_and_flag(db_session, text=MESSAGE, user_id=str(uuid.uuid4()))
    assert result.triggered

    flag = _only_flag(db_session)
    assert flag.signal == SafetySignal.suicidal
    assert flag.source == "lexicon"
    assert flag.category == SafetySignal.suicidal.value
    # A lexicon hit is a hard match, not a probability.
    assert flag.risk_score == 1.0


def test_no_column_of_a_flag_holds_message_text(db_session) -> None:
    safety.scan_and_flag(
        db_session,
        text=MESSAGE,
        user_id=str(uuid.uuid4()),
        conversation_id=str(uuid.uuid4()),
        stream_message_id="m-signal-only",
    )
    flag = _only_flag(db_session)

    fragments = [w for w in MESSAGE.lower().split() if len(w) > 3] + ["end my life"]
    for column in SafetyFlag.__table__.columns:
        if not isinstance(column.type, String):
            continue
        value = getattr(flag, column.key)
        text = (value.value if hasattr(value, "value") else value) or ""
        for fragment in fragments:
            assert fragment not in str(text).lower(), (column.key, fragment)


def test_other_lanes_can_record_their_own_category_and_score(db_session) -> None:
    """The phrase bank (T8.3) and the guard model (T8.4) share this write — each
    names itself and brings its own category and confidence."""
    safety.scan_and_flag(
        db_session,
        text=MESSAGE,
        user_id=str(uuid.uuid4()),
        source="guard",
        category="self_harm_intent",
        risk_score=0.83,
    )
    flag = _only_flag(db_session)
    assert (flag.source, flag.category, flag.risk_score) == ("guard", "self_harm_intent", 0.83)


@pytest.mark.parametrize("score", [-0.1, 1.5])
def test_risk_score_outside_zero_to_one_is_refused(db_session, score: float) -> None:
    with pytest.raises(ValueError):
        safety.scan_and_flag(db_session, text=MESSAGE, user_id="u", risk_score=score)


def test_unknown_source_is_refused(db_session) -> None:
    assert "lexicon" in FLAG_SOURCES
    with pytest.raises(ValueError):
        safety.scan_and_flag(db_session, text=MESSAGE, user_id="u", source="vibes")


def test_benign_text_writes_nothing(db_session) -> None:
    safety.scan_and_flag(db_session, text="had a long day at the library", user_id="u")
    assert db_session.execute(select(SafetyFlag)).first() is None
