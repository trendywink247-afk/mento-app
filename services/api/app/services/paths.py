"""Path/community service: config validation + the current seasonal card."""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.config import get_settings
from app.services.paths_data import COMMUNITIES, TREE, TREE_ROOT


def is_valid(community: str, stage: str) -> bool:
    c = COMMUNITIES.get(community)
    return bool(c and stage in c["stages"])


def is_open(slug: str | None) -> bool:
    """A road people can pick now (DECISIONS §P.1). No road, or an empty launch list, is open."""
    open_roads = {r.strip() for r in get_settings().launch_roads.split(",") if r.strip()}
    return not slug or not open_roads or slug in open_roads


def accept_first(slug: str | None) -> bool:
    """An exam niche (DECISIONS §N.2): the member's request waits for a mentor's accept,
    even when a mentor is online. Life in general, no Path, or an unknown slug keep the
    instant General match."""
    c = COMMUNITIES.get(slug) if slug else None
    return bool(c and c.get("accept_first"))


def community_info(slug: str) -> dict:
    c = COMMUNITIES[slug]
    return {
        "slug": slug,
        "name": c["name"],
        "tagline": c["tagline"],
        "accept_first": bool(c.get("accept_first")),
        "enabled": is_open(slug),
    }


def stage_info(community: str, stage: str) -> dict:
    s = COMMUNITIES[community]["stages"][stage]
    return {"id": stage, "title": s["title"], "blurb": s["blurb"]}


def community_label(slug: str | None) -> str | None:
    """Safe display-name lookup — unlike `community_info` (which assumes the slug
    is already valid), this never raises: a slug persisted on an old row can
    outlive its config entry, and a caller like the mentor brief must still
    render (never 500) when that happens."""
    if not slug:
        return None
    c = COMMUNITIES.get(slug)
    return c["name"] if c else None


def stage_label(community_slug: str | None, stage_slug: str | None) -> str | None:
    """Safe display-title lookup for a (community, stage) pair — see `community_label`."""
    if not community_slug or not stage_slug:
        return None
    c = COMMUNITIES.get(community_slug)
    if not c:
        return None
    s = c.get("stages", {}).get(stage_slug)
    return s["title"] if s else None


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


def _node_open(node_id: str, seen: frozenset[str] = frozenset()) -> bool:
    """A question node is open when any road reachable from it is (DECISIONS §P.1)."""
    node = TREE.get(node_id)
    if node is None or node_id in seen:
        return False
    for o in node["options"]:
        if o.get("community"):
            if is_open(o["community"]):
                return True
        elif o.get("next") and _node_open(o["next"], seen | {node_id}):
            return True
    return False


def tree_payload() -> dict:
    """The tree the app walks. Every option also says whether it is open for this launch;
    a closed one is shown greyed out as "Coming soon" and cannot be chosen."""
    nodes = {
        node_id: {
            **node,
            "options": [
                {
                    **o,
                    "enabled": is_open(o["community"])
                    if o.get("community")
                    else _node_open(o["next"])
                    if o.get("next")
                    else True,
                }
                for o in node["options"]
            ],
        }
        for node_id, node in TREE.items()
    }
    return {"root": TREE_ROOT, "nodes": nodes}
