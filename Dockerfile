FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV DATABASE_URL="mysql://root:PnKyM0z1RkuGCUa96s5yEq5UDAnjlXX5ffkU2WIuBTkpjmS7Tusj5UH6SPHLEdu6@uve2axpbnthw5ner8ysipmtw:3306/default"
RUN npx prisma db push --skip-generate || true
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
