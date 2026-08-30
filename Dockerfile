ARG SOLOOFFICE_VERSION=dev
ARG SOLOOFFICE_COMMIT_SHA=unknown

# Build stage
FROM node:22-alpine AS build

ARG SOLOOFFICE_VERSION
ARG SOLOOFFICE_COMMIT_SHA

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Vite reads these values during the static build; runtime container
# environment variables cannot change an already generated bundle.
ARG VITE_DEMO_MODE=false
ARG VITE_API_URL=/api
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_APP_VERSION=${SOLOOFFICE_VERSION}
ENV VITE_COMMIT_SHA=${SOLOOFFICE_COMMIT_SHA}

# Copy the application code
COPY . .

# Regression tests, lint and type-check/build run inside the same reproducible
# container image. The image is not emitted if one of these quality gates fails.
RUN npm run test:frontend && npm run lint && npm run typecheck && npm run build

# Production stage
FROM nginx:alpine

ARG SOLOOFFICE_VERSION
ARG SOLOOFFICE_COMMIT_SHA

LABEL org.opencontainers.image.title="SoloOffice Frontend" \
      org.opencontainers.image.version="${SOLOOFFICE_VERSION}" \
      org.opencontainers.image.revision="${SOLOOFFICE_COMMIT_SHA}" \
      org.opencontainers.image.source="https://github.com/TingelTangelBob/SoloOffice"

# Copy the built application from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Das reguläre Frontend läuft wie die öffentliche Demo ohne root. Schreibbare
# nginx-Laufzeitpfade werden im Compose-Stack als tmpfs eingebunden.
RUN touch /var/run/nginx.pid \
    && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /usr/share/nginx/html
USER nginx

# Expose port 80
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
