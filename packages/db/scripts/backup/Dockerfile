# Rebuild the privilege drop helper without its older Go standard library.
FROM golang:1.27.3-bookworm@sha256:dc0963f32053e4bc451d24d87e3892d42d01021b61f093e98eb95c0352bb84b0 AS gosu-build
ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOBIN=/out
RUN go install -trimpath -ldflags="-d -w" github.com/tianon/gosu@29b939aa5bd4dc588af765b8248f6e39150d2565 \
    && go version -m /out/gosu

FROM postgis/postgis:16-3.6-alpine@sha256:d5955943c6e633219d80bd1d7fd986a097fdd44f3979c53d4839d62647bba478 AS build
# Compile pgvector for this PostgreSQL/Alpine ABI. Keep toolchains out of the runtime.
RUN apk upgrade --no-cache && apk add --no-cache build-base curl python3 py3-pip
RUN curl --fail --silent --show-error --location --retry 2 --max-time 90 \
    https://codeload.github.com/pgvector/pgvector/tar.gz/8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c \
    --output /tmp/pgvector.tar.gz \
    && echo 'd076a3098010905fd60256649327809651f6288327db6413f0938305f62ea299  /tmp/pgvector.tar.gz' | sha256sum -c - \
    && mkdir /tmp/pgvector && tar -xzf /tmp/pgvector.tar.gz -C /tmp/pgvector --strip-components=1 \
    && cd /tmp/pgvector && make -j2 OPTFLAGS= with_llvm=no \
    && make install DESTDIR=/out with_llvm=no
COPY packages/db/scripts/backup/requirements.txt /tmp/requirements.txt
RUN python3 -m venv --without-pip /opt/backup-venv \
    && python3 -m pip --python /opt/backup-venv install --disable-pip-version-check \
    --no-cache-dir --only-binary=:all: --require-hashes -r /tmp/requirements.txt

FROM postgis/postgis:16-3.6-alpine@sha256:d5955943c6e633219d80bd1d7fd986a097fdd44f3979c53d4839d62647bba478
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates python3 gnupg
COPY --from=build /out/ /
COPY --from=build /opt/backup-venv /opt/backup-venv
COPY --from=gosu-build /out/gosu /usr/local/bin/gosu
COPY packages/db/scripts/backup/ /opt/backup/
ENV PATH="/opt/backup-venv/bin:${PATH}"
RUN python3 -c 'import boto3; assert boto3.__version__ == "1.43.93"' \
    && gpg --version && gosu --version
