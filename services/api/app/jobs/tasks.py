"""Every job the worker runs. Tasks are thin: they open their own DB session and call
the service that owns the logic, so the same code still runs inline where a card
keeps an inline fallback."""

from __future__ import annotations
