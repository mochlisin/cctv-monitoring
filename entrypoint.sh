#!/bin/sh
# Jalankan MediaMTX di background
./bin/mediamtx mediamtx.yml &

# Jalankan migrasi, seed, dan Next.js
npx prisma db push --skip-generate || true
node prisma/seed.mjs || true
npm start
