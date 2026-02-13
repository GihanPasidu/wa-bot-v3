FROM node:20-bookworm-slim

# Update packages and install security updates
RUN apt-get update && apt-get upgrade -y && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with clean cache
RUN npm ci --only=production --loglevel=error && npm cache clean --force

# Copy application files
COPY . .

# Create non-root user with specific UID/GID (Debian syntax)
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home botuser

# Change ownership and switch to non-root user
RUN chown -R botuser:nodejs /app
USER botuser

# Expose port
EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:10000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]
