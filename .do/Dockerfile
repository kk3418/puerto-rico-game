# Build context is the repo root. Referenced by .do/app.yaml as dockerfile_path.
#
# A Dockerfile rather than the Node buildpack because the buildpack prunes
# devDependencies after the build, and Prisma's generated client lives in
# node_modules/.prisma. Installing production deps in a clean runtime stage
# regenerates that client deterministically.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma's query engine links against OpenSSL, which slim images omit.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Copied before npm ci so the postinstall `prisma generate` can find the schema.
COPY package.json package-lock.json ./
COPY server/prisma ./server/prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src
RUN npm run build:server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/prisma ./server/prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
RUN chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "server/dist/index.js"]
