# syntax=docker/dockerfile:1
# Production image for <App>.Api. Build from the component folder:
#   docker build -t <app>-api .
# DOTNET_VERSION must match the TargetFramework major (e.g. 10.0). Keep it in sync with global.json.
ARG DOTNET_VERSION=10.0

# ---- build ----------------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS build
WORKDIR /src

# Project files first so the restore layer is cached until dependencies change.
# Directory.Packages.props is required by the standard (Central Package Management).
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/<App>.Api/<App>.Api.csproj src/<App>.Api/
COPY src/<App>.Application/<App>.Application.csproj src/<App>.Application/
COPY src/<App>.Core/<App>.Core.csproj src/<App>.Core/
COPY src/<App>.Infrastructure/<App>.Infrastructure.csproj src/<App>.Infrastructure/
# Add the packages.lock.json files here and use `--locked-mode` if the repo has them.
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    dotnet restore src/<App>.Api/<App>.Api.csproj

COPY src/ src/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    dotnet publish src/<App>.Api/<App>.Api.csproj \
        --configuration Release \
        --no-restore \
        --output /app/publish \
        -p:UseAppHost=false

# ---- runtime --------------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION} AS runtime
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=8080

# Files stay owned by root (read-only for the app); the process runs as the built-in non-root user.
COPY --from=build /app/publish .

# APP_UID is defined by the official .NET images (non-root "app" user).
USER $APP_UID
EXPOSE 8080

# No HEALTHCHECK: the image has no curl/wget. Point the orchestrator / load balancer probe at GET /health.
ENTRYPOINT ["dotnet", "<App>.Api.dll"]
