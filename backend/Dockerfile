FROM node:20-alpine

WORKDIR /app

# Local OCR runtime and German/English language data. OCR stays inside the
# backend container and does not send uploaded documents to a third party.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-deu tesseract-ocr-data-eng poppler-utils

# Copy the lockfile and install the exact dependency graph.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the application code
COPY . .

# Run dependency-free backend regression tests in every image build.
RUN npm test

# Ensure assets directory exists (contains default logo and icon)
RUN mkdir -p /app/assets /backups && chown -R node:node /app /backups

# Do not run the application as root inside the container.
USER node

# Expose port 3001
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
