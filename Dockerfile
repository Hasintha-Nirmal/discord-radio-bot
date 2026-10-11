# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine

# Install FFmpeg and Python (needed for some native addons)
RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /usr/src/app

# Copy built node_modules from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy application source
COPY . .

# Non-root user for security
RUN addgroup -g 1001 -S botgroup && adduser -S botuser -u 1001 -G botgroup
USER botuser

# Health check — ensures the process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "console.log('ok')" || exit 1

# Start the bot
CMD ["node", "index.js"]
