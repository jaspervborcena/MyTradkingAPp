FROM node:22-alpine AS build

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/backend/dist ./backend/dist
COPY config ./config

ENV NODE_ENV=production

CMD ["node", "backend/dist/main.js"]
