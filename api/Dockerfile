# Paid one-pager API (api/server.mjs). Build from the repository root:
#   docker build -f api/Dockerfile -t typographics-api .
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium mupdf-tools qpdf fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY cli ./cli
COPY gallery/recipes.js ./gallery/recipes.js
COPY assets/fonts ./assets/fonts
COPY api ./api
ENV CHROME_PATH=/usr/bin/chromium CHROME_NO_SANDBOX=1 DATA_DIR=/data PORT=8080 NODE_ENV=production
RUN useradd --uid 10001 --create-home api && mkdir -p /data && chown api /data
USER 10001
EXPOSE 8080
CMD ["node", "api/server.mjs"]
