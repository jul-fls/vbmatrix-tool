# Stage 1: Build dependencies
FROM node:20-alpine AS build
LABEL org.opencontainers.image.description "A simple Node.js web server that uses vban to control VB-Audio Matrix Mixer."
# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Stage 2: runtime
FROM node:20-alpine AS runtime

# Set the working directory
WORKDIR /app

# Copy node_modules and application code from the build stage
COPY --from=build /app /app

# Expose the port your app runs on
EXPOSE 3000

# Command to run the server
CMD [ "node", "web/api/server.js" ]