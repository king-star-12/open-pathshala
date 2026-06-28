# OpenPathshala prototype — container image for AWS App Runner / any container host
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source
COPY . .

EXPOSE 8080
ENV PORT=8080

# The LLM key is injected at runtime (App Runner secret / env), never baked in.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
