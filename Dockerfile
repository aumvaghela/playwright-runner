# Use the official Playwright image that already includes Chromium/Firefox/WebKit
FROM mcr.microsoft.com/playwright:v1.56.0-jammy-amd64

# Set working directory
WORKDIR /app

# Copy dependency files first
COPY package*.json ./

# Install Node dependencies
RUN npm install

# Copy the rest of your project
COPY . .

# Default port (Render will override this with its own PORT, e.g. 10000)
ENV PORT=3000

# Start the server
CMD ["npm", "start"]
