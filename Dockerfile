# syntax=docker/dockerfile:1

FROM node:18
WORKDIR /app
COPY . .
RUN npm install
RUN npm install typescript -g
RUN tsc
RUN chown -R node /app
EXPOSE 8080

USER node
CMD ["node", "dist/index.js"]