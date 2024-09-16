FROM node:20
RUN mkdir dlmm-server
WORKDIR /dlmm-server
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start-server"]
