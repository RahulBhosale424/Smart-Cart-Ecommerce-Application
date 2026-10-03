# ---- 1. install dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- 2. build the app ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Address of the API gateway INSIDE the Docker network (same on every machine)
ARG GATEWAY_URL=http://api-gateway:3000
ENV GATEWAY_URL=$GATEWAY_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. small image that only runs the app ----
FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
