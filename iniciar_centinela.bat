@echo off
REM ============================================================
REM  Centinela IA — Script de inicio
REM  Abre Streamlit en la red local (0.0.0.0:8501)
REM  Accesible desde tablets en la misma red WiFi
REM ============================================================

echo.
echo  ==============================================
echo    Centinela IA — Iniciando sistema...
echo  ==============================================
echo.

REM Verificar que Ollama esté corriendo
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo  [!] Ollama no está corriendo. Iniciando...
    start "" "C:\Users\sergio\AppData\Local\Programs\Ollama\ollama.exe" serve
    timeout /t 3 /nobreak >NUL
) else (
    echo  [OK] Ollama ya está activo.
)

REM Activar entorno virtual
call .\venv\Scripts\activate.bat

REM Mostrar IP local para tablets
echo.
echo  [INFO] Conecta tus tablets a:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set ip=%%a
    echo         http:%%a:8501
)
echo.

REM Iniciar Streamlit en todas las interfaces de red
streamlit run app.py --server.address 0.0.0.0 --server.port 8501 --server.headless true --server.maxUploadSize 10

pause
