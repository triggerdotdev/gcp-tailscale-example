FROM triggerdotdev/node:21-bookworm@sha256:49c6575cda32f63ac21a4aeaabc360dc50c6f767b86b675b44de7a9e9b6ca3fc
USER node
WORKDIR /app
COPY --chown=node:node package.json ./
RUN npm install --no-audit --no-fund --no-package-lock
COPY --chown=node:node task.js ./
ENTRYPOINT ["dumb-init", "node", "task.js"]
