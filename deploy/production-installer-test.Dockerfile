# Disposable SSH rehearsal image; never used as an application release artifact.
ARG TEST_BASE=debian:bookworm-slim
FROM ${TEST_BASE}
USER root
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends openssh-server sudo python3 \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["bash"]
