FROM node:20-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY grid_prix ./grid_prix
COPY --from=frontend /app/dist ./grid_prix/static
ENV GRID_PRIX_PUBLIC_READ_ONLY=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["python3", "-m", "grid_prix.webapp"]
