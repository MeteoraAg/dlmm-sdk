FROM node:22.23.4
RUN mkdir dlmm-server
WORKDIR /dlmm-server
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start-server"]
