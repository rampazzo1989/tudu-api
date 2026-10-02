# Multi-stage build for Tudú API
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Install build dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and build
COPY . .
RUN npm run build

# Runner image
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package and install dependencies (including prisma for db push)
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Automatically push database schema to Postgres before launching API
CMD ["sh", "-c", "npx prisma db push && node dist/main"]
