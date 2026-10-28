#!/bin/sh
# Jalankan MediaMTX di background
./bin/mediamtx mediamtx.yml &

# Jalankan migrasi, seed, dan Next.js
npx prisma db push --skip-generate || true
npx prisma db seed || true
npm start
