# asr-py image (FastAPI, Python 3.11). Build context = repository root:
#   docker build -f apps/asr-py/Dockerfile -t vaaniehr/asr-py:local .
# Base image pinned by tag and digest (checked on Docker Hub 2026-10-14). No secrets baked in.
ARG PYTHON_IMAGE=python:3.11.17-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89

FROM ${PYTHON_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY apps/asr-py/requirements.txt ./
RUN pip install -r requirements.txt
COPY apps/asr-py/app ./app
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER app
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
