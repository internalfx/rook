FROM oven/bun:1.4.4-slim

WORKDIR /app

# Where Puppeteer keeps its browser: outside any home folder, so the user the app runs as finds it
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer

COPY package.json bun.lock ./

# The web tools' headless Chrome is the one this Puppeteer is built for, installed apart from the
# package as for any install (see the README). --install-deps adds the system libraries that
# Chrome lists, with apt-get, which is why this runs as root.
RUN PUPPETEER_SKIP_DOWNLOAD=true bun install --frozen-lockfile --production \
  && apt-get update \
  && bun x --bun puppeteer browsers install chrome-headless-shell --install-deps \
  && rm -rf /var/lib/apt/lists/*

COPY . .

# The server builds dist/ at startup, so the app folder belongs to the user it runs as. /data is
# where Coolify mounts the persistent storage: the database and the images.
RUN rm -rf /app/data && mkdir -p /data && chown -R bun:bun /app /data

# Behind a TLS proxy (Traefik on Coolify), which is the only way in, so the login cookie is
# HTTPS-only and X-Forwarded-For is believed. A new install's setup pages are closed, so whoever
# finds the address first can't make the admin's account: scripts/users.js makes it from the
# container's terminal. Docker's seccomp profile leaves Chrome no sandbox, so it runs without one.
ENV ROOK_ENV=production \
  ROOK_HOST=0.0.0.0 \
  ROOK_PORT=8005 \
  ROOK_DATA_DIR=/data \
  ROOK_TRUST_PROXY=true \
  ROOK_WEB_SETUP=false \
  ROOK_BROWSER_SANDBOX=false
EXPOSE 8005
USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD bun -e "fetch('http://127.0.0.1:8005/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["bun", "run", "app.js"]
