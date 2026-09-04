"""Crisis scan (PRD §10) — first-line lexical signal detection.

⚠️ This is a STUB by design: a fast, lexical first pass wired in from day one so the
safety flow exists end-to-end. It is NOT a clinical classifier and must NOT be the sole
safeguard. Replace/augment with a trained model and human review (see Trust & Safety).

Contract is intentionally stable so the implementation can be swapped without touching
callers: `scan(text) -> CrisisResult`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.config import get_settings
from app.models.enums import SafetySignal

# Ordered by severity (most severe first). Word-boundary, case-insensitive.
#
# India-first product: English alone misses most real messages. Each signal also
# carries Hindi (Devanagari) and romanized Hinglish patterns — the register users
# actually type in ("marna chahta hun", "मरना चाहता हूं"). Romanized spelling varies
# wildly, so patterns allow the common vowel alternations (hu/hun/hoon, chahta/chahti).
_PATTERNS: list[tuple[SafetySignal, list[str]]] = [
    (
        SafetySignal.suicidal,
        [
            # English
            r"kill myself",
            r"end my life",
            r"want to die",
            r"suicid",
            r"better off dead",
            r"no reason to live",
            r"take my (own )?life",
            r"don'?t want to (be here|live)",
            # Hinglish (romanized Hindi)
            r"\bmar+na (?:chah?t[ai]|hai|h[ai])\b",  # marna chahta/chahti, marna hai
            r"\bmar (?:jaana|jana|jau[n]?|jaun)\b",  # mar jaana / mar jau
            r"\bjeena nahi\b",
            r"\bjina nahi\b",  # jeena nahi (chahta)
            r"\bzindagi (?:khatam|se (?:thak|pareshan))\b",  # zindagi khatam / se thak gaya
            r"\bkhud ?kushi\b",
            r"\bkhudkhushi\b",  # khudkushi (suicide)
            r"\baatma ?hatya\b",  # aatmahatya (suicide)
            r"\bjaan de (?:du|dena|dunga|dungi)\b",  # jaan de du / dena
            r"\bmar jaana chahta\b",
            # Hindi (Devanagari)
            r"मरना चाहत[ाी]",
            r"मर जाना",
            r"जीना नहीं",
            r"ख़?ुदकुशी",
            r"आत्म ?हत्या",
            r"जान दे द[ूें]",
            r"ज़िंदगी ख़?त्म",
        ],
    ),
    (
        SafetySignal.self_harm,
        [
            # English
            r"hurt myself",
            r"harm myself",
            r"cut myself",
            r"self[- ]?harm",
            r"cutting",
            # Hinglish
            r"\bkhud ko (?:chot|nuksaan|nukasan|maar)",
            r"\bhaath kaat",
            r"\bkalai kaat",
            # Hindi (Devanagari)
            r"खुद को (?:चोट|नुकसान)",
            r"हाथ काट",
            r"कलाई काट",
        ],
    ),
    (
        SafetySignal.abuse,
        [
            # English
            r"being abused",
            r"he hits me",
            r"she hits me",
            r"they hurt me",
            r"assault",
            r"raped",
            # Hinglish
            r"\b(?:mujhe|muje) (?:maart[ae]|pit+t[ae]) h[ai]",
            r"\bghar (?:pe|par) maar",
            r"\bbalatkar\b",
            r"\bzabardasti\b",
            # Hindi (Devanagari)
            r"मुझे (?:मारत[ाे]|पीटत[ाे])",
            r"बलात्कार",
            r"ज़बरदस्ती",
        ],
    ),
]

_COMPILED: list[tuple[SafetySignal, re.Pattern]] = [
    (signal, re.compile("|".join(f"(?:{p})" for p in pats), re.IGNORECASE))
    for signal, pats in _PATTERNS
]


@dataclass
class CrisisResult:
    triggered: bool
    signal: SafetySignal
    matched_terms: list[str] = field(default_factory=list)
    helplines: list[dict] = field(default_factory=list)

    @property
    def matched_str(self) -> str | None:
        return ", ".join(sorted(set(self.matched_terms)))[:255] or None


def scan(text: str) -> CrisisResult:
    """Scan inbound message text. Returns the highest-severity signal found, if any."""
    if not text or not text.strip():
        return CrisisResult(triggered=False, signal=SafetySignal.none)

    for signal, pattern in _COMPILED:  # severity order
        matches = pattern.findall(text)
        if matches:
            terms = [m if isinstance(m, str) else next((x for x in m if x), "") for m in matches]
            return CrisisResult(
                triggered=True,
                signal=signal,
                matched_terms=[t for t in terms if t],
                helplines=get_settings().helplines,
            )
    return CrisisResult(triggered=False, signal=SafetySignal.none)
