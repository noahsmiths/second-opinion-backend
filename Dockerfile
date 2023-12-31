# syntax=docker/dockerfile:1

FROM node:18
WORKDIR /app
COPY . .
RUN npm install
RUN npm install typescript -g
RUN tsc
RUN mkdir /app/uploads
RUN touch /app/uploads/transcription.webm
RUN chown -R node:node /app/uploads
RUN chown -R node:node /app/uploads/transcription.webm
EXPOSE 8080

USER node
CMD ["node", "dist/index.js"]