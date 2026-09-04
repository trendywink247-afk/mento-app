"""PII redaction coverage — the outbound-message anonymity guard (T&S #6/7).

Pure unit tests of services/moderation.redact — no DB, no Stream. Disclosed PII
(phone, email, age, introduced names) must be masked; ordinary support talk must pass
through untouched (false positives mangle a struggling person's words). Pins the
contract for any future detector swap. Presidio NER is optional and not required here;
these all pass on the regex layer alone.
"""

from __future__ import annotations

import pytest

from app.services import moderation


@pytest.mark.parametrize(
    "text,fragment,typ",
    [
        ("call me at 9876543210", "9876543210", "phone"),
        ("my number is 98765 43210", "98765 43210", "phone"),
        ("reach me at rahul.k@gmail.com anytime", "rahul.k@gmail.com", "email"),
        ("I am 22 years old", "22", "age"),
        ("age: 19", "19", "age"),
        ("my name is Rahul", "Rahul", "name"),
        ("this is Priya from Delhi", "Priya", "name"),
        ("मेरा नाम राहुल है", "राहुल", "name"),
    ],
)
def test_pii_is_redacted(text: str, fragment: str, typ: str) -> None:
    result = moderation.redact(text)
    assert result.redacted, f"should have redacted: {text!r}"
    assert fragment not in result.text, f"{fragment!r} leaked in {result.text!r}"
    assert typ in result.types


def test_multiple_pii_in_one_message() -> None:
    result = moderation.redact("I'm Rahul, call me at 9876543210 or rahul@x.com")
    assert result.redacted
    assert "Rahul" not in result.text
    assert "9876543210" not in result.text
    assert "rahul@x.com" not in result.text
    assert set(result.types) >= {"name", "phone", "email"}


@pytest.mark.parametrize(
    "text",
    [
        "thanks, that really helped a lot",
        "i feel so tired and alone today",
        "I am afraid of failing my exam",  # "afraid" is not a name (lowercase + stoplist)
        "I am Indian and proud of it",  # nationality, not a name (stoplist)
        "see you at 5",  # single digit — not a phone/age
        "I have 3 exams next week",
        "just wanted to say hi",
    ],
)
def test_benign_messages_pass_through(text: str) -> None:
    result = moderation.redact(text)
    assert not result.redacted, f"false positive on: {text!r}"
    assert result.text == text


def test_empty_text_is_untouched() -> None:
    assert not moderation.redact("").redacted
    assert not moderation.redact("   ").redacted


def test_disabled_flag_passes_through(monkeypatch) -> None:
    from app import config

    monkeypatch.setattr(config.get_settings(), "pii_redaction_enabled", False)
    result = moderation.redact("my name is Rahul, call 9876543210")
    assert not result.redacted
    assert result.text == "my name is Rahul, call 9876543210"
