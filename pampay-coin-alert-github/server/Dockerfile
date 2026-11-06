# PamPay Coin Alert backend — Railway-ready Dockerfile
FROM node:20-slim

WORKDIR /app

# Install build dependencies first (dev deps include typescript)
COPY package.json ./
RUN npm install

# Compile TypeScript then drop dev dependencies for a slim runtime image
COPY src ./src
COPY tsconfig.json ./
RUN npm run build && npm prune --omit=dev

# Runtime data directory (persist with a Railway Volume mounted at /app/data)
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data
ENV PORT=8080

EXPOSE 8080
CMD ["node", "dist/index.js"]
