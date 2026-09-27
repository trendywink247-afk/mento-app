"""foreign keys with explicit delete rules (T2.1)

Every bare String(36) id that points at one table becomes a real foreign key, with the
delete rule the privacy promise needs:

- conversations.user_id / .listener_id → RESTRICT. A conversation row is the only handle
  on its Stream channel; erasure ends and wipes it first, then deletes it. A cascade
  would silently orphan message bodies on Stream.
- rows with nothing outside the database → CASCADE (requests, journals, contributions,
  applications, reflections).
- records that must outlive their parent → SET NULL (requests/links → conversation,
  applications → the mentor profile they became).

Two owner columns are polymorphic (push_tokens.owner_kind/owner_id,
moderation_events.reporter_kind/reporter_id), so a plain FK cannot express them. On
Postgres they get the same guarantees from triggers:
- a DEFERRABLE INITIALLY DEFERRED constraint trigger rejects an owner that does not
  exist for its kind (SQLSTATE 23503, so drivers raise IntegrityError), taking the
  parent row FOR KEY SHARE exactly like a real FK;
- AFTER DELETE triggers on users / listener_profiles delete that owner's push tokens
  and NULL the reporter on their reports.

safety_flags.user_id is the crisis-scan SENDER (a member OR a mentor), and a flag insert
must never be rejected: scan_and_flag reads IntegrityError as a lost dedupe race, so an
FK there would silently drop a mentor's crisis flag. It gets no FK and no check — only
the SET NULL half, from the same parent-delete triggers.

Deliberately NOT keyed: safety_flags.conversation_id and moderation_events.
conversation_id/subject_id (they outlive the conversation and the reported member —
erasure's documented behaviour), and push_tokens.user_id (legacy; holds listener ids on
listener rows).

Existing orphans are cleaned first, per rule: CASCADE children are deleted, SET NULL
columns are nulled. Orphan CONVERSATIONS are never deleted here — their Stream channels
may still hold message bodies — the migration aborts with a count instead; deploy.sh
only swaps containers when the migration succeeds, so production keeps serving.

Revision ID: d2a1fk000001
Revises: bed9ccc9474a
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "d2a1fk000001"
down_revision: str | None = "bed9ccc9474a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, column, referred table, ondelete). Names follow Postgres' own default
# (<table>_<column>_fkey) so they match what autogenerate would see on reflection.
FKS: list[tuple[str, str, str, str]] = [
    ("conversations", "user_id", "users", "RESTRICT"),
    ("conversations", "listener_id", "listener_profiles", "RESTRICT"),
    ("conversation_requests", "requester_id", "users", "CASCADE"),
    ("conversation_requests", "target_listener_id", "listener_profiles", "CASCADE"),
    ("conversation_requests", "conversation_id", "conversations", "SET NULL"),
    ("journal_entries", "user_id", "users", "CASCADE"),
    ("contributions", "user_id", "users", "CASCADE"),
    ("listener_applications", "user_id", "users", "CASCADE"),
    ("listener_applications", "listener_id", "listener_profiles", "SET NULL"),
    ("conversation_reflections", "conversation_id", "conversations", "CASCADE"),
    ("mentor_links", "conversation_id", "conversations", "SET NULL"),
]


def _orphans(table: str, column: str, parent: str) -> str:
    return (
        f"{table}.{column} IS NOT NULL AND NOT EXISTS "
        f"(SELECT 1 FROM {parent} p WHERE p.id = {table}.{column})"
    )


def _clean_orphans() -> None:
    bind = op.get_bind()
    for col in ("user_id", "listener_id"):
        parent = "users" if col == "user_id" else "listener_profiles"
        count = bind.execute(
            text(
                f"SELECT count(*) FROM conversations WHERE {_orphans('conversations', col, parent)}"
            )
        ).scalar_one()
        if count:
            raise RuntimeError(
                f"T2.1: {count} conversation(s) point at a missing {parent} row. Their "
                "Stream channels may still hold message bodies, so this migration will not "
                "delete them. Wipe each channel on Stream, delete the rows, then re-run."
            )
    # Conversations first are clean; now their children, then everything else.
    for table, column, parent, rule in FKS:
        if table == "conversations":
            continue
        if rule == "SET NULL":
            op.execute(
                f"UPDATE {table} SET {column} = NULL WHERE {_orphans(table, column, parent)}"
            )
        else:
            op.execute(f"DELETE FROM {table} WHERE {_orphans(table, column, parent)}")
    # Polymorphic owners: same rules, by kind.
    op.execute(
        "DELETE FROM push_tokens t WHERE "
        "(t.owner_kind = 'member' AND NOT EXISTS (SELECT 1 FROM users p WHERE p.id = t.owner_id)) "
        "OR (t.owner_kind = 'listener' AND NOT EXISTS "
        "(SELECT 1 FROM listener_profiles p WHERE p.id = t.owner_id))"
    )
    op.execute(
        "UPDATE moderation_events m SET reporter_id = NULL WHERE m.reporter_id IS NOT NULL AND ("
        "(m.reporter_kind = 'member' AND NOT EXISTS "
        "(SELECT 1 FROM users p WHERE p.id = m.reporter_id)) "
        "OR (m.reporter_kind = 'listener' AND NOT EXISTS "
        "(SELECT 1 FROM listener_profiles p WHERE p.id = m.reporter_id)))"
    )


# --- Postgres triggers for the polymorphic owners ----------------------------------------

_OWNER_CHECK = """
CREATE FUNCTION mento_check_{name}() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.{id_col} IS NULL THEN
        RETURN NULL;
    END IF;
    -- Deferred: the row may have been changed or deleted since. Check what is there now.
    PERFORM 1 FROM {table} WHERE id = NEW.id
        AND {id_col} = NEW.{id_col} AND {kind_col} = NEW.{kind_col};
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF NEW.{kind_col} = 'member' THEN
        PERFORM 1 FROM users WHERE id = NEW.{id_col} FOR KEY SHARE;
    ELSE
        PERFORM 1 FROM listener_profiles WHERE id = NEW.{id_col} FOR KEY SHARE;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION '{table}.{id_col} has no % row', NEW.{kind_col}
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER mento_{name}
    AFTER INSERT OR UPDATE OF {id_col}, {kind_col} ON {table}
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION mento_check_{name}();
"""

_PARENT_GONE = """
CREATE FUNCTION mento_{kind}_gone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM push_tokens WHERE owner_kind = '{kind}' AND owner_id = OLD.id;
    UPDATE moderation_events SET reporter_id = NULL
        WHERE reporter_kind = '{kind}' AND reporter_id = OLD.id;
    UPDATE safety_flags SET user_id = NULL WHERE user_id = OLD.id;
    RETURN NULL;
END $$;
CREATE TRIGGER mento_{kind}_gone AFTER DELETE ON {parent}
    FOR EACH ROW EXECUTE FUNCTION mento_{kind}_gone();
"""

_TRIGGERS = [
    _OWNER_CHECK.format(
        name="push_token_owner", table="push_tokens", id_col="owner_id", kind_col="owner_kind"
    ),
    _OWNER_CHECK.format(
        name="moderation_reporter",
        table="moderation_events",
        id_col="reporter_id",
        kind_col="reporter_kind",
    ),
    _PARENT_GONE.format(kind="member", parent="users"),
    _PARENT_GONE.format(kind="listener", parent="listener_profiles"),
]

_DROP_TRIGGERS = [
    "DROP TRIGGER IF EXISTS mento_listener_gone ON listener_profiles",
    "DROP FUNCTION IF EXISTS mento_listener_gone()",
    "DROP TRIGGER IF EXISTS mento_member_gone ON users",
    "DROP FUNCTION IF EXISTS mento_member_gone()",
    "DROP TRIGGER IF EXISTS mento_moderation_reporter ON moderation_events",
    "DROP FUNCTION IF EXISTS mento_check_moderation_reporter()",
    "DROP TRIGGER IF EXISTS mento_push_token_owner ON push_tokens",
    "DROP FUNCTION IF EXISTS mento_check_push_token_owner()",
]


def upgrade() -> None:
    _clean_orphans()
    for table, column, parent, rule in FKS:
        op.create_foreign_key(
            f"{table}_{column}_fkey", table, parent, [column], ["id"], ondelete=rule
        )
    if op.get_bind().dialect.name == "postgresql":
        for ddl in _TRIGGERS:
            op.execute(ddl)


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for ddl in _DROP_TRIGGERS:
            op.execute(ddl)
    for table, column, _parent, _rule in reversed(FKS):
        op.drop_constraint(f"{table}_{column}_fkey", table, type_="foreignkey")
