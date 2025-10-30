FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node","server.mjs"]
