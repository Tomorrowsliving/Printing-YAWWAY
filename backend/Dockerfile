FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    xvfb \
    xauth \
    libasound2 \
    libdbus-1-3 \
    libegl1 \
    libgl1 \
    libglib2.0-0 \
    libglu1-mesa \
    libgstreamer1.0-0 \
    libgstreamer-plugins-base1.0-0 \
    libgtk-3-0 \
    libmspack0 \
    libnss3 \
    libopengl0 \
    libsecret-1-0 \
    libsoup-3.0-0 \
    libwebkit2gtk-4.1-0 \
    libx11-6 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxinerama1 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend

# Launch from the parent directory of the 'backend' package
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001"]
