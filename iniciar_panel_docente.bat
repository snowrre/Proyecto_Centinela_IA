@echo off
REM ============================================================
REM  Centinela IA — Panel Docente (Fase 3)
REM  Abre el dashboard del docente en el puerto 8502
REM  Puedes correrlo en PARALELO a app.py (puerto 8501)
REM ============================================================

echo.
echo  ==============================================
echo    Centinela IA — Panel Docente
echo    Fase 3: Visualizacion de camera_logs
echo  ==============================================
echo.

REM Activar entorno virtual
call .\venv\Scripts\activate.bat

REM Mostrar IP local
echo  [INFO] Accede al panel desde tu navegador:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    echo         http:%%a:8502
)
echo  (o en este PC: http://localhost:8502)
echo.

REM Iniciar panel docente en puerto 8502
streamlit run teacher_dashboard.py --server.address 0.0.0.0 --server.port 8502 --server.headless true

pause
