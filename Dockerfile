# syntax=docker/dockerfile:1

FROM node:18
WORKDIR /app
COPY . .
RUN npm install
RUN npm install typescript -g
RUN tsc

CMD ["node", "dist/index.js"]
EXPOSE 8080
USER node