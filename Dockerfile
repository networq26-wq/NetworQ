# ── Base image ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ── Build frontend ────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .

# Build args for Expo public vars (baked into the frontend bundle at build time)
ARG EXPO_PUBLIC_SUPABASE_URL
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY
ARG EXPO_PUBLIC_GOOGLE_CLIENT_ID
ARG EXPO_PUBLIC_AI_PROXY_URL
ARG EXPO_PUBLIC_EMAIL_PROXY_URL

ENV EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL
ENV EXPO_PUBLIC_SUPABASE_ANON_KEY=$EXPO_PUBLIC_SUPABASE_ANON_KEY
ENV EXPO_PUBLIC_GOOGLE_CLIENT_ID=$EXPO_PUBLIC_GOOGLE_CLIENT_ID
ENV EXPO_PUBLIC_AI_PROXY_URL=$EXPO_PUBLIC_AI_PROXY_URL
ENV EXPO_PUBLIC_EMAIL_PROXY_URL=$EXPO_PUBLIC_EMAIL_PROXY_URL
ENV EXPO_NO_TELEMETRY=1

RUN npm run build:web
# Copy illustrations, waitlist, and exact brand favicons into dist
RUN mkdir -p dist/illustrations && \
    cp -r public/illustrations/* dist/illustrations/ && \
    cp public/waitlist.html dist/waitlist.html && \
    cp -f public/favicon.* dist/ && \
    sed -i 's|</head>|<link rel="icon" type="image/svg+xml" href="/favicon.svg" /><link rel="icon" type="image/png" href="/favicon.png" /><link rel="shortcut icon" href="/favicon.ico" /></head>|g' dist/index.html

# ── Production image ──────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend files
COPY server.js .
COPY api/ ./api/
COPY public/ ./public/

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Run as the unprivileged user that ships with the node image
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "server.js"]
