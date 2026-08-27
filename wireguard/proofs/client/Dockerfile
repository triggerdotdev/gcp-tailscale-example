FROM node:21-bookworm
ARG WIREPROXY_VERSION=v1.1.3
ARG TARGETARCH=arm64
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL "https://github.com/windtf/wireproxy/releases/download/${WIREPROXY_VERSION}/wireproxy_linux_${TARGETARCH}.tar.gz" -o /tmp/wp.tgz \
  && tar -xzf /tmp/wp.tgz -C /usr/local/bin wireproxy \
  && chmod 755 /usr/local/bin/wireproxy \
  && rm -f /tmp/wp.tgz \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /app
COPY --chown=node:node package.json ./
RUN npm install --no-audit --no-fund --no-package-lock
COPY --chown=node:node entrypoint.sh task.js ./
ENTRYPOINT ["bash", "entrypoint.sh"]
