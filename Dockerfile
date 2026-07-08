FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "run", "dev"]