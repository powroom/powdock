# syntax=docker/dockerfile:1

# ---- build: client and fully bundled server ---------------------------------------------------
# The server build bundles every dependency (vite.config.ts: ssr.noExternal), so the runtime
# image needs no node_modules at all.
# This stage runs on the build machine's CPU ($BUILDPLATFORM), even for an arm64 image. Its output
# is plain JavaScript and static files, the same for every CPU, so nothing native is copied over.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build \
  # server.ts imports app code (#/lib/...): bundle it too, so the image needs no src/ or package.json
  && bun build server.ts --target bun --minify --outfile start.js \
  # the data directory, created here because the runtime image has no shell
  && mkdir -p /out/data

# ---- runtime: Bun on distroless (no shell, no package manager) ---------------------------------
FROM oven/bun:1.4.4-distroless AS runtime
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/powroom/powdock" \
      org.opencontainers.image.title="pow/dock" \
      org.opencontainers.image.description="A lightweight web UI for the Docker Engine on your machine." \
      org.opencontainers.image.url="https://github.com/powroom/powdock" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3434 \
    POWDOCK_DATA_DIR=/data \
    POWDOCK_INSTALL=docker

COPY --from=build --chown=1000:1000 /out/data /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/start.js ./
COPY LICENSE NOTICE ./

# uid 1000 matches the bun user, so a /data folder owned by uid 1000 (for example a bind mount) works
USER 1000:1000
VOLUME ["/data"]

EXPOSE 3434
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3434) + '/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT []
CMD ["bun", "start.js"]
