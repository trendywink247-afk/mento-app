FROM python:3.12-slim
RUN useradd --uid 10001 --create-home receiver && mkdir /data && chown receiver:receiver /data && chmod 700 /data
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY __init__.py __main__.py receiver.py store.py /app/recovery_receiver/
USER receiver
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 18090
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import socket; from pathlib import Path; from recovery_receiver.store import Store; Store(Path('/data/receipts.sqlite3')); socket.create_connection(('127.0.0.1',18090),timeout=3).close()"
ENTRYPOINT ["python", "-m", "recovery_receiver"]
CMD ["serve", "--database", "/data/receipts.sqlite3", "--host", "0.0.0.0"]
