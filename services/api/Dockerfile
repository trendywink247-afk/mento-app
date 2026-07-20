# Mento API — production image.
# Build (from repo root):  docker build -t mento-api services/api
# Run:                     docker run --env-file .env -p 8000:8000 mento-api
FROM python:3.12-slim

# curl is needed only for the HEALTHCHECK below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user.
RUN useradd --create-home --uid 1000 mento

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R mento:mento /app

USER mento

# Conservative per-container DB pool defaults. Sizing rule (see .env.example):
# UVICORN_WORKERS x (DB_POOL_SIZE + DB_MAX_OVERFLOW) must stay under Postgres
# max_connections (DO managed default ~97, minus reserved/superuser slots).
ENV UVICORN_WORKERS=2 \
    DB_POOL_SIZE=5 \
    DB_MAX_OVERFLOW=5 \
    PORT=8000 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# /api/v1/health is plain liveness. (/api/v1/health/crisis is the ACTIVE
# alerting hook — point an external uptime monitor at it; see docs/DEPLOYMENT.md.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
