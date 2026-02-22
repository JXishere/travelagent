FROM node:20-slim AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package.json files
COPY packages/bot/package.json packages/bot/
COPY packages/web/package.json packages/web/

# Install all dependencies
RUN npm ci

# Copy source
COPY packages/bot/ packages/bot/
COPY tsconfig.json ./

# Build bot
RUN npm run build -w @sam/bot

# ---

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/bot/package.json packages/bot/
COPY packages/web/package.json packages/web/

RUN npm ci --omit=dev

# Copy built output and prompts
COPY --from=builder /app/packages/bot/dist packages/bot/dist
COPY packages/bot/src/prompts packages/bot/dist/prompts

EXPOSE 3000

CMD ["node", "packages/bot/dist/index.js"]
