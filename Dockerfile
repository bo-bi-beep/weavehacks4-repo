# Main Agent HTTP service (agents/main_agent/server.ts).
#
# Only the harness (model calls, agent loop, sub-agent tools) runs in this
# container; the heavy compute (shell, files) runs remotely on Blaxel micro-VMs.
# So the image is lightweight and needs only *outbound* network to OpenAI,
# Blaxel, and W&B — no inbound port beyond the one it listens on.
FROM node:22-slim

WORKDIR /app

# Install dependencies first so this layer is cached across code changes. The
# service runs via tsx (a devDependency), so keep dev deps with --include=dev.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# App code plus the repo skills resolved at runtime. Skills are read from
# .claude/skills/ and .agents/skills/ relative to the repo root, so those dirs
# must be present in the image (see agents/main_agent/index.ts).
COPY tsconfig.json ./
COPY src ./src
COPY agents ./agents
COPY .claude ./.claude
COPY .agents ./.agents

# Credentials (OPENAI_API_KEY, BL_API_KEY, BL_WORKSPACE, WANDB_*) are supplied at
# runtime as env vars — never baked into the image. PaaS platforms inject PORT;
# default to 8080 otherwise.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "main:serve"]
