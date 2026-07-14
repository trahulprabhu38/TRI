FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    TOKEN_DIR=/tokens

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

RUN mkdir -p /tokens
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
