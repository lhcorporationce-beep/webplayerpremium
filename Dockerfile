FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
