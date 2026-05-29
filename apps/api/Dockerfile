# Production image for @toodooh/api. Multi-stage: build with the full workspace toolchain, run
# lean. The runtime keeps `tsx` (a devDep) because migrations run via `tsx scripts/migrate.ts` at
# container start (drizzle-orm's migrator; NOT drizzle-kit). Built from the repo ROOT context
# (the pnpm workspace), per infra/docker-compose.prod.yml `build.context: ..`.
FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @toodooh/api... --frozen-lockfile
COPY apps/api apps/api
RUN pnpm --filter @toodooh/api build
# A symlink-free, self-contained deploy dir (incl. devDeps → tsx) for the runtime stage.
RUN pnpm --filter @toodooh/api deploy --prod=false /out

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/api/package.json ./
# migrate.ts uses `migrationsFolder: 'drizzle'` (relative to WORKDIR) and imports ../src/env.js.
COPY --from=builder /repo/apps/api/drizzle ./drizzle
COPY --from=builder /repo/apps/api/scripts ./scripts
COPY --from=builder /repo/apps/api/src ./src
COPY apps/api/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
