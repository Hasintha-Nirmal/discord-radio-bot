# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies for native modules if needed
RUN apk add --no-cache python3 make g++

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine

# Install FFmpeg for high-performance audio transcoding
RUN apk add --no-cache ffmpeg

ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy built node_modules from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy application source
COPY . .

# Non-root user for security
RUN addgroup -g 1001 -S botgroup && adduser -S botuser -u 1001 -G botgroup \
    && chown -R botuser:botgroup /usr/src/app

USER botuser

# Health check — ensures node process runs cleanly
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "console.log('ok')" || exit 1

# Start the bot
CMD ["node", "index.js"]
