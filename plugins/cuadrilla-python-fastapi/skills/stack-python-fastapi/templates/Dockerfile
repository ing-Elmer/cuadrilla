# cuadrilla — python-fastapi production image (any container platform).
# Replace <app> with the package name from the project profile and keep PYTHON_VERSION aligned
# with .python-version. Build context: the backend folder.
ARG PYTHON_VERSION=3.13

# --- build: install dependencies from uv.lock into a virtualenv ---
FROM python:${PYTHON_VERSION}-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
WORKDIR /app

# Dependencies first, so the layer is cached until uv.lock changes.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

# --- runtime: no uv, no build tools, non-root user ---
FROM python:${PYTHON_VERSION}-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=builder --chown=app:app /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER app
EXPOSE 8000

# No --reload in production. Most platforms inject PORT; --proxy-headers because traffic arrives
# through the platform's proxy (narrow --forwarded-allow-ips if your platform documents its range).
CMD ["sh", "-c", "exec uvicorn <app>.api.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
