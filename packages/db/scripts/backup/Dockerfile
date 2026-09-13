FROM postgres:16-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-venv gnupg postgresql-16-postgis-3 postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/backup-venv
COPY packages/db/scripts/backup/requirements.txt /opt/backup/requirements.txt
RUN /opt/backup-venv/bin/pip install --no-cache-dir -r /opt/backup/requirements.txt
ENV PATH="/opt/backup-venv/bin:${PATH}"
COPY packages/db/scripts/backup/ /opt/backup/
