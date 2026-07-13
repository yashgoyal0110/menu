# Single-image build for the Express + React stack.
# Produces ONE container: Express serves the built React SPA and the /api routes.
#
# Build:  docker build -t servicedock .
# Run:    docker run -p 3000:3000 --env-file .env -v servicedock_uploads:/app/server/uploads servicedock
#
# Or use docker-compose.yml (app + postgres + volumes).

# --- 1. Build the React client -------------------------------------------------
FROM node:22-alpine AS client-build
WORKDIR /client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- 2. Build the Express server (+ generate Prisma client) --------------------
FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package.json ./
RUN npm install
# Prisma schema/migrations live at repo root; server scripts reference ../prisma.
COPY prisma /app/prisma
COPY server/ ./
RUN npm run prisma:generate
RUN npm run build

# --- 3. Runtime ---------------------------------------------------------------
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app/server

COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=server-build /app/prisma /app/prisma
# Express serves this at /app/client/dist (see src/index.ts static path).
COPY --from=client-build /client/dist /app/client/dist

EXPOSE 3000

# Apply pending migrations, then start the server (fail loud if migrate fails).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema=/app/prisma/schema.prisma && node dist/index.js"]
