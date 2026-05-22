FROM node:22-slim AS deps

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

ARG VITE_ADMIN_TOKEN=change-me
ARG VITE_API_TARGET=
ENV VITE_ADMIN_TOKEN=${VITE_ADMIN_TOKEN}
ENV VITE_API_TARGET=${VITE_API_TARGET}

COPY . .
RUN pnpm build

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/app/data/cherryapi.sqlite
ENV WEB_DIST_DIR=/app/apps/web/dist
ENV CODEX_CALLBACK_HOST=0.0.0.0
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist

RUN mkdir -p /app/data

EXPOSE 3000 1455

CMD ["node", "apps/server/dist/main.js"]
