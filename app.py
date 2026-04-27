"""
app.py — Centinela IA v3.0  ·  WebRTC Stream Mode
===================================================
Arquitectura:
  • streamlit-webrtc   → stream continuo de video desde el navegador del alumno
  • CentinelaProcessor → hilo independiente que ejecuta YOLO + MediaPipe frame-a-frame
  • Queues thread-safe → comunican el procesador con la UI de Streamlit
  • st_autorefresh     → refresca las métricas cada ~1.5 s sin bloquear

Fases del VideoProcessor (autónomas, sin captura manual):
  1. setup     → MediaPipe valida posición (3 s estables)
  2. gaze_cal  → espera señal "Calibrar Punto de Vista" del usuario
  3. cal       → 100 frames automáticos calibran EAR base + Pitch base
  4. monitoring→ YOLO + MediaPipe + SuspicionLevel en tiempo real

ICE Config:
  STUN de Google + TURN de Open Relay (funciona con Ngrok y la mayoría
  de NAT de colegios/universidades).
"""

import os, time, json, datetime, threading, queue
from pathlib import Path
from typing import Optional

import cv2, numpy as np
import streamlit as st
import ollama
import av
import speech_recognition as sr
from supabase import create_client, Client
from dotenv import load_dotenv
from streamlit_webrtc import webrtc_streamer, WebRtcMode, VideoProcessorBase, RTCConfiguration
from logic import ProctorVision, SuspicionLevel, SetupStatus

if 'user_matricula' not in st.session_state:
    st.session_state.user_matricula = None
if 'user_name' not in st.session_state:
    st.session_state.user_name = None
if 'user_email' not in st.session_state:
    st.session_state.user_email = None
if 'theme' not in st.session_state:
    st.session_state.theme = 'dark'
# ── Autorefresh opcional ──────────────────────────────────────────────────────
try:
    from streamlit_autorefresh import st_autorefresh
    HAS_AUTOREFRESH = True
except ImportError:
    HAS_AUTOREFRESH = False

# ── Configuración de página ───────────────────────────────────────────────────
st.set_page_config(
    page_title="Centinela IA",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── CSS Premium Neo-Glass con soporte de tema claro/oscuro ────────────────────
def _build_css(dark: bool = True) -> str:
    # Colores base
    bg_color = "#050505" if dark else "#f4f4f5"
    
    # Gradientes de fondo sutiles (Cyber/Aurora)
    grad1 = "rgba(59, 130, 246, 0.15)" if dark else "rgba(59, 130, 246, 0.25)"
    grad2 = "rgba(147, 51, 234, 0.15)" if dark else "rgba(147, 51, 234, 0.25)"
    grad3 = "rgba(16, 185, 129, 0.1)" if dark else "rgba(16, 185, 129, 0.15)"
    
    # Superficies de cristal (Glassmorphism)
    glass_bg = "rgba(15, 15, 15, 0.5)" if dark else "rgba(255, 255, 255, 0.7)"
    glass_border = "rgba(255, 255, 255, 0.1)" if dark else "rgba(0, 0, 0, 0.1)"
    glass_shadow = "0 8px 32px 0 rgba(0, 0, 0, 0.3)" if dark else "0 8px 32px 0 rgba(31, 38, 135, 0.05)"
    
    # Texto y acentos
    txt = "#f8fafc" if dark else "#0f172a"
    txt_muted = "#94a3b8" if dark else "#64748b"
    primary_grad = "linear-gradient(135deg, #3b82f6, #8b5cf6)"
    
    return f"""<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

/* Ocultar Chrome de Streamlit */
#MainMenu, footer, header, .stDeployButton, [data-testid="stToolbar"] {{ visibility:hidden!important; display:none!important; }}

html, body, [class*="css"] {{ font-family: 'Inter', -apple-system, sans-serif !important; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }}

/* Fondo Premium con Orbes Luminosos */
.stApp {{
    background-color: {bg_color} !important;
    background-image: 
        radial-gradient(circle at 0% 0%, {grad1}, transparent 50%),
        radial-gradient(circle at 100% 100%, {grad2}, transparent 50%),
        radial-gradient(circle at 50% 50%, {grad3}, transparent 50%) !important;
    background-attachment: fixed !important;
    color: {txt} !important;
}}

/* Contenedor Principal */
.block-container {{ padding-top: 2rem !important; padding-bottom: 2rem !important; max-width: 100% !important; }}

/* Tipografía Premium */
h1, h2, h3, h4, h5, h6 {{ color: {txt} !important; font-weight: 700 !important; letter-spacing: -0.02em !important; }}
.stMarkdown p, [data-testid="stMarkdownContainer"] p {{ color: {txt} !important; }}
[data-testid="stWidgetLabel"] p, label {{ color: {txt} !important; font-weight: 500 !important; }}

/* Paneles Laterales (Sidebar) - Glass */
section[data-testid="stSidebar"] {{
    background: {glass_bg} !important;
    backdrop-filter: blur(24px) !important;
    -webkit-backdrop-filter: blur(24px) !important;
    border-right: 1px solid {glass_border} !important;
}}

/* Botones Premium */
.stButton > button {{
    background: {primary_grad} !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 12px !important;
    font-weight: 600 !important;
    font-size: 0.95rem !important;
    padding: 12px 24px !important;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3) !important;
    transition: all 0.3s ease !important;
    text-transform: none !important;
}}
.stButton > button:hover {{
    transform: translateY(-2px) !important;
    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5) !important;
}}
[data-testid="baseButton-secondary"], [kind="secondary"] {{
    background: {glass_bg} !important;
    backdrop-filter: blur(10px) !important;
    color: {txt} !important;
    border: 1px solid {glass_border} !important;
    box-shadow: none !important;
}}
[data-testid="baseButton-secondary"]:hover, [kind="secondary"]:hover {{
    background: rgba(255,255,255,0.1) !important;
    transform: translateY(-2px) !important;
}}

/* Formularios y Cajas Glassmorphism */
[data-testid="stForm"], [data-testid="stExpander"] {{
    background: {glass_bg} !important;
    backdrop-filter: blur(24px) !important;
    -webkit-backdrop-filter: blur(24px) !important;
    border: 1px solid {glass_border} !important;
    border-radius: 20px !important;
    box-shadow: {glass_shadow} !important;
    padding: 24px !important;
    transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), border-color 0.3s ease !important;
}}
[data-testid="stForm"]:hover, [data-testid="stExpander"]:hover {{
    border-color: rgba(59, 130, 246, 0.4) !important;
    transform: translateY(-2px) !important;
}}

/* Inputs Premium */
.stTextInput > div > div > input, .stSelectbox > div > div > div, .stMultiSelect > div > div > div {{
    background: rgba(0,0,0,0.2) !important;
    backdrop-filter: blur(10px) !important;
    color: {txt} !important;
    border: 1px solid {glass_border} !important;
    border-radius: 12px !important;
    padding: 12px 16px !important;
    transition: all 0.3s ease !important;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.1) !important;
}}
.stTextInput > div > div > input:focus {{
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important;
}}

/* Pestañas (Tabs) Premium */
div[data-baseweb="tab-list"] {{
    background: {glass_bg} !important;
    backdrop-filter: blur(12px) !important;
    border-radius: 30px !important;
    padding: 6px !important;
    border: 1px solid {glass_border} !important;
    gap: 8px !important;
    margin-bottom: 24px !important;
}}
button[data-baseweb="tab"] {{
    background: transparent !important;
    border: none !important;
    color: {txt_muted} !important;
    padding: 10px 24px !important;
    border-radius: 24px !important;
    font-weight: 500 !important;
    transition: all 0.3s ease !important;
}}
button[data-baseweb="tab"][aria-selected="true"] {{
    background: {primary_grad} !important;
    color: white !important;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3) !important;
    font-weight: 600 !important;
}}
div[data-baseweb="tab-border"], div[data-baseweb="tab-highlight"] {{ display: none !important; }}

/* Progress */
div[data-testid="stProgressBar"] > div {{ background: rgba(255,255,255,0.1) !important; border-radius: 6px; }}
div[data-testid="stProgressBar"] > div > div {{ background: {primary_grad} !important; border-radius: 6px; }}

/* Alertas Log Premium */
.alert-box {{
    padding: 16px 20px;
    border-radius: 16px;
    margin-bottom: 12px;
    background: {glass_bg};
    backdrop-filter: blur(12px);
    border: 1px solid {glass_border};
    box-shadow: {glass_shadow};
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}}
.alert-box:hover {{ transform: translateX(6px); border-color: rgba(59, 130, 246, 0.3); }}
.alert-critico {{ border-left: 4px solid #ef4444; }}
.alert-alerta {{ border-left: 4px solid #f59e0b; }}
.alert-info {{ border-left: 4px solid #3b82f6; }}
.alert-ok {{ border-left: 4px solid #10b981; }}
.alert-time {{ font-size: 0.75rem; color: {txt_muted}; font-weight: 600; letter-spacing: 0.05em; }}
.alert-msg {{ font-size: 0.95rem; color: {txt}; margin-top: 6px; font-weight: 500; }}

/* Alertas Nativas */
[data-testid="stAlert"] {{ border-radius: 16px !important; border: 1px solid {glass_border} !important; backdrop-filter: blur(12px) !important; background: {glass_bg} !important; box-shadow: {glass_shadow} !important; }}

/* Scrollbar Elegante */
::-webkit-scrollbar {{ width: 6px; height: 6px; }}
::-webkit-scrollbar-track {{ background: transparent; }}
::-webkit-scrollbar-thumb {{ background: rgba(59, 130, 246, 0.4); border-radius: 10px; }}
::-webkit-scrollbar-thumb:hover {{ background: rgba(59, 130, 246, 0.7); }}

/* Anti-copy */
*{{-webkit-user-select:none;user-select:none;}}
input,textarea{{-webkit-user-select:text;user-select:text;}}
</style>
<script>
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{{
  if(e.keyCode===123){{e.preventDefault();return false;}}
  if(e.ctrlKey&&e.shiftKey&&(e.keyCode===73||e.keyCode===74)){{e.preventDefault();return false;}}
  if(e.ctrlKey&&e.keyCode===85){{e.preventDefault();return false;}}
}});
</script>"""

st.markdown(_build_css(st.session_state.theme == 'dark'), unsafe_allow_html=True)

# ── CSS: fin bloque de estilo ──────────────────────────────────────────────────
# (eliminado: estilo_cristal — reemplazado por _build_css)



# ── Constantes ────────────────────────────────────────────────────────────────
ALERTS_LOG       = Path("alerts/alert_log.json")
ALERTS_LOG.parent.mkdir(exist_ok=True)
OLLAMA_MODEL     = "gemma2:2b"
OLLAMA_COOLDOWN  = 15.0
UNLOCK_SECS      = 3.0
CAL_FRAMES       = 100

# ICE servers — RTCConfiguration object (requerido por streamlit-webrtc >= 0.45)
# El STUN de Google permite NAT Traversal a través de firewalls universitarios.
# Se elimina iceTransportPolicy para no restringir la negociación ICE.
RTC_CONFIG = RTCConfiguration(
    {"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}
)

# ── Supabase Init ─────────────────────────────────────────────────────────────
load_dotenv()
supabase_url: str = os.environ.get("SUPABASE_URL", "")
supabase_key: str = os.environ.get("SUPABASE_KEY", "")
try:
    supabase: Client = create_client(supabase_url, supabase_key)
except Exception:
    supabase = None

# Ruta del puente de comunicación entre el Panel Docente y la Vista del Alumno
EXAM_CONFIG_FILE = Path("exam_config.json")


def fetch_exam_config() -> dict:
    """
    Lee el directorio multi-sala {PIN: URL} desde exam_config.json.
    Si el archivo tiene el formato antiguo ({url_examen: ...}) lo ignora.
    Devuelve el diccionario completo o {} si no existe / está dañado.
    """
    try:
        if EXAM_CONFIG_FILE.exists():
            data = json.loads(EXAM_CONFIG_FILE.read_text(encoding="utf-8"))
            # Detectar formato antiguo y devolver vacío
            if "url_examen" in data:
                return {}
            return data
    except Exception:
        pass
    return {}

# ── Session state ─────────────────────────────────────────────────────────────
DEFAULTS = {
    "mode":            "login",
    "user_id":         None,
    "user_name":       None,       # nombre_completo
    "user_matricula":  None,       # matricula
    "user_email":      None,       # correo
    "attempt_id":      None,
    "proctor":         None,
    "device_type":     "laptop",
    "alert_log":       [],
    "session_start":   None,
    "ollama_response": "",
    "ollama_loading":  False,
    "last_ollama_ts":  0.0,
    # Cache UI desde el procesador
    "ui_phase":        "setup",
    "ui_report":       None,
    "ui_frame_count":  0,
    "ui_cal_progress": 0.0,
    "ui_warning":      False,
    "last_object_log_time": 0.0,
    # Multi-sala: PIN y URL del examen asignado al alumno
    "exam_pin":             "",          # PIN ingresado por el alumno
    "url_examen":           "",          # URL correspondiente al PIN
    "exam_config_ts":       0.0,         # timestamp de la última lectura de config
}
for k, v in DEFAULTS.items():
    if k not in st.session_state:
        st.session_state[k] = v

if "stop_audio_event" not in st.session_state:
    st.session_state.stop_audio_event = threading.Event()
if "audio_thread" not in st.session_state:
    st.session_state.audio_thread = None
if "command_thread" not in st.session_state:
    st.session_state.command_thread = None
if "teacher_warning" not in st.session_state:
    st.session_state.teacher_warning = None
if "force_logout" not in st.session_state:
    st.session_state.force_logout = False

# ── Utilidades ────────────────────────────────────────────────────────────────
import urllib.request
import json

def obtener_ip_publica():
    try:
        # Intento 1: Usando el motor nativo de Python (Confiable para Firewalls)
        req = urllib.request.Request('https://api.ipify.org?format=json', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=4) as response:
            datos = json.loads(response.read().decode())
            return datos.get('ip', 'Desconocida')
    except Exception:
        try:
            # Intento 2: Respaldo en texto plano
            req = urllib.request.Request('https://ifconfig.me/ip', headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=4) as response:
                return response.read().decode('utf8').strip()
        except Exception:
            # Si todo falla, extraemos la IP local de la máquina como último recurso
            import socket
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                ip_local = s.getsockname()[0]
                s.close()
                return f"{ip_local} (Local)"
            except:
                return "Bloqueado por Firewall"

def _q_put(q: queue.Queue, item):
    """Put sin bloquear: descarta el ítem viejo si la queue está llena."""
    try:
        q.put_nowait(item)
    except queue.Full:
        try:
            q.get_nowait()
        except queue.Empty:
            pass
        try:
            q.put_nowait(item)
        except queue.Full:
            pass


def log_alert(level: str, gaze_txt: str, hands_txt: str = ""):
    entry = {
        "timestamp": datetime.datetime.now().isoformat(),
        "level": level,
        "gaze": gaze_txt,
        "hands": hands_txt,
    }
    st.session_state.alert_log.insert(0, entry)
    st.session_state.alert_log = st.session_state.alert_log[:50]
    try:
        ALERTS_LOG.write_text(
            json.dumps(st.session_state.alert_log, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def ask_ollama(prompt: str):
    st.session_state.ollama_loading  = True
    st.session_state.ollama_response = "Analizando con IA..."
    def _run():
        try:
            r = ollama.chat(
                model=OLLAMA_MODEL,
                messages=[{"role": "user", "content": prompt}],
                options={"temperature": 0.3, "num_predict": 200},
            )
            st.session_state.ollama_response = r["message"]["content"]
        except Exception as e:
            st.session_state.ollama_response = f"Error Ollama: {e}"
        finally:
            st.session_state.ollama_loading = False
    threading.Thread(target=_run, daemon=True).start()


def start_audio_monitor(attempt_id: str):
    """
    Fase 1 Multimodal: Auditoría de Audio en ráfagas cortas (Background Thread).
    Utiliza recognize_google para offloading del procesamiento.
    Los 3 datos de identidad del alumno se capturan por closure al momento de
    iniciar el hilo, para evitar problemas de concurrencia con session_state.
    """
    if st.session_state.audio_thread and st.session_state.audio_thread.is_alive():
        print("⚠️ Hilo de audio ya corriendo. Omitiendo duplicado.")
        return

    st.session_state.stop_audio_event.clear()
    local_stop_event = st.session_state.stop_audio_event

    # Capturar identidad del alumno en variables locales (closure thread-safe)
    _nombre    = st.session_state.user_name
    _matricula = st.session_state.user_matricula
    _correo    = st.session_state.user_email
    _pin_sala  = st.session_state.get("exam_pin", "")  # ← PIN de la sala (multi-tenancy)

    def _audio_loop():
        r = sr.Recognizer()
        mic_source = None
        print("🎤 Hilo de audio iniciado...")
        try:
            mic_source = sr.Microphone()
            with mic_source as source:
                r.adjust_for_ambient_noise(source, duration=1)
                while not local_stop_event.is_set():
                    try:
                        # Escuchar ráfagas de máximo 5 segundos
                        audio = r.listen(source, phrase_time_limit=5)
                        
                        # Fase 1: Detección de volumen (RMS) para ruidos fuertes
                        audio_data = np.frombuffer(audio.get_raw_data(), dtype=np.int16)
                        rms = np.sqrt(np.mean(audio_data.astype(float)**2))
                        
                        # Fase 2: Reconocimiento de voz
                        text = ""
                        try:
                            text = r.recognize_google(audio, language="es-MX").strip()
                        except: pass

                        # Si hay texto o el volumen es excesivo (> 2500 es un grito/golpe fuerte)
                        if (text or rms > 2500) and supabase:
                            desc = text if text else f"Ruido fuerte detectado (Nivel: {int(rms)})"
                            print(f"📝 Evento Audio: {desc}")
                            
                            try:
                                ip_a_guardar = st.session_state.get("user_ip", "Desconocida")
                                if ip_a_guardar == "Desconocida":
                                    ip_a_guardar = obtener_ip_publica()

                                supabase.table("camera_logs").insert({
                                    "attempt_id":     attempt_id,
                                    "event_type":     "AUDIO_SOSPECHOSO",
                                    "description":    desc,
                                    "nombre_completo": _nombre,
                                    "matricula":      _matricula,
                                    "correo":         _correo,
                                    "ip_address":     ip_a_guardar,
                                    "pin_sala":       _pin_sala,
                                }).execute()
                            except Exception as e:
                                print(f"❌ Error en audio (Supabase): {e}")

                    except sr.UnknownValueError:
                        pass 
                    except sr.RequestError as e:
                        print(f"⚠️ Error de red en audio (Google API): {e}")
                    except Exception as e:
                        print(f"⚠️ Error recuperable en el bucle de audio: {e}")

                print("🛑 Hilo de audio detenido correctamente.")

        except Exception as e:
            print(f"💥 Error crítico en el hilo de audio: {e}")

        finally:
            # Garantizar liberación del micrófono aunque el hilo explote
            try:
                if mic_source is not None:
                    mic_source.__exit__(None, None, None)
            except Exception:
                pass
            print("🎤 Recursos del micrófono liberados.")

    t = threading.Thread(target=_audio_loop, daemon=True)
    st.session_state.audio_thread = t
    t.start()


def start_command_listener():
    """
    Escucha la tabla 'commands' en Supabase para recibir órdenes del docente
    (Advertencias, Expulsión, etc.) en tiempo real.
    """
    if st.session_state.command_thread and st.session_state.command_thread.is_alive():
        return

    _matricula = st.session_state.user_matricula
    if not _matricula: return

    def _command_loop():
        print(f"📡 Oyente de comandos activado para: {_matricula}")
        last_check_id = 0
        
        # Primero obtenemos el ID más alto existente para solo escuchar lo nuevo
        try:
            res = supabase.table("commands").select("id").order("id", desc=True).limit(1).execute()
            if res.data:
                last_check_id = res.data[0]['id']
        except: pass

        while st.session_state.user_matricula:
            try:
                # Polling corto (Supabase Realtime Python client es inestable en algunos entornos, 
                # usamos polling de 3s para máxima compatibilidad)
                res = supabase.table("commands")\
                    .select("*")\
                    .eq("matricula", _matricula)\
                    .gt("id", last_check_id)\
                    .order("id", desc=True)\
                    .execute()

                if res.data:
                    for cmd_entry in res.data:
                        cmd = cmd_entry.get("command")
                        payload = cmd_entry.get("payload", {})
                        
                        if cmd == "EXPULSAR":
                            st.session_state.force_logout = True
                            print("🚨 ORDEN RECIBIDA: EXPULSAR")
                        elif cmd == "ALERTA":
                            st.session_state.teacher_warning = payload.get("message", "Llamada de atención del docente.")
                            print("⚠️ ADVERTENCIA RECIBIDA")
                        
                        if cmd_entry['id'] > last_check_id:
                            last_check_id = cmd_entry['id']
                
            except Exception as e:
                print(f"Error en oyente de comandos: {e}")
            
            time.sleep(3)

    t = threading.Thread(target=_command_loop, daemon=True)
    st.session_state.command_thread = t
    t.start()


def risk_color(s: float) -> str:
    return "#00e5a0" if s < .3 else ("#ffb347" if s < .65 else "#ff4560")


# ═══════════════════════ VideoProcessor WebRTC ════════════════════════════════

class CentinelaProcessor(VideoProcessorBase):
    """
    Procesador de video WebRTC para Centinela IA v3.0.

    Ejecuta en un hilo separado. Recibe av.VideoFrame del navegador,
    los analiza y devuelve el frame anotado.

    Fases internas (máquina de estados):
      'setup'    → MediaPipe valida posición 3 s estables → gaze_cal
      'gaze_cal' → espera flag gaze_cal_requested del hilo Streamlit → cal
      'cal'      → proceso_calibration_frame() × 100 automático → monitoring
      'monitoring' → analyze_frame() + draw_overlays() continuo
    """

    def __init__(self, proctor: ProctorVision, matricula: str = None, supabase_client = None):
        self.proctor = proctor
        self.matricula = matricula
        self.supabase = supabase_client
        self.last_snapshot_time = 0.0
        self._lock   = threading.Lock()

        # --- Estado de fase ---
        self._phase: str = "setup"

        # --- Setup: racha estable ---
        self._setup_ok_start: Optional[float] = None

        # --- Gaze cal: señal externa ---
        self.gaze_cal_requested: bool = False

        # --- Calibración perspectiva ---
        self._cal_started: bool = False

        # --- Monitoring ---
        self._baseline_done:   bool = False
        self._frame_count:     int  = 0
        self._last_annotated: Optional[np.ndarray] = None

        # --- Queues thread-safe (tamaño 1 = siempre el dato más reciente) ---
        self.phase_q  = queue.Queue(maxsize=1)  # str
        self.setup_q  = queue.Queue(maxsize=1)  # (SetupStatus, float progress)
        self.gaze_q   = queue.Queue(maxsize=1)  # dict offset
        self.cal_q    = queue.Queue(maxsize=1)  # (frames_done, ear, pitch, done)
        self.report_q = queue.Queue(maxsize=1)  # (SuspicionReport | None, int frame#)

    # ── Propiedades thread-safe ────────────────────────────────────────────────

    @property
    def current_phase(self) -> str:
        with self._lock:
            return self._phase

    def _set_phase(self, phase: str):
        with self._lock:
            self._phase = phase

    # ── Punto de entrada del procesador ───────────────────────────────────────

    def recv(self, frame: av.VideoFrame) -> av.VideoFrame:
        # Formato BGR nativo (Anti-Pitufo) para evitar corromper canales de color
        img = frame.to_ndarray(format="bgr24")
        self._frame_count += 1
        
        phase = self.current_phase
        _q_put(self.phase_q, phase)

        try:
            # OPT_EXTREMA: Procesar la IA solo 1 de cada 5 frames
            # O si acabamos de empezar y no tenemos imagen previa.
            if self._frame_count % 5 == 0 or self._last_annotated is None:
                if phase == "setup":
                    out = self._recv_setup(img)
                elif phase == "gaze_cal":
                    out = self._recv_gaze_cal(img)
                elif phase == "cal":
                    out = self._recv_calibration(img)
                else:
                    out = self._recv_monitoring(img)
                
                # Guardamos una copia para mostrarla en los frames que saltamos
                self._last_annotated = out.copy()
            else:
                # Usamos la última imagen procesada (con sus cajas y HUD) para ahorrar CPU/Latencia
                out = self._last_annotated.copy()

        except Exception as exc:
            # Nunca caemos el stream: devolvemos frame crudo con aviso
            out = img.copy()
            h, w = out.shape[:2]
            cv2.putText(out, f"ERR: {exc}", (10, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 1)

        # Convertir colores invertidos antes de mostrar en pantalla
        img_rgb = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
        return av.VideoFrame.from_ndarray(img_rgb, format='rgb24')

    # ── Fase 1: Validación de posición ────────────────────────────────────────

    def _recv_setup(self, img: np.ndarray) -> np.ndarray:
        try:
            status: SetupStatus = self.proctor.validate_setup(img)
        except Exception:
            status = SetupStatus(False, False, 0.0, "NO_FACE", False, False)

        if status.ready:
            if self._setup_ok_start is None:
                self._setup_ok_start = time.time()
            elapsed  = time.time() - self._setup_ok_start
            progress = min(elapsed / UNLOCK_SECS, 1.0)
            if elapsed >= UNLOCK_SECS:
                self._set_phase("gaze_cal")
                progress = 1.0
        else:
            self._setup_ok_start = None
            progress = 0.0

        _q_put(self.setup_q, (status, progress))

        try:
            return self.proctor.draw_setup_overlay(img, status, progress)
        except Exception:
            return img.copy()

    # ── Fase 2: Calibración de gaze ───────────────────────────────────────────

    def _recv_gaze_cal(self, img: np.ndarray) -> np.ndarray:
        if self.gaze_cal_requested:
            self.gaze_cal_requested = False
            try:
                off = self.proctor.calibrate_gaze_offset(img)
            except Exception:
                off = {"success": False, "yaw_offset": 0.0, "pitch_offset": 0.0}
            _q_put(self.gaze_q, off)
            self._set_phase("cal")

        # Instrucción sobre el frame mientras espera
        h, w = img.shape[:2]
        out  = img.copy()
        ov   = out.copy()
        cv2.rectangle(ov, (0, 0), (w, 72), (15, 15, 22), -1)
        cv2.addWeighted(ov, 0.75, out, 0.25, 0, out)
        cv2.putText(out, "Mira al CENTRO de tu pantalla",
                    (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.70, (61, 139, 255), 2)
        cv2.putText(out, "y presiona  'Calibrar Punto de Vista'  en el panel",
                    (12, 56), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (200, 200, 200), 1)
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), (61, 139, 255), 3)
        return out

    # ── Fase 3: Calibración de perspectiva ───────────────────────────────────

    def _recv_calibration(self, img: np.ndarray) -> np.ndarray:
        if not self._cal_started:
            self.proctor.start_calibration()
            self._cal_started = True

        try:
            done, progress, cur_ear, cur_pitch = self.proctor.process_calibration_frame(img)
        except Exception:
            done, progress, cur_ear, cur_pitch = False, 0.0, 0.0, 0.0

        frames_done = int(progress * CAL_FRAMES)
        _q_put(self.cal_q, (frames_done, cur_ear, cur_pitch, done))

        # Overlay sobre el frame
        h, w = img.shape[:2]
        out  = img.copy()

        # Barra de progreso inferior
        bar_px = int(w * min(progress, 1.0))
        cv2.rectangle(out, (0, h - 16), (w, h), (20, 20, 32), -1)
        cv2.rectangle(out, (0, h - 16), (bar_px, h), (61, 139, 255), -1)

        # HUD superior semitransparente
        ov = out.copy()
        cv2.rectangle(ov, (0, 0), (w, 68), (15, 15, 22), -1)
        cv2.addWeighted(ov, 0.70, out, 0.30, 0, out)
        cv2.putText(out, f"Calibrando perspectiva...  {frames_done} / {CAL_FRAMES}",
                    (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (61, 139, 255), 2)
        cv2.putText(out, f"EAR: {cur_ear:.3f}    Pitch: {cur_pitch:+.1f}°",
                    (10, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 229, 160), 1)
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), (61, 139, 255), 3)

        if done:
            self._set_phase("monitoring")

        return out

    # ── Fase 4: Monitoreo continuo ────────────────────────────────────────────

    def _recv_monitoring(self, img: np.ndarray) -> np.ndarray:
        if not self._baseline_done:
            try:
                self.proctor.calibrate_baseline(img)
            except Exception:
                pass
            self._baseline_done = True

        self._frame_count += 1
        
        # Subida de frames a Supabase (cada 2 segundos para monitoreo "En Vivo")
        curr_time = time.time()
        if curr_time - self.last_snapshot_time >= 2.0:
            self.last_snapshot_time = curr_time
            if self.supabase and self.matricula and self.matricula != "Desconocido":
                try:
                    # imencode para JPG
                    success, buffer = cv2.imencode(".jpg", img)
                    if success:
                        def _upload_snapshot(buf):
                            try:
                                # Verificación estricta del nombre del archivo a subir
                                upload_path = f"{self.matricula}.jpg"
                                self.supabase.storage.from_("snapshots").upload(
                                    upload_path,
                                    buf.tobytes(),
                                    file_options={"upsert": "true", "contentType": "image/jpeg"}
                                )
                            except Exception as e:
                                # Si falla el upload directo (archivo existe), usamos update
                                try:
                                    self.supabase.storage.from_("snapshots").update(
                                        f"{self.matricula}.jpg",
                                        buf.tobytes(),
                                        file_options={"upsert": "true", "contentType": "image/jpeg"}
                                    )
                                except:
                                    pass
                        threading.Thread(target=_upload_snapshot, args=(buffer,), daemon=True).start()
                except Exception:
                    pass

        report   = self.proctor.analyze_frame(img)
        annotated = self.proctor.draw_overlays(img, report)

        _q_put(self.report_q, (report, self._frame_count))

        return annotated


# ═══════════════════════════ SIDEBAR ══════════════════════════════════════════

# ═══════════════════════ BLOQUEO GATING (STATE MANAGEMENT) ══════════════════
if 'user_matricula' not in st.session_state:
    st.session_state.user_matricula = None

# --- SISTEMA DE ACCESO INTELIGENTE ---
st.markdown(
    "<h2 style='text-align:center;margin-bottom:1.5rem'>Centinela IA</h2>",
    unsafe_allow_html=True,
)

if not st.session_state.user_matricula:
    # Crear dos pestañas elegantes
    tab_login, tab_registro = st.tabs(["🔐 Iniciar Sesión", "📝 Crear Cuenta"])
    
    # --- PESTAÑA 1: LOGIN ---
    with tab_login:
        with st.form("login_form"):
            st.markdown("<p style='color: white;'>Ingresa tus credenciales para continuar.</p>", unsafe_allow_html=True)
            correo_login = st.text_input("Correo Electrónico", placeholder="usuario@utc.edu.mx")
            matricula_login = st.text_input("Matrícula", type="password")
            pin_login = st.text_input(
                "📍 PIN de la Sala",
                placeholder="Ej. 1234",
                max_chars=4,
                help="El docente te entregará este código de 4 dígitos.",
            )
            submit_login = st.form_submit_button("Entrar al Sistema", use_container_width=True)
            
            if submit_login:
                if not correo_login or not matricula_login or not pin_login:
                    st.error("⚠️ Llena todos los campos, incluyendo el PIN de la sala.")
                else:
                    # Validar PIN antes de tocar Supabase
                    salas_activas = fetch_exam_config()
                    if pin_login not in salas_activas:
                        st.error("❌ PIN inválido o sala no encontrada. Verifica el código con tu docente.")
                    else:
                        try:
                            # Buscar usuario en Supabase
                            respuesta = supabase.table("usuarios").select("*").eq("email", correo_login).eq("matricula", matricula_login).execute()
                            
                            if len(respuesta.data) > 0:
                                usuario = respuesta.data[0]
                                # Inicio de sesión exitoso
                                st.session_state.user_matricula = matricula_login
                                st.session_state.user_name = usuario['nombre']
                                st.session_state.user_rol = usuario['rol']
                                st.session_state.user_email = correo_login
                                st.session_state.user_ip = obtener_ip_publica()
                                st.session_state.mode = "idle"
                                # Guardar PIN y URL de la sala
                                st.session_state.exam_pin = pin_login
                                st.session_state.url_examen = salas_activas[pin_login]
                                
                                if usuario['rol'] == "Alumno":
                                    try:
                                        attempt_res = supabase.table("exam_attempts").insert({"status": "en_progreso"}).execute()
                                        if attempt_res.data:
                                            attempt_id_db = attempt_res.data[0].get("id")
                                            st.session_state.attempt_id = attempt_id_db
                                    except Exception:
                                        pass

                                st.success(f"¡Bienvenido de nuevo, {usuario['nombre']}! Sala: {pin_login}")
                                start_command_listener() # Activar oyente de comandos
                                time.sleep(1)
                                st.rerun()
                            else:
                                st.error("❌ Cuenta no encontrada. Por favor, ve a la pestaña de 'Crear Cuenta'.")
                        except Exception as e:
                            st.error(f"Error de conexión: {e}")

    # --- PESTAÑA 2: REGISTRO ---
    with tab_registro:
        with st.form("register_form"):
            st.markdown("<p style='color: white;'>Regístrate como Alumno o Docente.</p>", unsafe_allow_html=True)
            nombre_reg = st.text_input("Nombre Completo *", placeholder="Ej. Sergio Alejandro")
            matricula_reg = st.text_input("Matrícula *", placeholder="Ej. 13234214")
            correo_reg = st.text_input("Correo Institucional *", placeholder="@utc.edu.mx o @Doc.com")
            submit_reg = st.form_submit_button("Registrarse", use_container_width=True)
            
            if submit_reg:
                if not nombre_reg or not matricula_reg or not correo_reg:
                    st.error("⚠️ Todos los campos son obligatorios.")
                elif "utc" not in correo_reg and "Doc" not in correo_reg and "doc" not in correo_reg.lower():
                    st.error("⛔ Acceso denegado: Usa un correo institucional válido.")
                else:
                    try:
                        rol_asignado = "Docente" if "doc" in correo_reg.lower() else "Alumno"
                        ip_actual = obtener_ip_publica()
                        
                        # Insertar nuevo usuario en Supabase
                        supabase.table("usuarios").insert({
                            "email": correo_reg,
                            "nombre": nombre_reg,
                            "matricula": matricula_reg,
                            "rol": rol_asignado,
                            "ip_registro": ip_actual
                        }).execute()
                        
                        # Auto-login después de registro exitoso
                        st.session_state.user_matricula = matricula_reg
                        st.session_state.user_name = nombre_reg
                        st.session_state.user_rol = rol_asignado
                        st.session_state.user_ip = ip_actual
                        st.session_state.user_email = correo_reg
                        st.session_state.mode = "idle"
                        
                        if rol_asignado == "Alumno":
                            try:
                                attempt_res = supabase.table("exam_attempts").insert({"status": "en_progreso"}).execute()
                                if attempt_res.data:
                                    attempt_id_db = attempt_res.data[0].get("id")
                                    st.session_state.attempt_id = attempt_id_db
                            except Exception:
                                pass

                        st.success("✅ ¡Registro exitoso! Iniciando sesión...")
                        start_command_listener() # Activar oyente de comandos
                        time.sleep(1.5)
                        st.rerun()
                        
                    except Exception as e:
                        if 'duplicate key' in str(e) or '23505' in str(e) or 'duplicate' in str(e).lower() or 'already exists' in str(e).lower():
                            st.warning("⚠️ Este correo ya está registrado. Ve a la pestaña de 'Iniciar Sesión'.")
                        else:
                            st.error(f"Error de base de datos: {e}")

else:
    # --- ENRUTADOR POST-LOGIN ---
    if st.session_state.get('user_rol') == "Docente":
        # ... (código existente del docente)
        st.markdown("""
            <div style='text-align:center; padding: 50px; background: rgba(255,255,255,0.05); border-radius:20px; border: 1px solid rgba(255,255,255,0.1); margin-top: 50px;'>
                <h3 style='color: #00b09b;'>✅ Identidad de Docente Confirmada</h3>
                <p style='color: white;'>Abriendo el Centro de Mando en una nueva pestaña...</p>
            </div>
        """, unsafe_allow_html=True)
        st.markdown('<meta http-equiv="refresh" content="2; url=http://localhost:8502">', unsafe_allow_html=True)
        st.stop()

    # --- GESTIÓN DE COMANDOS DEL DOCENTE (UI) ---
    if st.session_state.force_logout:
        st.markdown("""
            <div style='position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:white; font-family:sans-serif;'>
                <h1 style='color:#ef4444; font-size:4rem;'>🚫 EXAMEN FINALIZADO</h1>
                <p style='font-size:1.5rem; max-width:600px;'>Tu sesión ha sido terminada por el docente supervisor debido a irregularidades detectadas.</p>
                <div style='margin-top:30px; padding:20px; border:1px solid rgba(255,255,255,0.2); border-radius:20px;'>
                    Consulte con su institución para más detalles.
                </div>
            </div>
        """, unsafe_allow_html=True)
        time.sleep(5)
        st.session_state.user_matricula = None
        st.rerun()
        st.stop()

    if st.session_state.teacher_warning:
        st.warning(f"⚠️ MENSAJE DEL DOCENTE: {st.session_state.teacher_warning}")
        if st.button("He leído la advertencia"):
            st.session_state.teacher_warning = None
            st.rerun()

    with st.sidebar:
        # ── Logo + toggle de tema ────────────────────────────────────────────
        col_logo, col_toggle = st.columns([3, 1])
        with col_logo:
            st.markdown(
                "<div style='font-weight:600;font-size:1rem;padding-top:6px'>Centinela IA</div>"
                "<div style='font-size:0.75rem;color:#737373;margin-top:2px'>v3.0 · WebRTC</div>",
                unsafe_allow_html=True,
            )
        with col_toggle:
            icon = "☀️" if st.session_state.theme == "dark" else "🌙"
            if st.button(icon, key="theme_toggle_main", help="Cambiar tema"):
                st.session_state.theme = "light" if st.session_state.theme == "dark" else "dark"
                st.rerun()
        st.markdown(
            "<hr style='border:none;border-top:1px solid rgba(128,128,128,0.15);margin:12px 0'>",
            unsafe_allow_html=True,
        )

        mode = st.session_state.mode

        if mode == "idle":
            st.markdown("### ⚙️ Configuracion")
            if st.session_state.user_name:
                st.markdown(f"<div style='color:#00e5a0;font-size:0.85rem;margin-bottom:10px'>👤 {st.session_state.user_name}</div>", unsafe_allow_html=True)
            dt = st.radio(
                "Tipo de dispositivo",
                ["laptop", "tablet"],
                format_func=lambda x: "💻 Laptop/PC" if x == "laptop" else "📱 Tablet",
                index=0 if st.session_state.device_type == "laptop" else 1,
            )
            st.session_state.device_type = dt
            st.markdown("---")
            if st.button("🚀 Iniciar Sesión", type="primary", use_container_width=True):
                p = ProctorVision()
                p.set_device_mode(st.session_state.device_type)
                st.session_state.proctor       = p
                st.session_state.mode          = "active"
                st.session_state.session_start = time.time()
                # Reset cached UI state
                st.session_state.ui_phase        = "setup"
                st.session_state.ui_report       = None
                st.session_state.ui_frame_count  = 0
                st.session_state.ui_cal_progress = 0.0
                st.session_state.ui_warning      = False
                st.session_state.ollama_response = ""
                st.rerun()

        elif mode == "active":
            if st.button("⏹ Detener Sesión", type="secondary", use_container_width=True):
                if supabase:
                    try:
                        # Persistencia Agresiva: Si la IP se perdió de la sesión, la volvemos a buscar
                        if 'user_ip' not in st.session_state or st.session_state.user_ip == 'Desconocida':
                            st.session_state.user_ip = obtener_ip_publica()
                            
                        ip_a_guardar = st.session_state.user_ip
                        
                        supabase.table("camera_logs").insert({
                            "nombre_completo": st.session_state.user_name,
                            "matricula":       st.session_state.user_matricula,
                            "event_type":      "desconexion",
                            "description":     "El alumno finalizó el examen",
                            "ip_address":      ip_a_guardar,
                            "pin_sala":        st.session_state.get("exam_pin", ""),
                        }).execute()
                    except Exception:
                        pass
                
                if "stop_audio_event" in st.session_state and st.session_state.stop_audio_event:
                    st.session_state.stop_audio_event.set()
                if st.session_state.proctor:
                    try:
                        st.session_state.proctor.release()
                    except Exception:
                        pass
                    st.session_state.proctor = None
                st.session_state.mode = "idle"
                st.rerun()

            st.markdown("---")
            st.markdown("### 📊 Sesión")
            if st.session_state.session_start:
                elapsed = time.time() - st.session_state.session_start
                mm, ss = divmod(int(elapsed), 60)
                hh, mm2 = divmod(mm, 60)
                na = sum(1 for a in st.session_state.alert_log if a["level"] != "NORMAL")
                c1, c2 = st.columns(2)
                c1.markdown(
                    f"<div style='font-family:JetBrains Mono;font-size:1.2rem'>{hh:02d}:{mm2:02d}:{ss:02d}</div>"
                    f"<div style='font-size:.7rem;color:#7c8398'>TIEMPO</div>",
                    unsafe_allow_html=True,
                )
                c2.markdown(
                    f"<div style='font-family:JetBrains Mono;font-size:1.2rem;color:#ff4560'>{na}</div>"
                    f"<div style='font-size:.7rem;color:#7c8398'>ALERTAS</div>",
                    unsafe_allow_html=True,
                )

            st.markdown("---")
            st.markdown("### 🔔 Eventos")
            for ev in st.session_state.alert_log[:8]:
                st.markdown(
                    f"<div class='alert-entry alert-{ev['level']}'>"
                    f"<strong>{ev['timestamp'][11:19]}</strong> — {ev['level']}<br>"
                    f"<span style='color:#7c8398;font-size:.76rem'>{ev.get('gaze','')[:45]}</span>"
                    f"</div>",
                    unsafe_allow_html=True,
                )

            st.markdown("---")
            if st.button("📥 Exportar Log", use_container_width=True):
                st.download_button(
                    "⬇️ Descargar JSON",
                    data=json.dumps(st.session_state.alert_log, ensure_ascii=False, indent=2),
                    file_name=f"centinela_{datetime.date.today()}.json",
                    mime="application/json",
                    use_container_width=True,
                )


    # ═══════════════════════ MAIN CONTENT ═════════════════════════════════════════
    mode = st.session_state.mode

    # ──────────────────────────── LOGIN ───────────────────────────────────────────
    if mode == "idle":
        st.markdown("# 🛡️ Centinela IA")
        st.markdown("<hr style='margin-top:-8px'>", unsafe_allow_html=True)
        st.markdown(f"""
        <div style='text-align:center;padding:48px 20px'>
          <div style='font-size:5rem'>🛡️</div>
          <h2 style='margin-bottom:10px; color: white;'>Sistema Listo</h2>
          <p style='color: #e2e8f0; text-align: center; font-size: 1.1rem; margin-bottom: 2rem;'>
            Selecciona el tipo de dispositivo y presiona <strong>Iniciar Sesión</strong>.
            El sistema iniciará automáticamente la validación de posición vía
            <strong>WebRTC</strong> — compatible con Ngrok y redes universitarias.
          </p>
        </div>""", unsafe_allow_html=True)

        for col, (icon, name, desc) in zip(
            st.columns(4, gap="medium"),
            [("🎥", "WebRTC",      "Stream continuo desde el navegador"),
             ("🤖", "gemma2:2b",   "IA local via Ollama"),
             ("🧠", "YOLOv8 + MP", "Detección multi-modelo"),
             ("🌐", "Ngrok",       "Acceso remoto compatible")],
        ):
            col.markdown(
                f"<div class='card' style='text-align:center; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 20px;'>"
                f"<div style='font-size:2.5rem; margin-bottom: 10px;'>{icon}</div>"
                f"<p style='color: #ffffff; text-align: center; font-weight: bold; margin-bottom: 0px;'>{name}</p>"
                f"<p style='color: #a0aec0; text-align: center; font-size: 0.85rem;'>{desc}</p></div>",
                unsafe_allow_html=True,
            )

    # ─────────────────────────── ACTIVE ───────────────────────────────────────────
    elif mode == "active":
        st.markdown("# 🛡️ Centinela IA — Modo Enfoque")
        st.markdown("<hr style='margin-top:-8px'>", unsafe_allow_html=True)

        proctor: ProctorVision = st.session_state.proctor
        # Nueva distribución: 30% Panel de Seguridad | 70% Panel del Examen
        col_izq, col_der = st.columns([3, 7])

        # ── WebRTC Streamer ────────────────────────────────────────────────────────
        current_matricula = st.session_state.user_matricula
        
        def make_processor():
            return CentinelaProcessor(proctor, matricula=current_matricula, supabase_client=supabase)

        # ── Columna Izquierda: Panel de Seguridad ─────────────────────────────────
        with col_izq:
            st.caption("🎥 Stream WebRTC — Centinela Activo")
            ctx = webrtc_streamer(
                key="centinela-video",
                mode=WebRtcMode.SENDRECV,
                rtc_configuration={
                    "iceServers": [
                        {
                            "urls": [
                                "stun:stun.l.google.com:19302",
                                "stun:stun1.l.google.com:19302",
                                "stun:global.stun.twilio.com:3478"
                            ]
                        },
                        {
                            "urls": [
                                "turn:centinela-snow.metered.live:443?transport=tcp",
                                "turn:centinela-snow.metered.live:80?transport=tcp",
                                "turn:centinela-snow.metered.live:443"
                            ],
                            "username": "66bbc46a3696d6303c690f92",
                            "credential": "kEnXs7P0LZCA7aEO"
                        },
                        {
                            "urls": [
                                "turn:openrelay.metered.ca:443?transport=tcp",
                                "turn:openrelay.metered.ca:80?transport=tcp",
                                "turn:openrelay.metered.ca:443"
                            ],
                            "username": "openrelayproject",
                            "credential": "openrelayproject"
                        }
                    ]
                },
                video_processor_factory=make_processor,
                media_stream_constraints={
                    "video": {"width": 640, "height": 480},
                    "audio": False
                },
                async_processing=True,
                video_receiver_size=1,
                sendback_audio=False
            )

        # ── Panel de métricas (sólo cuando el stream está activo) ──────────────────
        is_playing = ctx.state.playing if ctx.state else False

        # --- CANDADO DE PRIVACIDAD MULTIMODAL ---
        if is_playing:
            if not st.session_state.get('audio_thread') or not st.session_state.audio_thread.is_alive():
                attempt_id = st.session_state.get("attempt_id", "sin_id")
                start_audio_monitor(attempt_id)
        else:
            if st.session_state.get('audio_thread') and st.session_state.audio_thread.is_alive():
                st.session_state.stop_audio_event.set()

        if is_playing and ctx.video_processor:
            vp: CentinelaProcessor = ctx.video_processor

            # Leer fase actual (no-bloqueante)
            try:
                phase = vp.phase_q.get_nowait()
                st.session_state.ui_phase = phase
            except queue.Empty:
                phase = st.session_state.ui_phase

            # ── Autorefresh de UI (activo en todas las fases) ──────────────────────
            if HAS_AUTOREFRESH:
                st_autorefresh(interval=1500, key="centinela_autorefresh")

            # ════════════════ FASE: SETUP ══════════════════════════════════════════
            if phase == "setup":
                try:
                    status, progress = vp.setup_q.get_nowait()
                except queue.Empty:
                    status, progress = None, 0.0

                # ── Indicadores en columna izquierda (debajo de la cámara) ──────────
                with col_izq:
                    st.markdown("""
                    <div class='card' style='border-color:#3d8bff;margin-top:10px'>
                      <div style='color:#3d8bff;font-size:1rem;font-weight:700;margin-bottom:10px'>
                        📐 Paso 1 / 3 — Validación de Posición</div>
                      <div style='color:#7c8398;font-size:.82rem'>
                        Siéntate frente a la cámara, mira al lente y
                        mantente a 50-80 cm. El sistema esperará 3 s estable.
                      </div>
                    </div>""", unsafe_allow_html=True)

                    if status:
                        checks_html = ""
                        for label, ok in status.checklist:
                            icon  = "✅" if ok else "⬜"
                            color = "#00e5a0" if ok else "#7c8398"
                            checks_html += (
                                f"<div class='check-row'><span>{icon}</span>"
                                f"<span style='color:{color}'>{label}</span></div>"
                            )
                        dc = ("#00e5a0" if status.distance_ok
                              else ("#ff4560" if status.distance_status == "TOO_CLOSE" else "#7c8398"))
                        st.markdown(
                            f"<div class='card'>{checks_html}"
                            f"<div style='color:{dc};font-size:.88rem;margin-top:8px'>"
                            f"{status.distance_msg}</div></div>",
                            unsafe_allow_html=True,
                        )
                        if progress > 0:
                            st.progress(
                                progress,
                                text=f"Mantente quieto… {progress * UNLOCK_SECS:.1f}s / {UNLOCK_SECS:.0f}s",
                            )
                    else:
                        st.info("Esperando primer frame del stream…")

            # ════════════════ FASE: GAZE CAL ═══════════════════════════════════════
            elif phase == "gaze_cal":
                with col_izq:
                    st.markdown("""
                    <div class='card' style='border-color:#3d8bff;margin-top:10px'>
                      <div style='color:#3d8bff;font-size:1rem;font-weight:700;margin-bottom:10px'>
                        📌 Paso 2 / 3 — Calibrar Punto de Vista</div>
                      <div style='color:#e8ecf4;font-size:.85rem;line-height:1.65'>
                        Mira <strong>directamente al centro de tu pantalla</strong>
                        (donde verás el examen) y presiona el botón.<br><br>
                        <span style='color:#7c8398;font-size:.78rem'>
                          Esto le dice al sistema cuál es tu «neutral» cuando
                          la cámara está en ángulo elevado.
                        </span>
                      </div>
                    </div>""", unsafe_allow_html=True)

                    if st.button("📐 Calibrar Punto de Vista", type="primary",
                                 use_container_width=True, key="btn_gaze_cal"):
                        vp.gaze_cal_requested = True

                    # Mostrar resultado cuando llegue
                    try:
                        off = vp.gaze_q.get_nowait()
                        st.success(
                            f"✓ Calibrado — Yaw: {off.get('yaw_offset', 0):+.1f}°  "
                            f"Pitch: {off.get('pitch_offset', 0):+.1f}°"
                        )
                    except queue.Empty:
                        pass

            # ════════════════ FASE: CALIBRACIÓN ════════════════════════════════════
            elif phase == "cal":
                try:
                    frames_done, cur_ear, cur_pitch, cal_done = vp.cal_q.get_nowait()
                    st.session_state.ui_cal_progress = frames_done / CAL_FRAMES
                except queue.Empty:
                    frames_done = int(st.session_state.ui_cal_progress * CAL_FRAMES)
                    cur_ear = cur_pitch = 0.0

                with col_izq:
                    st.markdown("""
                    <div class='card' style='border-color:#3d8bff;margin-top:10px'>
                      <div style='color:#3d8bff;font-size:1rem;font-weight:700;margin-bottom:8px'>
                        🔬 Paso 3 / 3 — Calibración de Perspectiva</div>
                      <div style='color:#7c8398;font-size:.83rem'>
                        Quédate quieto mirando la pantalla. La calibración es automática.
                      </div>
                    </div>""", unsafe_allow_html=True)

                    st.progress(
                        st.session_state.ui_cal_progress,
                        text=f"Frames calibrados: {frames_done} / {CAL_FRAMES}",
                    )
                    st.markdown(
                        f"<div style='font-family:JetBrains Mono;font-size:.82rem;color:#7c8398;"
                        f"background:#0d0f14;padding:8px 12px;border-radius:6px;margin-top:8px'>"
                        f"👁 EAR: <span style='color:#00e5a0'>{cur_ear:.3f}</span>"
                        f"&nbsp;&nbsp;📌 Pitch: <span style='color:#3d8bff'>{cur_pitch:+.1f}°</span>"
                        f"</div>",
                        unsafe_allow_html=True,
                    )

            # ════════════════ FASE: MONITOREO ══════════════════════════════════════
            else:
                # Leer último report del procesador
                try:
                    report, frame_count = vp.report_q.get_nowait()
                    st.session_state.ui_report      = report
                    st.session_state.ui_frame_count = frame_count
                except queue.Empty:
                    report      = st.session_state.ui_report
                    frame_count = st.session_state.ui_frame_count

                # ── Supabase YOLO insert logic (Anti-Spam) ──
                if report and (report.objects.cell_phone_detected or report.objects.book_detected):
                    now = time.time()
                    if now - st.session_state.last_object_log_time >= 8.0:
                        desc = "Celular detectado" if report.objects.cell_phone_detected else "Libro detectado"
                        if supabase:
                            try:
                                # Persistencia Agresiva: Si la IP se perdió de la sesión, la volvemos a buscar
                                if 'user_ip' not in st.session_state or st.session_state.user_ip == 'Desconocida':
                                    st.session_state.user_ip = obtener_ip_publica()
                                    
                                ip_a_guardar = st.session_state.user_ip

                                supabase.table("camera_logs").insert({
                                    "attempt_id":      st.session_state.attempt_id,
                                    "event_type":      "objeto_prohibido",
                                    "description":     desc,
                                    "nombre_completo": st.session_state.user_name,
                                    "matricula":       st.session_state.user_matricula,
                                    "correo":          st.session_state.user_email,
                                    "ip_address":      ip_a_guardar,
                                    "pin_sala":        st.session_state.get("exam_pin", ""),
                                }).execute()
                                print(f"🚫 LOG Supabase: {desc}")
                            except Exception as e:
                                print(f"❌ Error insertando log de objeto: {e}")
                        st.session_state.last_object_log_time = now

                # ── Indicadores de estado de IA y contador de infracciones (col_izq) ──
                with col_izq:
                    warning_active = False
                    if report and report.level in (SuspicionLevel.ALERTA, SuspicionLevel.CRITICO) \
                            and report.confidence > 0.40:
                        warning_active = True

                    # Label de frame en vivo
                    st.markdown(
                        f"<span style='color:#7c8398;font-size:.8rem'>"
                        f"🎯 Frame <strong>#{frame_count}</strong> &nbsp;·&nbsp; "
                        f"<span style='color:#00ff88'>●</span> EN VIVO"
                        f"</span>",
                        unsafe_allow_html=True,
                    )

                    # ── Indicador de Estado de la IA ───────────────────────────────
                    if report:
                        lvl_color = ("#00e5a0" if report.level.name == "NORMAL"
                                     else ("#ffb347" if report.level.name == "ALERTA" else "#ff4560"))
                        st.markdown(
                            f"<div style='background:rgba(0,0,0,0.3);border:1px solid {lvl_color};"
                            f"border-radius:10px;padding:8px 12px;margin-top:6px'>"
                            f"<span style='color:{lvl_color};font-weight:700;font-size:.9rem'>"
                            f"● {report.level.name}</span>"
                            f"<span style='color:#7c8398;font-size:.78rem;margin-left:10px'>"
                            f"Confianza: {int(report.confidence*100)}%</span></div>",
                            unsafe_allow_html=True,
                        )

                    # ── Contador de Infracciones ───────────────────────────────────
                    na = sum(1 for a in st.session_state.alert_log if a["level"] != "NORMAL")
                    inf_color = "#ff4560" if na > 0 else "#00e5a0"
                    st.markdown(
                        f"<div style='background:rgba(0,0,0,0.3);border:1px solid {inf_color};"
                        f"border-radius:10px;padding:8px 12px;margin-top:6px;text-align:center'>"
                        f"<div style='font-size:.7rem;color:#7c8398;margin-bottom:2px'>INFRACCIONES</div>"
                        f"<div style='font-size:1.6rem;font-weight:700;color:{inf_color}'>{na}</div>"
                        f"</div>",
                        unsafe_allow_html=True,
                    )

                    # ── Motor de Reglas: Alertas de Infracción ──────────────────────
                    if report and report.active_violations:
                        for violation in report.active_violations:
                            st.error(f"**{violation}**")
                    elif warning_active:
                        st.warning("⚠️ Mantén posición estable.")

                # ── Columna Derecha: Panel del Examen — bloqueado si cámara apagada ──
                with col_der:
                    st.markdown("#### 📝 Panel del Examen")

                    # Re-validar URL por PIN cada 30 s
                    import time as _time
                    if _time.time() - st.session_state.exam_config_ts > 30:
                        pin_actual = st.session_state.get("exam_pin", "")
                        salas = fetch_exam_config()
                        if pin_actual and pin_actual in salas:
                            st.session_state.url_examen = salas[pin_actual]
                        st.session_state.exam_config_ts = _time.time()

                    url_docente = st.session_state.get("url_examen", "")

                    # 🔒 GATING: el examen sólo se muestra si la cámara está activa
                    if is_playing:
                        if url_docente and url_docente.startswith("http"):
                            st.components.v1.iframe(url_docente, height=800, scrolling=True)
                        else:
                            st.info(
                                "🕒 Esperando a que el profesor asigne el examen...\n\n"
                                "El examen aparecerá aquí automáticamente en cuanto "
                                "el docente lo publique desde su Panel de Control."
                            )
                    else:
                        # Placeholder de bloqueo premium
                        st.markdown(
                            """
                            <div style='
                                background: rgba(5, 5, 15, 0.55);
                                backdrop-filter: blur(28px);
                                -webkit-backdrop-filter: blur(28px);
                                border: 1.5px solid rgba(239, 68, 68, 0.35);
                                border-radius: 24px;
                                height: 780px;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                text-align: center;
                                gap: 0;
                                box-shadow: 0 0 60px rgba(239,68,68,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
                            '>
                                <div style='
                                    font-size: 6rem;
                                    line-height: 1;
                                    margin-bottom: 28px;
                                    filter: drop-shadow(0 0 24px rgba(239,68,68,0.6));
                                    animation: pulse-lock 2.2s ease-in-out infinite;
                                '>🔒</div>
                                <div style='
                                    font-size: 2rem;
                                    font-weight: 800;
                                    letter-spacing: 0.12em;
                                    background: linear-gradient(135deg, #ef4444, #f87171);
                                    -webkit-background-clip: text;
                                    -webkit-text-fill-color: transparent;
                                    margin-bottom: 20px;
                                    text-transform: uppercase;
                                '>EXAMEN BLOQUEADO</div>
                                <div style='
                                    font-size: 0.95rem;
                                    color: #94a3b8;
                                    max-width: 420px;
                                    line-height: 1.75;
                                    font-weight: 400;
                                '>
                                    Por favor, enciende tu cámara en el panel izquierdo
                                    (botón <strong style='color:#e2e8f0'>START</strong>) y
                                    permite el acceso para <strong style='color:#e2e8f0'>desbloquear tu examen</strong>.
                                </div>
                                <div style='
                                    margin-top: 36px;
                                    padding: 10px 24px;
                                    background: rgba(239,68,68,0.1);
                                    border: 1px solid rgba(239,68,68,0.3);
                                    border-radius: 50px;
                                    font-size: 0.8rem;
                                    color: #f87171;
                                    letter-spacing: 0.08em;
                                    text-transform: uppercase;
                                    font-weight: 600;
                                '>⚠ Cámara requerida para continuar</div>
                            </div>
                            <style>
                            @keyframes pulse-lock {
                                0%, 100% { transform: scale(1);   filter: drop-shadow(0 0 18px rgba(239,68,68,0.5)); }
                                50%       { transform: scale(1.08); filter: drop-shadow(0 0 36px rgba(239,68,68,0.9)); }
                            }
                            </style>
                            """,
                            unsafe_allow_html=True,
                        )

                    # ── Procesar alertas Ollama en segundo plano ────────────────────
                    if report:
                        lvl = report.level.name
                        g   = report.gaze
                        gt  = (f"👁 {g.gaze_direction}  Yaw:{g.yaw_angle:+.1f}°  Pitch:{g.pitch_angle:+.1f}°"
                               if g.landmarks_detected else "👁 Cara no detectada")

                        if (report.needs_ai_review
                                and not st.session_state.ollama_loading
                                and (time.time() - st.session_state.last_ollama_ts) > OLLAMA_COOLDOWN):
                            st.session_state.last_ollama_ts = time.time()
                            log_alert(lvl, gt)
                            ask_ollama(report.reasoning_text)

                            # ── Insert comportamiento en Supabase (gaze / ausencia cara) ──
                            if supabase and lvl in ("ALERTA", "CRITICO"):
                                try:
                                    ip_c = st.session_state.get("user_ip", "Desconocida")
                                    supabase.table("camera_logs").insert({
                                        "attempt_id":      st.session_state.attempt_id,
                                        "event_type":      "alerta_comportamiento",
                                        "description":     f"[{lvl}] {gt}",
                                        "nombre_completo": st.session_state.user_name,
                                        "matricula":       st.session_state.user_matricula,
                                        "correo":          st.session_state.user_email,
                                        "ip_address":      ip_c,
                                        "pin_sala":        st.session_state.get("exam_pin", ""),
                                    }).execute()
                                    print(f"👁 LOG Supabase comportamiento: {lvl} — {gt}")
                                except Exception as _e:
                                    print(f"❌ Error insertando alerta comportamiento: {_e}")

        elif not is_playing:
            with col_der:
                st.markdown("#### 📝 Panel del Examen")

                # 🔒 Cámara apagada — bloqueo del examen siempre activo
                st.markdown(
                    """
                    <div style='
                        background: rgba(5, 5, 15, 0.55);
                        backdrop-filter: blur(28px);
                        -webkit-backdrop-filter: blur(28px);
                        border: 1.5px solid rgba(239, 68, 68, 0.35);
                        border-radius: 24px;
                        height: 780px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                        gap: 0;
                        box-shadow: 0 0 60px rgba(239,68,68,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
                    '>
                        <div style='
                            font-size: 6rem;
                            line-height: 1;
                            margin-bottom: 28px;
                            filter: drop-shadow(0 0 24px rgba(239,68,68,0.6));
                            animation: pulse-lock 2.2s ease-in-out infinite;
                        '>🔒</div>
                        <div style='
                            font-size: 2rem;
                            font-weight: 800;
                            letter-spacing: 0.12em;
                            background: linear-gradient(135deg, #ef4444, #f87171);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            margin-bottom: 20px;
                            text-transform: uppercase;
                        '>EXAMEN BLOQUEADO</div>
                        <div style='
                            font-size: 0.95rem;
                            color: #94a3b8;
                            max-width: 420px;
                            line-height: 1.75;
                            font-weight: 400;
                        '>
                            Por favor, enciende tu cámara en el panel izquierdo
                            (botón <strong style='color:#e2e8f0'>START</strong>) y
                            permite el acceso para <strong style='color:#e2e8f0'>desbloquear tu examen</strong>.
                        </div>
                        <div style='
                            margin-top: 36px;
                            padding: 10px 24px;
                            background: rgba(239,68,68,0.1);
                            border: 1px solid rgba(239,68,68,0.3);
                            border-radius: 50px;
                            font-size: 0.8rem;
                            color: #f87171;
                            letter-spacing: 0.08em;
                            text-transform: uppercase;
                            font-weight: 600;
                        '>⚠ Cámara requerida para continuar</div>
                    </div>
                    <style>
                    @keyframes pulse-lock {
                        0%, 100% { transform: scale(1);   filter: drop-shadow(0 0 18px rgba(239,68,68,0.5)); }
                        50%       { transform: scale(1.08); filter: drop-shadow(0 0 36px rgba(239,68,68,0.9)); }
                    }
                    </style>
                    """,
                    unsafe_allow_html=True,
                )
