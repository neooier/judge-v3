# Requires BuildKit (Docker 23+ for named local contexts).
ARG SANDBOX_SOURCE=remote

FROM ubuntu:20.04@sha256:8feb4d8ca5354def3d8fce243717141ce31e2c428701f6682bd2fafe15388214 AS noilinux-rootfs
ARG GCC_VERSION=9.3.0-10ubuntu2
ARG FPC_VERSION=3.0.4+dfsg-23
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates bash coreutils diffutils make binutils libc6-dev \
      gcc-9-base=${GCC_VERSION} cpp-9=${GCC_VERSION} gcc-9=${GCC_VERSION} \
      g++-9=${GCC_VERSION} libgcc-9-dev=${GCC_VERSION} libstdc++-9-dev=${GCC_VERSION} \
      libasan5=${GCC_VERSION} \
      fp-compiler-3.0.4=${FPC_VERSION} fp-units-rtl-3.0.4=${FPC_VERSION} \
      fp-units-base-3.0.4=${FPC_VERSION} fp-units-fcl-3.0.4=${FPC_VERSION} \
      python2 python3 && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf gcc-9 /usr/bin/gcc && ln -sf gcc-9 /usr/bin/cc && \
    ln -sf g++-9 /usr/bin/g++ && ln -sf g++-9 /usr/bin/c++ && \
    mkdir -p /sandbox/1 /sandbox/2 /tmp /proc /dev && chmod 1777 /tmp && \
    test "$(gcc-9 -dumpfullversion)" = 9.3.0 && \
    test "$(g++-9 -dumpfullversion)" = 9.3.0 && test "$(fpc -iV)" = 3.0.4
COPY docker/rootfs/ /usr/bin/
COPY docker/noi-linux2-toolchain.json /etc/noi-linux2-toolchain.json
RUN sed -i 's/\r$//' /usr/bin/compile-* && chmod 755 /usr/bin/compile-*

FROM node:10.24.1-buster@sha256:05e259ab6478ae6032163ce34683bfccb495c8219f2f01a8d30889bb3ce33084 AS runtime-base
RUN printf '%s\n' 'deb http://archive.debian.org/debian/ buster main' \
      'deb http://archive.debian.org/debian-security/ buster/updates main' > /etc/apt/sources.list && \
    printf '%s\n' 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99no-check-valid-until && \
    apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential libfmt-dev git ca-certificates util-linux && \
    rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3 NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    npm_config_nodedir=/usr/local

FROM runtime-base AS sandbox-remote

FROM runtime-base AS sandbox-local
# Local builds use a named context; the Git pin and frozen lock stay unchanged.
COPY --from=sandbox-source / /sandbox-repo/
ENV GIT_CONFIG_PARAMETERS="'url.file:///sandbox-repo.insteadOf=https://github.com/neooier/simple-sandbox.git'" \
    GIT_ALLOW_PROTOCOL=file:https

FROM sandbox-${SANDBOX_SOURCE} AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive
COPY . .
RUN yarn build && node -e "require('simple-sandbox')"

FROM runtime-base AS judge-no-rootfs
WORKDIR /app
COPY --from=builder /app/ /app/
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY docker/verify-noi-toolchain.sh /usr/local/bin/verify-noi-toolchain
RUN sed -i 's/\r$//' /docker-entrypoint.sh /usr/local/bin/verify-noi-toolchain && \
    chmod 755 /docker-entrypoint.sh /usr/local/bin/verify-noi-toolchain
ENV NODE_ENV=production \
    SYZOJ_JUDGE_RUNNER_INSTANCE=runner \
    SYZOJ_JUDGE_SANDBOX_ROOTFS_PATH=/rootfs \
    SYZOJ_JUDGE_WORKING_DIRECTORY=/tmp/working \
    SYZOJ_JUDGE_BINARY_DIRECTORY=/tmp/binary \
    SYZOJ_JUDGE_TESTDATA_PATH=/app/testdata \
    SYZOJ_JUDGE_DO_NOT_USE_X32_ABI=true \
    SYZOJ_JUDGE_LANGUAGE_PROFILE=noi-linux2 \
    SYZOJ_JUDGE_CGROUP_ROOT=/sys/fs/cgroup
VOLUME ["/app/config", "/app/testdata"]
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["daemon"]

FROM judge-no-rootfs AS judge
COPY --from=noilinux-rootfs / /rootfs/
LABEL org.neooier.judge.toolchain="NOI Linux 2.0" org.neooier.judge.gcc="9.3.0"
RUN verify-noi-toolchain /rootfs
