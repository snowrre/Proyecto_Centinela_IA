# 1. Usar un motor de Python ligero como base
FROM python:3.11.9-slim

# 2. Instalar las librerías gráficas de Linux que exige Mediapipe
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    libgles2 \
    && rm -rf /var/lib/apt/lists/*

# 3. Crear nuestra carpeta de trabajo
WORKDIR /app

# 4. Copiar e instalar los requerimientos de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copiar todo el código de Centinela IA
COPY . .

# 6. Comando para encender el motor
CMD ["python", "server.py"]
