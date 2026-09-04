"""Path/community service: config validation + the current seasonal card."""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.services.paths_data import COMMUNITIES, TREE, TREE_ROOT


def is_valid(community: str, stage: str) -> bool:
    c = COMMUNITIES.get(community)
    return bool(c and stage in c["stages"])


def community_info(slug: str) -> dict:
    c = COMMUNITIES[slug]
    return {"slug": slug, "name": c["name"], "tagline": c["tagline"]}


def stage_info(community: str, stage: str) -> dict:
    s = COMMUNITIES[community]["stages"][stage]
    return {"id": stage, "title": s["title"], "blurb": s["blurb"]}


def prompts_for(community: str, stage: str) -> list[str]:
    return list(COMMUNITIES[community]["stages"][stage]["prompts"])


def _md(day: date) -> str:
    return day.strftime("%m-%d")


def seasonal_card(community: str, today: date | None = None) -> dict | None:
    """The emotional-calendar card active right now, if any. Month-day ranges are
    year-agnostic; ranges never wrap the new year in v1 config."""
    today_md = _md(today or datetime.now(UTC).date())
    for card in COMMUNITIES[community].get("seasonal", []):
        if card["from"] <= today_md <= card["to"]:
            return {"title": card["title"], "body": card["body"]}
    return None


def tree_payload() -> dict:
    return {"root": TREE_ROOT, "nodes": TREE}
