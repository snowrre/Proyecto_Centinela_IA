#!/bin/bash

echo "=============================================="
echo "  Centinela IA — Entorno unificado (Linux)"
echo "=============================================="
echo ""

# 1. Activar entorno virtual e iniciar el backend (Flask/IA) en segundo plano
echo "[+] Iniciando servidor de Inteligencia Artificial (Backend) en el puerto 5000..."
source venv/bin/activate
python3 server.py &
BACKEND_PID=$!

# Esperar un par de segundos para asegurar que el backend levanta
sleep 2

# 2. Navegar a la carpeta del frontend y ejecutar el servidor web
echo ""
echo "[+] Iniciando el Portal del Alumno (Frontend React) en el puerto 5173..."
cd dashboard
npm run dev

# (Opcional) Capturar la señal de interrupción (Ctrl+C) para matar también el backend cuando el usuario cierre el frontend
trap "echo 'Apagando Centinela IA...'; kill $BACKEND_PID; exit" SIGINT SIGTERM
