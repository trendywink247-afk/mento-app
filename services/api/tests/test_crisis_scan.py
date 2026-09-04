"""Crisis lexicon coverage — English, Hinglish (romanized), and Hindi (Devanagari).

Pure unit tests of services/crisis.scan — no DB, no Stream. India-first product:
the scan MUST fire on the register users actually type in, not just English
(Trust & Safety #1). These tests pin the contract for every future lexicon or
model swap: the phrases below must always trigger, the benign ones never.
"""

from __future__ import annotations

import pytest

from app.models.enums import SafetySignal
from app.services import crisis


@pytest.mark.parametrize(
    "text",
    [
        # English
        "I want to die",
        "i've been thinking about ending it, no reason to live",
        # Hinglish (romanized)
        "bas ab marna chahta hun",
        "mujhe marna hai yaar",
        "ab jeena nahi chahta",
        "mar jaana chahta hu",
        "khudkushi karne ka mann karta hai",
        "jaan de dunga ab",
        # Hindi (Devanagari)
        "मैं मरना चाहता हूं",
        "अब जीना नहीं चाहती",
        "आत्महत्या के बारे में सोच रहा हूं",
    ],
)
def test_suicidal_signals_trigger(text: str) -> None:
    result = crisis.scan(text)
    assert result.triggered, f"should have triggered: {text!r}"
    assert result.signal == SafetySignal.suicidal


@pytest.mark.parametrize(
    "text,signal",
    [
        ("kabhi kabhi khud ko chot pahunchata hun", SafetySignal.self_harm),
        ("maine kalai kaat li thi", SafetySignal.self_harm),
        ("खुद को नुकसान पहुंचाना चाहता हूं", SafetySignal.self_harm),
        ("mujhe maarte hai ghar pe", SafetySignal.abuse),
        ("uske saath zabardasti hui", SafetySignal.abuse),
        ("मुझे मारते हैं रोज़", SafetySignal.abuse),
    ],
)
def test_self_harm_and_abuse_signals_trigger(text: str, signal: SafetySignal) -> None:
    result = crisis.scan(text)
    assert result.triggered, f"should have triggered: {text!r}"
    assert result.signal == signal


@pytest.mark.parametrize(
    "text",
    [
        # Benign English
        "thanks, that really helped a lot",
        "my exam is killing me lol",  # figurative but no first-person pattern
        # Benign Hinglish — must not false-positive on common words
        "main market ja raha hun",  # "mar" inside "market" must not match
        "marne ki baat mat karo, sab theek hai",
        "zindagi acchi chal rahi hai",
        "kal ka din accha tha",
        # Benign Hindi
        "आज का दिन अच्छा था",
    ],
)
def test_benign_messages_do_not_trigger(text: str) -> None:
    result = crisis.scan(text)
    assert not result.triggered, f"false positive on: {text!r}"
    assert result.signal == SafetySignal.none


def test_severity_order_suicidal_wins() -> None:
    # A message with both self-harm and suicidal content reports the more severe signal.
    result = crisis.scan("I cut myself and I want to die")
    assert result.signal == SafetySignal.suicidal


def test_empty_text_is_untriggered() -> None:
    assert not crisis.scan("").triggered
    assert not crisis.scan("   ").triggered
