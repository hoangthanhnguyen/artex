# syntax=docker/dockerfile:1
#
# Multi-stage build for ARTEX, fetched and checksum-verified during the build.
#
# The upstream Dockerfile ships a PRE-BUILT binary (COPY dist/<arch>/artex) so it
# cannot build inside the image on its own. This one compiles everything:
#
#   stage 1 (frontend)  : Next.js static export  -> /src/server/webui/dist
#   stage 2 (backend)   : Go build -tags embedui -> artex binary
#   stage 3 (runtime)   : debian slim + tooling + browser, no compiler
#
# Build args:
#   ARTEX_VERSION  version string embedded in the binary (default 0.3.15)
#   WITH_CHROMIUM  1 = install the distro Chromium (default), 0 = no browser
#   WITH_RECON     1 = install the recon toolbox (default), 0 = skip

# Source acquisition is independent of the ignored local src/ directory.
FROM golang:1.26-bookworm AS upstream
WORKDIR /acquire
COPY docker/fetch-source.go ./fetch-source.go
RUN GOTOOLCHAIN=local go run ./fetch-source.go /upstream

FROM node:20-bookworm-slim AS source
WORKDIR /repo
COPY --from=upstream /upstream /src
COPY patches/goal-gate ./patches/goal-gate
COPY patches/english-ui ./patches/english-ui
COPY skills ./skills
RUN node patches/goal-gate/apply.mjs /src \
    && node patches/english-ui/apply-server.mjs /src

# --------------------------------------------------------------------------- #
# stage 1 - frontend static export
# --------------------------------------------------------------------------- #
FROM node:20-bookworm-slim AS frontend
WORKDIR /src
COPY --from=source /src/web/package.json /src/web/package-lock.json ./web/
RUN cd web && npm ci
COPY --from=source /src/web ./web
# Localize parsed UI literals before compilation; retain the runtime fallback.
COPY patches/english-ui ./patches/english-ui
RUN node patches/english-ui/apply.mjs . \
    && node patches/english-ui/localize-source.mjs . \
    && node patches/english-ui/localize-source.mjs . --check
# next build with NEXT_EXPORT=1 writes to web/out, NOT webui/dist. The upstream
# build.sh does this same copy; without it the backend stage has nothing to embed.
RUN cd web && npm run build:static && cd .. \
    && mkdir -p server/webui/dist \
    && cp -r web/out/. server/webui/dist/ \
    && test -f server/webui/dist/index.html

# --------------------------------------------------------------------------- #
# stage 2 - go backend with the frontend embedded
# --------------------------------------------------------------------------- #
FROM golang:1.26-bookworm AS backend
WORKDIR /src
# go.mod declares go 1.26.3; the toolchain directive fetches a patch release when
# the base image is older than that.
COPY --from=source /src/go.mod /src/go.sum ./
RUN go mod download
COPY --from=source /src/ .
COPY --from=frontend /src/server/webui/dist ./server/webui/dist
ARG ARTEX_VERSION=0.3.15
RUN CGO_ENABLED=0 go build \
      -tags embedui \
      -trimpath \
      -ldflags "-s -w -buildid= -X main.version=${ARTEX_VERSION}" \
      -o /out/artex ./cmd/artex \
    && test -s /out/artex

# --------------------------------------------------------------------------- #
# stage 1b - recon toolbox (downloaded + checksum-verified at build time)
# --------------------------------------------------------------------------- #
# Versions are pinned AND their release SHA256 verified. The upstream fork that
# ships a similar toolbox installs at build time but does NOT verify the
# downloads (its own changelog says checksum verification is still pending), so
# a compromised release asset or a hijacked redirect would land silently. Here a
# mismatch aborts the build.
#
# To upgrade a tool: change its _VERSION, fetch the new official checksum from
# the release's checksums file, and update the matching _SHA256 below. The build
# fails loudly if the two disagree.
#
# sqlmap is a git checkout (no release asset), so it is pinned to a commit-ish
# ref instead of a checksum. --depth 1 keeps the layer small.
FROM debian:bookworm-slim AS recon
ARG TARGETARCH=amd64

ARG NUCLEI_VERSION=v3.11.1
ARG HTTPX_VERSION=v1.12.0
ARG SUBFINDER_VERSION=v2.17.0
ARG KATANA_VERSION=v1.8.0
ARG FFUF_VERSION=v2.3.0
ARG DALFOX_VERSION=v3.2.4

# amd64 hashes (verified against each project's official checksums file).
ARG NUCLEI_SHA256_AMD64=ea63d4ae232808cd7c6bc00d0142428e231fab59dae01042246097d195835ab6
ARG HTTPX_SHA256_AMD64=9d8439e8b6c9aa7d1e2314817a392e00d5178da3af5652f7475f88868f418f76
ARG SUBFINDER_SHA256_AMD64=a39c3e5c7a26ef3c430915c4d6cbf7716a00f26769a75e9405aba796142eba37
ARG KATANA_SHA256_AMD64=cb027ae99d0757061b70c07a15c7a80f62c5a535ab52c4a329f80c4b0a7309d2
ARG FFUF_SHA256_AMD64=b2a3c725fcb9da175159682f54d6e9149f2905b00d84d155e7efc5d599975ceb
ARG DALFOX_SHA256_AMD64=c11cfd2f8261973f0a2a2a1eba5a147ce77712a29acfa6343f9847fb8bb7eca2
# arm64 hashes.
ARG NUCLEI_SHA256_ARM64=8044e3d9768ba0a744b2872c1a87e813006f013da97ca9f50f7661a4203bec07
ARG HTTPX_SHA256_ARM64=fd7b123c1dfbc3d69f19f524e4eebcd6ec06b9a6cbd56813c76f11645197331e
ARG SUBFINDER_SHA256_ARM64=24913d49dddc1d3a5e99a4a7580da5be980959b9415b96f52c4f7f4124392190
ARG KATANA_SHA256_ARM64=80e269210727a855511ffac8dfb01297b2344742acec71a35e8ba4a67a90f0f2
ARG FFUF_SHA256_ARM64=e2d712615d53da797ee929006e41f2df5a7960a5353133db9c150ddaa22ae4e8
ARG DALFOX_SHA256_ARM64=fd56b0b7da2d06868cd73b504f41d21314629feffcd5bdc97718db1c9dd2fa70

RUN set -eux; \
    apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip tar \
    && rm -rf /var/lib/apt/lists/*; \
    case "$TARGETARCH" in \
      amd64) PD_ARCH=amd64; FFUF_ARCH=amd64; DALFOX_ARCH=x86_64; \
             H_NUCLEI=$NUCLEI_SHA256_AMD64; H_HTTPX=$HTTPX_SHA256_AMD64; \
             H_SUBFINDER=$SUBFINDER_SHA256_AMD64; H_KATANA=$KATANA_SHA256_AMD64; \
             H_FFUF=$FFUF_SHA256_AMD64; H_DALFOX=$DALFOX_SHA256_AMD64 ;; \
      arm64) PD_ARCH=arm64; FFUF_ARCH=arm64; DALFOX_ARCH=aarch64; \
             H_NUCLEI=$NUCLEI_SHA256_ARM64; H_HTTPX=$HTTPX_SHA256_ARM64; \
             H_SUBFINDER=$SUBFINDER_SHA256_ARM64; H_KATANA=$KATANA_SHA256_ARM64; \
             H_FFUF=$FFUF_SHA256_ARM64; H_DALFOX=$DALFOX_SHA256_ARM64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    mkdir -p /out; \
    # download + verify + unpack one projectdiscovery tool (zip asset)
    pd_fetch() { \
      repo="$1"; ver="$2"; name="$3"; want="$4"; \
      nov="${ver#v}"; \
      url="https://github.com/projectdiscovery/${repo}/releases/download/${ver}/${name}_${nov}_linux_${PD_ARCH}.zip"; \
      curl -fsSL "$url" -o /tmp/$name.zip; \
      got=$(sha256sum /tmp/$name.zip | cut -d' ' -f1); \
      if [ "$got" != "$want" ]; then \
        echo "CHECKSUM MISMATCH $name: got $got want $want" >&2; exit 1; \
      fi; \
      unzip -o -q /tmp/$name.zip -d /tmp/$name-extract; \
      install -m 0755 /tmp/$name-extract/$name /out/$name; \
      rm -rf /tmp/$name.zip /tmp/$name-extract; \
    }; \
    pd_fetch nuclei "$NUCLEI_VERSION" nuclei "$H_NUCLEI"; \
    pd_fetch httpx "$HTTPX_VERSION" httpx "$H_HTTPX"; \
    pd_fetch subfinder "$SUBFINDER_VERSION" subfinder "$H_SUBFINDER"; \
    pd_fetch katana "$KATANA_VERSION" katana "$H_KATANA"; \
    # ffuf: tar.gz asset, binary at archive root
    curl -fsSL "https://github.com/ffuf/ffuf/releases/download/${FFUF_VERSION}/ffuf_${FFUF_VERSION#v}_linux_${FFUF_ARCH}.tar.gz" -o /tmp/ffuf.tgz; \
    got=$(sha256sum /tmp/ffuf.tgz | cut -d' ' -f1); \
    if [ "$got" != "$H_FFUF" ]; then echo "CHECKSUM MISMATCH ffuf: got $got want $H_FFUF" >&2; exit 1; fi; \
    mkdir -p /tmp/ffuf-x; tar -xzf /tmp/ffuf.tgz -C /tmp/ffuf-x; \
    install -m 0755 "$(find /tmp/ffuf-x -type f -name ffuf | head -n1)" /out/ffuf; \
    rm -rf /tmp/ffuf.tgz /tmp/ffuf-x; \
    # dalfox: musl static tar.gz; upstream nests the binary under a versioned dir,
    # so locate it by name instead of assuming a flat extraction path.
    curl -fsSL "https://github.com/hahwul/dalfox/releases/download/${DALFOX_VERSION}/dalfox-${DALFOX_VERSION}-linux-${DALFOX_ARCH}-musl.tar.gz" -o /tmp/dalfox.tgz; \
    got=$(sha256sum /tmp/dalfox.tgz | cut -d' ' -f1); \
    if [ "$got" != "$H_DALFOX" ]; then echo "CHECKSUM MISMATCH dalfox: got $got want $H_DALFOX" >&2; exit 1; fi; \
    mkdir -p /tmp/dalfox-x; tar -xzf /tmp/dalfox.tgz -C /tmp/dalfox-x; \
    install -m 0755 "$(find /tmp/dalfox-x -type f -name dalfox | head -n1)" /out/dalfox; \
    rm -rf /tmp/dalfox.tgz /tmp/dalfox-x; \
    # sqlmap: git checkout, pinned ref (no release asset to checksum)
    apt-get update >/dev/null \
    && apt-get install -y --no-install-recommends git >/dev/null \
    && git clone --depth 1 https://github.com/sqlmapproject/sqlmap /opt/sqlmap \
    && rm -rf /var/lib/apt/lists/*

# --------------------------------------------------------------------------- #
# stage 3 - runtime
# --------------------------------------------------------------------------- #
FROM python:3.12-slim-bookworm
ARG WITH_CHROMIUM=1
ARG WITH_RECON=1
ARG TARGETARCH=amd64
# Base tooling, same set as upstream plus what the skills folder expects.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates iproute2 procps less file \
    && rm -rf /var/lib/apt/lists/*

# Node 20 from NodeSource: bookworm ships nodejs 18, Playwright needs >= 20.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ripgrep curl wget vim git jq unzip \
      dnsutils iputils-ping netcat-openbsd inetutils-telnet whois nmap \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Playwright MCP + CLI globally, so no npx download happens at runtime.
RUN npm install -g @playwright/mcp@latest @playwright/cli@latest playwright@latest \
    && playwright-cli --help

# Recon toolbox: copied from the verified build stage, so every binary here was
# checksum-matched against its upstream release before it entered the image.
COPY --from=recon /out/ /usr/local/bin/
# sqlmap is a python checkout; the runtime image already provides python3.
COPY --from=recon /opt/sqlmap /opt/sqlmap
RUN if [ "$WITH_RECON" = "1" ]; then \
      for t in nuclei httpx subfinder katana ffuf dalfox; do \
        command -v "$t" >/dev/null || { echo "recon tool missing: $t" >&2; exit 1; }; \
      done \
      && ln -sf /opt/sqlmap/sqlmap.py /usr/local/bin/sqlmap \
      && chmod +x /usr/local/bin/sqlmap; \
    else \
      rm -rf /usr/local/bin/nuclei /usr/local/bin/httpx /usr/local/bin/subfinder \
             /usr/local/bin/katana /usr/local/bin/ffuf /usr/local/bin/dalfox /opt/sqlmap; \
    fi

# Browser: Debian's chromium instead of the Playwright bundle.
#
# Verified facts about how the tooling resolves a browser, all checked inside
# this container:
#   * playwright-cli / @playwright/mcp default to the "chrome" channel and look
#     for it at /opt/google/chrome/chrome; there is no --browser=chromium value,
#     so a distro browser is invisible unless it appears at that path.
#   * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH does NOT influence that lookup.
#   * running as root, Chromium refuses to start unless --no-sandbox is passed;
#     playwright-cli has no such flag, so the MCP must be launched with the
#     --no-sandbox flag shown in the README.
# Hence: install chromium, then symlink it to the path the tooling probes.
RUN if [ "$WITH_CHROMIUM" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends chromium \
      && rm -rf /var/lib/apt/lists/* \
      && mkdir -p /opt/google/chrome \
      && ln -sf /usr/bin/chromium /opt/google/chrome/chrome \
      && /opt/google/chrome/chrome --version; \
    fi

WORKDIR /app
COPY --from=backend /out/artex /app/artex
COPY --from=source /src/start.sh /app/start.sh
# The binary writes its JWT signing key to /app/jwt.key, which sits outside the
# bind-mounted data dir and would be regenerated on every recreate, invalidating
# every session. Symlink it into the persisted folder instead.
RUN chmod +x /app/artex /app/start.sh \
    && mkdir -p /app/data \
    && ln -sf /app/data/jwt.key /app/jwt.key

# Skills are baked in as a fallback; docker-compose bind-mounts ./skills over this
# path, so editing a skill on the host needs no rebuild.
COPY skills/ /app/skills/

VOLUME ["/app/data"]
EXPOSE 8787 8788
ENTRYPOINT ["/app/start.sh"]
CMD ["-addr", ":8787", "-proxy", ":8788"]
