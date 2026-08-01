FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN npm install --global pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PIKACHU_DB_PATH=/var/data/pikachu-music.sqlite

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /var/data && chown -R node:node /app /var/data
USER node

EXPOSE 3000
VOLUME ["/var/data"]

CMD ["node", "dist/server/server/index.js"]
