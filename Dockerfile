# Build stage
FROM node:20-alpine AS build

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

# Copy the application code
COPY . .

# Lint and type-check/build inside the same reproducible container image.
RUN npm run lint && npm run typecheck && npm run build

# Production stage
FROM nginx:alpine

# Copy the built application from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
