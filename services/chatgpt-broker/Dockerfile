FROM python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home broker && mkdir /data && chown broker:broker /data
COPY broker.py start.py wordpress_drafts.py ./
USER 10001
ENV BROKER_STORAGE_DIRECTORY=/data/broker PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000
CMD ["python", "start.py"]
