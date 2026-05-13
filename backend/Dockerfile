FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY storage ./storage

# Launch from the parent directory of the 'backend' package
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
