# vat.law — Railway Dockerfile
# Vertical #25 of Supreme Operating System — AI-native UK complex-VAT navigator.
# Node 20 Alpine + Chromium (Puppeteer PDF rendering only — partial-exemption memos,
# DRC invoice packs, margin-scheme quarterly records, OSS return drafts, HMRC enquiry
# response binders).
#
# IMPORTANT — Playwright is NOT required for vat.law.
# HMRC MTD VAT exposes a sanctioned REST API (oauth + fraud-prevention headers);
# Xero / QuickBooks / Sage Business Cloud / FreeAgent all expose OAuth2 APIs.
# No portal RPA is required, so we ship the leaner Alpine-Chromium-only image.
#
# Non-root runtime user · multi-stage build · production-only deps in runner.

FROM node:20-alpine AS base
WORKDIR /app

# System libs required by:
#  - Chromium (Puppeteer PDF rendering — partial-exemption memos, DRC packs,
#    margin-scheme records, OSS return drafts, HMRC enquiry response binders)
#  - Sharp / image processing for invoice-evidence and receipt vault
#  - libxml2/openssl required by node-soap consumers (some HMRC integrations
#    still expect SOAP-style XML envelopes for VAT fraud-prevention headers)
RUN apk add --no-cache \
      libc6-compat chromium nss freetype harfbuzz ca-certificates ttf-freefont \
      bash udev ttf-opensans dbus glib gcompat libstdc++ libxml2 openssl \
  && addgroup -g 1001 -S nodejs \
  && adduser  -S nextjs -u 1001

# Puppeteer uses the Alpine-supplied chromium binary (PDF rendering only)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# ----------------------------------------------------------------------------
# Deps stage — production deps only (carried into runner)
# ----------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ----------------------------------------------------------------------------
# Build stage — full dependency tree so the Next.js build can compile
# ----------------------------------------------------------------------------
FROM base AS build
COPY . .
RUN npm ci
RUN npm run build

# ----------------------------------------------------------------------------
# Runner stage — minimal production image
# ----------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build artefacts
COPY --from=build --chown=nextjs:nodejs /app/.next         ./.next
COPY --from=build --chown=nextjs:nodejs /app/public        ./public 2>/dev/null || true
COPY --from=build --chown=nextjs:nodejs /app/package.json  ./package.json
COPY --from=build --chown=nextjs:nodejs /app/node_modules  ./node_modules

# PDF artefact dir (Puppeteer renders dropped here before upload to Supabase Storage)
RUN mkdir -p /tmp/puppeteer-pdf && chown -R nextjs:nodejs /tmp/puppeteer-pdf

USER nextjs
EXPOSE 3000

# Healthcheck — Railway will also poll /api/health, but the in-container probe
# guarantees the HMRC MTD client and Anthropic API client are reachable.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["npm", "start"]
