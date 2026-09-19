"""Care prompts (spec 2026-09-06 §4.5): deterministic per seed, Calm-register
content, and category slugs that stay in sync with services/categories.py."""

from __future__ import annotations

from app.services.care_prompts import PROMPTS, pick
from app.services.categories import ISSUE_CATEGORIES


def test_same_seed_returns_same_prompt():
    a = pick("exam_stress", "convo-123")
    b = pick("exam_stress", "convo-123")
    assert a == b


def test_unknown_category_falls_back_to_general():
    assert pick("not_a_real_category", "convo-1") in PROMPTS["general"]
    assert pick(None, "convo-1") in PROMPTS["general"]


def test_every_prompt_list_has_at_least_five_non_empty_single_sentences():
    for category, prompts in PROMPTS.items():
        assert len(prompts) >= 5, category
        for prompt in prompts:
            assert isinstance(prompt, str)
            stripped = prompt.strip()
            assert stripped, category
            # One sentence: no more than one terminal punctuation mark.
            assert sum(stripped.count(p) for p in ".!?") == 1, (category, prompt)


def test_every_category_slug_is_a_known_issue_category():
    for slug in PROMPTS:
        if slug == "general":
            continue
        assert slug in ISSUE_CATEGORIES, slug


def test_pick_varies_across_seeds():
    """Not a strict requirement, but a single deterministic index for every seed
    would be a sign the hash isn't being used — sample a spread of seeds and
    confirm more than one prompt shows up."""
    seen = {pick("exam_stress", f"convo-{i}") for i in range(20)}
    assert len(seen) > 1


def test_every_issue_category_has_its_own_prompts():
    """The New chat sheet's topic chips map onto these slugs; each one gets
    prompts written for it rather than falling back to general."""
    for slug in ISSUE_CATEGORIES:
        assert slug in PROMPTS, slug
