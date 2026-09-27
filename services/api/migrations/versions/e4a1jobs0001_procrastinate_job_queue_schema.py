"""job queue: install the Procrastinate 3.10.0 schema (WS4 T4.1)

Additive, safe under a running app: new tables, types and functions, all named
`procrastinate_*`; nothing existing is touched.

The SQL is VENDORED (migrations/sql/procrastinate_3.10.0_schema.sql, copied verbatim
from the pinned package) rather than read from the installed library at run time —
a shipped migration must produce the same schema forever, whatever version of
Procrastinate a later image carries. Upgrading Procrastinate = a NEW revision that
applies that release's own files from `procrastinate/sql/migrations/`.

`alembic check` ignores `procrastinate_*` objects (migrations/env.py): they are the
library's, not our models'.

Revision ID: e4a1jobs0001
Revises: c13a0seen001
Create Date: 2026-09-27 19:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4a1jobs0001"
down_revision: str | None = "c13a0seen001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = Path(__file__).resolve().parents[1] / "sql" / "procrastinate_3.10.0_schema.sql"


def upgrade() -> None:
    # The raw driver connection, same transaction: the file is plpgsql with literal
    # `%` and `:` in it, which SQLAlchemy's text() and paramstyle handling would
    # otherwise try to interpret. No parameters → psycopg sends it as-is.
    op.get_bind().connection.driver_connection.execute(SCHEMA.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS procrastinate_events CASCADE")
    op.execute("DROP TABLE IF EXISTS procrastinate_periodic_defers CASCADE")
    op.execute("DROP TABLE IF EXISTS procrastinate_jobs CASCADE")
    op.execute("DROP TABLE IF EXISTS procrastinate_workers CASCADE")
    op.execute(
        """
        DO $$
        DECLARE f record;
        BEGIN
            FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
                     JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = current_schema() AND p.proname LIKE 'procrastinate\\_%'
            LOOP
                EXECUTE 'DROP FUNCTION IF EXISTS ' || f.sig || ' CASCADE';
            END LOOP;
        END $$;
        """
    )
    op.execute("DROP TYPE IF EXISTS procrastinate_job_to_defer_v1")
    op.execute("DROP TYPE IF EXISTS procrastinate_job_event_type")
    op.execute("DROP TYPE IF EXISTS procrastinate_job_status")
