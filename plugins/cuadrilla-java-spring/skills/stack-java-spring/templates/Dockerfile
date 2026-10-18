# Production image for a cuadrilla java-spring component (Maven wrapper).
# Placeholder: <java-version> = the <java.version> pinned in pom.xml (an LTS: 21, 25…).
# Tests are not run here: CI (ci-<name>) is the gate before any deploy.

ARG JAVA_VERSION=<java-version>

# ---- build ---------------------------------------------------------------------------------
FROM eclipse-temurin:${JAVA_VERSION}-jdk AS build
WORKDIR /workspace

# Dependencies first: this layer is reused while pom.xml does not change.
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw -B -q dependency:go-offline

COPY src src
RUN ./mvnw -B -q package -DskipTests \
 && cp target/*.jar application.jar \
 && java -Djarmode=tools -jar application.jar extract --layers --destination extracted

# ---- runtime -------------------------------------------------------------------------------
FROM eclipse-temurin:${JAVA_VERSION}-jre
RUN groupadd --system app && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app
WORKDIR /application

# One layer per Spring Boot layer, from least to most frequently changed.
COPY --from=build /workspace/extracted/dependencies/ ./
COPY --from=build /workspace/extracted/spring-boot-loader/ ./
COPY --from=build /workspace/extracted/snapshot-dependencies/ ./
COPY --from=build /workspace/extracted/application/ ./

USER app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
# The app listens on ${PORT:8080} (server.port in application.yml).
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "application.jar"]
