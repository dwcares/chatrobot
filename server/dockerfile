FROM node:carbon

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

EXPOSE 80
EXPOSE 5000
EXPOSE 3000

CMD [ "npm", "start" ]