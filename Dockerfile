# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend .
RUN npm run build

# Stage 2: Build backend with frontend assets
FROM maven:3.9-eclipse-temurin-17 AS backend-builder
WORKDIR /app
COPY backend ./backend
COPY --from=frontend-builder /app/dist/game-frontend ./backend/src/main/resources/static
WORKDIR /app/backend
RUN mvn clean package -DskipTests

# Stage 3: Runtime
FROM eclipse-temurin:17-jdk-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY --from=backend-builder /app/backend/target/game-backend*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["java", "-jar", "app.jar"]
