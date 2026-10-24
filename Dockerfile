FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/money/package.json apps/money/
COPY packages/protocol/package.json packages/protocol/
COPY packages/input/package.json packages/input/
COPY packages/game-sdk/package.json packages/game-sdk/
COPY games/sky-tilt/package.json games/sky-tilt/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["pnpm", "start"]
