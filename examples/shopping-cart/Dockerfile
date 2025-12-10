FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy built application
COPY dist ./dist

# Copy node_modules (already built locally)
COPY node_modules ./node_modules

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/index.js"]
