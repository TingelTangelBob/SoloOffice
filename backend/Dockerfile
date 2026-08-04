FROM node:20-alpine

WORKDIR /app

# Local OCR runtime and German/English language data. OCR stays inside the
# backend container and does not send uploaded documents to a third party.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-deu tesseract-ocr-data-eng

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy the application code
COPY . .

# Ensure assets directory exists (contains default logo and icon)
RUN mkdir -p /app/assets

# Expose port 3001
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
