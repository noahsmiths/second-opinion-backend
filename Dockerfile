# syntax=docker/dockerfile:1

FROM node:18
WORKDIR /app
COPY . .
RUN npm install
RUN npm install typescript -g
RUN tsc
RUN mkdir /app/uploads
RUN chown -R a+rwX /app/uploads
EXPOSE 8080

USER node
CMD ["node", "dist/index.js"]