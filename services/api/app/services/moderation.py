"""PII redaction — local, on the message path, before delivery (Trust & Safety #6/7).

Anonymity is the promise: personas only, no real names/numbers leaking between two
strangers. This scans an OUTBOUND message and masks disclosed PII (phone, email, age,
introduced names) so the recipient never receives it. It runs ENTIRELY locally — no
message content ever leaves our servers (that was the whole reason to reject a cloud
model here).

Two layers:
  1. Regex (always on when `pii_redaction_enabled`): phone/id digit runs, emails, age
     disclosures, and name-introduction phrases ("my name is X", "mera naam X"). Zero
     dependencies — covers the common self-disclosure register directly.
  2. Presidio/spaCy NER (optional, auto-detected): catches bare person names the regex
     can't. If the package/model isn't installed it silently degrades to layer 1.

Contract is intentionally stable so the implementation can be swapped without touching
callers: `redact(text) -> RedactionResult`.

Design posture (matches the crisis scan): FAIL-OPEN. If redaction raises, the caller
delivers the original text — we never hard-block a support conversation on a PII scan.
Nothing here is ever persisted: no body, no redacted content (Trust & Safety #6).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from app.config import get_settings

logger = logging.getLogger("mento.moderation")

# --- masks (category-labelled so the redaction reads honestly to the recipient) ---
_MASK = {
    "email": "[email hidden]",
    "phone": "[number hidden]",
    "age": "[age hidden]",
    "name": "[name hidden]",
    "id": "[id hidden]",
}

# --- regex layer -----------------------------------------------------------------
# Email.
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")

# Indian mobile numbers (optionally +91-prefixed, optionally split once by space/dash),
# and long digit runs (Aadhaar/card/landline). 1–3 digit ages never collide with these.
_PHONE_RES = [
    re.compile(r"(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b"),  # 10-digit mobile
    re.compile(r"(?<!\d)\d{7,}(?!\d)"),  # 7+ digit id / landline
]

# Age disclosures — the NUMBER is captured (group 1); only that span is masked.
_AGE_RES = [
    re.compile(r"\b(\d{1,3})\s*(?:years?|yrs?|saal|y/?o)\b", re.I),
    re.compile(r"\b(?:age|umar|उम्र)\s*[:=]?\s*(\d{1,3})\b", re.I),
    re.compile(r"\b(?:i\s*am|i'?m|main)\s+(\d{1,2})\b", re.I),
]

# Name introductions. The prefix is case-insensitive (?i:...) but the captured name
# stays case-SENSITIVE (a leading capital) so "i am tired" never matches while
# "I am Rahul" does. A small stoplist kills the obvious non-name captures.
_NAME_RES = [
    re.compile(
        r"(?i:\b(?:my name is|i am|i'?m|this is|call me|myself|mera naam|naam hai)\s+)"
        r"([A-Z][a-zA-Z]+)"
    ),
    re.compile(r"(?:मेरा नाम|नाम है)\s+([ऀ-ॿ]+)"),  # Devanagari intro
]
_NAME_STOPWORDS = {
    "indian",
    "sorry",
    "fine",
    "okay",
    "ok",
    "good",
    "not",
    "so",
    "really",
    "here",
    "done",
    "sure",
    "glad",
    "happy",
    "sad",
    "tired",
    "back",
    "trying",
    "feeling",
    "just",
    "still",
    "also",
    "afraid",
    "scared",
    "alone",
    "lost",
    "done",
    "the",
    "a",
}

# --- optional Presidio NER -------------------------------------------------------
_analyzer = None
_analyzer_tried = False


def _presidio_spans(text: str) -> list[tuple[int, int, str]]:
    """Person/phone/email spans from Presidio, or [] if it isn't installed."""
    global _analyzer, _analyzer_tried
    if not get_settings().pii_use_presidio:
        return []
    if not _analyzer_tried:
        _analyzer_tried = True
        try:
            from presidio_analyzer import AnalyzerEngine

            _analyzer = AnalyzerEngine()
            logger.info("presidio NER enabled for PII redaction")
        except Exception:
            _analyzer = None
            logger.info("presidio unavailable — PII redaction is regex-only")
    if _analyzer is None:
        return []
    try:
        results = _analyzer.analyze(
            text=text,
            language="en",
            entities=["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS"],
        )
        mapping = {"PERSON": "name", "PHONE_NUMBER": "phone", "EMAIL_ADDRESS": "email"}
        return [
            (r.start, r.end, mapping[r.entity_type])
            for r in results
            if r.score >= 0.5 and r.entity_type in mapping
        ]
    except Exception:
        return []


@dataclass
class RedactionResult:
    redacted: bool
    text: str
    types: list[str] = field(default_factory=list)


def redact(text: str) -> RedactionResult:
    """Mask disclosed PII in `text`. Returns the (possibly-rewritten) text + the
    category tags found. Never raises for expected input — on any internal error the
    original text is returned unchanged (fail-open)."""
    if not get_settings().pii_redaction_enabled or not text or not text.strip():
        return RedactionResult(False, text, [])
    try:
        spans: list[tuple[int, int, str]] = []
        for m in _EMAIL_RE.finditer(text):
            spans.append((m.start(), m.end(), "email"))
        for rx in _PHONE_RES:
            for m in rx.finditer(text):
                spans.append((m.start(), m.end(), "phone"))
        for rx in _AGE_RES:
            for m in rx.finditer(text):
                spans.append((m.start(1), m.end(1), "age"))
        for rx in _NAME_RES:
            for m in rx.finditer(text):
                if m.group(1).lower() not in _NAME_STOPWORDS:
                    spans.append((m.start(1), m.end(1), "name"))
        spans.extend(_presidio_spans(text))

        if not spans:
            return RedactionResult(False, text, [])

        # Merge: leftmost-wins, drop any span overlapping one already kept.
        spans.sort(key=lambda s: (s[0], -(s[1] - s[0])))
        kept: list[tuple[int, int, str]] = []
        for s in spans:
            if kept and s[0] < kept[-1][1]:
                continue
            kept.append(s)

        out: list[str] = []
        types: set[str] = set()
        last = 0
        for start, end, typ in kept:
            out.append(text[last:start])
            out.append(_MASK[typ])
            types.add(typ)
            last = end
        out.append(text[last:])
        return RedactionResult(True, "".join(out), sorted(types))
    except Exception:  # fail-open — a redaction bug must never drop a message
        logger.exception("PII redaction failed — delivering original text")
        return RedactionResult(False, text, [])
