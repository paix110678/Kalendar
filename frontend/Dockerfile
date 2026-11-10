FROM node:24-alpine AS build

WORKDIR /app
ARG KALENDAR_VERSION=dev

COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci

COPY . .
RUN ./node_modules/.bin/ng build --configuration production --define "__KALENDAR_VERSION__='${KALENDAR_VERSION}'"

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80
