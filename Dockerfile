FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
# 9229も一応開けておく
EXPOSE 9229

# nodemon経由で起動するように変更
CMD ["npm", "run", "dev"]