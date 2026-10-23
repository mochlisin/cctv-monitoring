FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache curl tar gzip
COPY package*.json ./
RUN npm ci
COPY . .
RUN node scripts/install-mediamtx.mjs
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg curl
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/mediamtx.yml ./mediamtx.yml
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh ./bin/mediamtx || true

EXPOSE 3000
EXPOSE 8888
EXPOSE 8889
EXPOSE 8189/udp
EXPOSE 8189/tcp
ENV PORT=3000

CMD ["./entrypoint.sh"]
