# syntax=docker/dockerfile:1
FROM node:22.23.2-bookworm-slim AS base
WORKDIR /app
RUN npm install --global pnpm@11.19.0

FROM base AS verify
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV TRIPDOCK_WEB_RUNTIME=node
RUN pnpm check

FROM base AS api-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

FROM api-deps AS api-build
COPY apps/api apps/api
RUN pnpm --filter @tripdock/api build

FROM base AS api-production-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --prod --frozen-lockfile

FROM api-production-deps AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
COPY --from=api-build /app/apps/api/dist apps/api/dist
COPY --from=api-build /app/apps/api/drizzle apps/api/drizzle
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]

FROM base AS web-build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
ARG PUBLIC_ORIGIN
ENV TRIPDOCK_WEB_RUNTIME=node NEXT_PUBLIC_GRAPHQL_URL=${PUBLIC_ORIGIN}/graphql
RUN test -n "$PUBLIC_ORIGIN" && pnpm --filter @tripdock/web build

FROM base AS web
ENV NODE_ENV=production TRIPDOCK_WEB_RUNTIME=node
COPY --from=web-build /app/node_modules node_modules
COPY --from=web-build /app/apps/web/node_modules apps/web/node_modules
COPY --from=web-build /app/apps/web/package.json apps/web/package.json
COPY --from=web-build /app/apps/web/dist apps/web/dist
COPY --from=web-build /app/apps/web/public apps/web/public
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/vinext/dist/cli.js", "start", "--hostname", "0.0.0.0", "--port", "3000"]
