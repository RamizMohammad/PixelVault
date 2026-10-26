FROM python:3.11-slim

WORKDIR /app

# install deps first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy server + admin panel
COPY *.py ./
COPY static ./static

# create storage dirs
RUN mkdir -p storage/thumb storage/medium storage/large meta

# non-root user for security
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# --proxy-headers so the app sees https when it sits behind nginx
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
