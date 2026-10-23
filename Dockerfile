# Hub + built web app in one image. Postgres and Redis run beside it (deploy/docker-compose.yml).
FROM node:26-alpine
RUN npm install -g pnpm@10.33.2
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/motion/package.json packages/motion/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/protocol packages/protocol
COPY packages/motion packages/motion
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @scp/web build

ENV NODE_ENV=production PORT=8080
USER node
WORKDIR /app/apps/server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
