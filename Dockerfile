FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG DATABASE_URL="mysql://mysql:***@bfufhewigg34b8ccqhpj0zbb:3306/default"
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate
RUN npx prisma db push --skip-generate
RUN node prisma/seed.mjs
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
ENV PORT=3000
CMD ["npm", "start"]
