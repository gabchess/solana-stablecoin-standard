FROM node:20-slim AS builder
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/index.js"]
