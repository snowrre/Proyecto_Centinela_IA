import os
import json
import random
import datetime
import pandas as pd
import streamlit as st
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client
import time
from streamlit_autorefresh import st_autorefresh

try:
    from fpdf import FPDF
    HAS_FPDF = True
except ImportError:
    HAS_FPDF = False

# ── Configuración de página ───────────────────────────────────────────────────
st.set_page_config(
    page_title="Centinela IA — Panel Docente",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Tema y Estado ──────────────────────────────────────────────────────────────
if "theme_dash" not in st.session_state:
    st.session_state.theme_dash = "dark"
if "df_logs" not in st.session_state:
    st.session_state.df_logs = pd.DataFrame()
    st.session_state.load_msg = "Cargando datos..."
    st.session_state.last_load = None

# ── Carga inicial de salas desde disco (anti-amnesia tras recargas) ─────────
# Se ejecuta en cada ciclo de Streamlit para que las salas del JSON siempre
# estén disponibles sin depender de ninguna acción del docente.
_EXAM_CONFIG_FILE_EARLY = Path("exam_config.json")
if "salas_cargadas" not in st.session_state:
    try:
        if _EXAM_CONFIG_FILE_EARLY.exists():
            _data = json.loads(_EXAM_CONFIG_FILE_EARLY.read_text(encoding="utf-8"))
            # Ignorar formato antiguo
            if "url_examen" not in _data:
                st.session_state.salas_cache = _data
            else:
                st.session_state.salas_cache = {}
        else:
            st.session_state.salas_cache = {}
    except Exception:
        st.session_state.salas_cache = {}
    st.session_state.salas_cargadas = True

# ── CSS Ultra-Premium Minimalist con soporte claro/oscuro ───────────────────────────────────
# ── CSS Premium Neo-Glass con soporte claro/oscuro ───────────────────────────────────
def _build_dash_css(dark: bool = True) -> str:
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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

#MainMenu,footer,header,.stDeployButton,[data-testid="stToolbar"]{{visibility:hidden!important;display:none!important;}}
html,body,[class*="css"]{{font-family:'Inter',-apple-system,sans-serif!important;-webkit-font-smoothing:antialiased;}}

.stApp{{
    background-color: {bg_color} !important;
    background-image: 
        radial-gradient(circle at 0% 0%, {grad1}, transparent 50%),
        radial-gradient(circle at 100% 100%, {grad2}, transparent 50%),
        radial-gradient(circle at 50% 50%, {grad3}, transparent 50%) !important;
    background-attachment: fixed !important;
    color: {txt} !important;
}}

.block-container{{padding:1.5rem 2.5rem!important;max-width:100%!important;}}
section[data-testid="stSidebar"]{{
    background:{glass_bg}!important;
    backdrop-filter: blur(24px)!important;
    border-right:1px solid {glass_border}!important;
}}

h1,h2,h3,h4,h5,h6{{color:{txt}!important;font-weight:700!important;letter-spacing:-0.02em!important;}}
.stMarkdown p,[data-testid="stMarkdownContainer"] p{{color:{txt}!important;}}

/* Inputs & Widgets */
.stTextInput>div>div>input,.stSelectbox>div>div>div,.stMultiSelect>div>div>div{{
    background:rgba(0,0,0,0.2)!important;
    backdrop-filter:blur(10px)!important;
    color:{txt}!important;
    border:1px solid {glass_border}!important;
    border-radius:12px!important;
    padding:12px 16px!important;
    box-shadow:inset 0 1px 2px rgba(0,0,0,0.1)!important;
    transition:all 0.3s ease!important;
}}
.stTextInput>div>div>input:focus{{border-color:#3b82f6!important;box-shadow:0 0 0 3px rgba(59,130,246,0.2)!important;}}
[data-testid="stWidgetLabel"] p,label{{color:{txt}!important;font-weight:500!important;}}

/* Buttons */
.stButton>button{{background:{primary_grad}!important;color:#fff!important;border:none!important;border-radius:12px!important;font-weight:600!important;padding:12px 20px!important;box-shadow:0 4px 14px rgba(59,130,246,0.3)!important;transition:all 0.3s ease!important;}}
.stButton>button:hover{{transform:translateY(-2px)!important;box-shadow:0 6px 20px rgba(59,130,246,0.5)!important;}}
[data-testid="baseButton-secondary"]{{background:{glass_bg}!important;backdrop-filter:blur(10px)!important;color:{txt}!important;border:1px solid {glass_border}!important;box-shadow:none!important;}}
[data-testid="baseButton-secondary"]:hover{{background:rgba(255,255,255,0.1)!important;transform:translateY(-2px)!important;}}

/* Tabs */
div[data-baseweb="tab-list"]{{
    background:{glass_bg}!important;
    backdrop-filter:blur(12px)!important;
    border-radius:30px!important;
    padding:6px!important;
    border:1px solid {glass_border}!important;
    gap:8px!important;
    margin-bottom:24px!important;
}}
button[data-baseweb="tab"]{{
    background:transparent!important;
    border:none!important;
    color:{txt_muted}!important;
    padding:10px 24px!important;
    border-radius:24px!important;
    font-weight:500!important;
    transition:all 0.3s ease!important;
}}
button[data-baseweb="tab"][aria-selected="true"]{{
    background:{primary_grad}!important;
    color:white!important;
    box-shadow:0 4px 14px rgba(59,130,246,0.3)!important;
    font-weight:600!important;
}}
div[data-baseweb="tab-border"],div[data-baseweb="tab-highlight"]{{display:none!important;}}

/* DataFrame */
[data-testid="stDataFrame"]{{
    background:{glass_bg}!important;
    backdrop-filter:blur(16px)!important;
    border-radius:16px;
    overflow:hidden;
    border:1px solid {glass_border}!important;
    box-shadow:{glass_shadow}!important;
}}

/* Alerts */
[data-testid="stAlert"] {{ border-radius: 12px !important; border: 1px solid {glass_border} !important; backdrop-filter: blur(10px) !important; background: {glass_bg} !important; box-shadow: {glass_shadow} !important; }}

/* KPI cards Premium Vision Pro style */
.kpi-card{{
    background:{glass_bg};
    backdrop-filter:blur(24px);
    -webkit-backdrop-filter:blur(24px);
    border:1px solid {glass_border};
    border-radius:20px;
    padding:28px;
    text-align:center;
    box-shadow:{glass_shadow};
    transition:transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), border-color 0.3s ease;
    position: relative;
    overflow: hidden;
}}
.kpi-card::before {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
}}
.kpi-card:hover{{transform:translateY(-6px);border-color:rgba(59,130,246,0.4);}}
.kpi-value{{
    font-size:3.2rem;
    font-weight:800;
    line-height:1;
    display:block;
    margin-bottom:12px;
    text-shadow:0 0 30px rgba(255,255,255,0.1);
}}
.kpi-label{{font-size:0.8rem;color:{txt_muted};letter-spacing:.1em;text-transform:uppercase;font-weight:600;}}

/* Custom KPI Colors */
.kpi-total .kpi-value{{background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}}
.kpi-vision .kpi-value{{background:linear-gradient(135deg,#fbbf24,#f87171);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}}
.kpi-audio .kpi-value{{background:linear-gradient(135deg,#34d399,#10b981);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}}
.kpi-other .kpi-value{{background:linear-gradient(135deg,#94a3b8,#64748b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}}

/* Scrollbar Elegante */
::-webkit-scrollbar {{ width: 6px; height: 6px; }}
::-webkit-scrollbar-track {{ background: transparent; }}
::-webkit-scrollbar-thumb {{ background: rgba(59, 130, 246, 0.4); border-radius: 10px; }}
::-webkit-scrollbar-thumb:hover {{ background: rgba(59, 130, 246, 0.7); }}

/* Utils */
.section-title {{ font-size: 0.9rem; font-weight: 700; color: {txt_muted}; letter-spacing: 0.1em; text-transform: uppercase; margin: 36px 0 20px 0; display: flex; align-items: center; gap: 12px; }}
.section-title::after {{ content: ""; flex-grow: 1; height: 1px; background: {glass_border}; }}
</style>"""

st.markdown(_build_dash_css(st.session_state.theme_dash == "dark"), unsafe_allow_html=True)

# ── Supabase Init ──────────────────────────────────────────────────────────────
load_dotenv()
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

@st.cache_resource(show_spinner=False)
def get_supabase_client() -> Client | None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception:
        return None

supabase: Client | None = get_supabase_client()

# ── Funciones ───────────────────────────────────────────────────────────────
def fetch_camera_logs(pines: list[str] | None = None) -> tuple[pd.DataFrame, str]:
    """
    Trae registros de camera_logs SOLO de las salas activas de este docente.

    Param pines: Lista de PINs a filtrar (obligatorio para aislamiento multi-tenant).
                 Si está vacía o es None, retorna DataFrame vacío sin tocar Supabase.
    """
    if supabase is None:
        return pd.DataFrame(), "❌ Cliente Supabase no disponible. Verifica el archivo .env."

    # ── Guardia de multi-tenancy: si no hay PINs activos, no traer nada ──
    pines_activos = [p for p in (pines or []) if p]  # filtrar cadenas vacías
    if not pines_activos:
        return pd.DataFrame(), "📢 No hay salas activas. Crea una sala en la pestaña de Configuración."

    try:
        res = (
            supabase
            .table("camera_logs")
            .select("id, created_at, attempt_id, event_type, description, nombre_completo, matricula, correo, ip_address, pin_sala")
            .in_("pin_sala", pines_activos)   # ← FILTRO CLAVE: solo datos de las salas de este docente
            .order("created_at", desc=True)
            .execute()
        )
        rows = res.data if res.data else []
        if not rows:
            return pd.DataFrame(), f"ℹ️ Sin eventos para las salas: {', '.join(pines_activos)}"

        df = pd.DataFrame(rows)
        if "created_at" in df.columns:
            df["created_at"] = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
            df["created_at"] = df["created_at"].dt.tz_convert("America/Mexico_City")
            df.rename(columns={"created_at": "Fecha / Hora (CST)"}, inplace=True)

        rename_map = {
            "id": "ID", "attempt_id": "ID Intento", "event_type": "Tipo de Evento",
            "description": "Descripción (Transcripción / Objeto)", "nombre_completo": "Alumno",
            "matricula": "Matrícula", "correo": "Correo", "ip_address": "Ubicación de Red",
            "pin_sala": "PIN Sala",
        }
        df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns}, inplace=True)
        
        priority = ["Fecha / Hora (CST)", "Alumno", "Matrícula", "Correo", "Ubicación de Red", "Tipo de Evento", "Descripción (Transcripción / Objeto)", "ID Intento", "ID"]
        existing = [c for c in priority if c in df.columns]
        rest = [c for c in df.columns if c not in existing]
        df = df[existing + rest]
        
        return df, f"✅ {len(df)} registro(s) cargados correctamente."
    except Exception as exc:
        return pd.DataFrame(), f"❌ Error al consultar Supabase: {exc}"

EXAM_CONFIG_FILE = Path("exam_config.json")

def read_exam_config() -> dict:
    """
    Lee el directorio de salas: {PIN: URL}.
    Si el archivo tiene el formato antiguo {url_examen: ...} lo migra automáticamente.
    """
    try:
        if EXAM_CONFIG_FILE.exists():
            data = json.loads(EXAM_CONFIG_FILE.read_text(encoding="utf-8"))
            # Migración automática del formato antiguo
            if "url_examen" in data:
                return {}
            return data
    except Exception:
        pass
    return {}

def write_exam_config(salas: dict) -> str:
    """Guarda el diccionario completo {PIN: URL} en exam_config.json."""
    try:
        EXAM_CONFIG_FILE.write_text(
            json.dumps(salas, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return "✅ Sala guardada."
    except Exception as exc:
        return f"❌ Error al guardar: {exc}"

def crear_sala(url: str) -> tuple[str, str]:
    """
    Genera un PIN único de 4 dígitos, añade la sala al directorio y
    devuelve (PIN, mensaje).
    """
    salas = read_exam_config()
    # Evitar colisiones de PIN
    intentos = 0
    while intentos < 20:
        pin = str(random.randint(1000, 9999))
        if pin not in salas:
            break
        intentos += 1
    salas[pin] = url.strip()
    msg = write_exam_config(salas)
    return pin, msg

def eliminar_sala(pin: str) -> str:
    """Elimina una sala del directorio por su PIN."""
    salas = read_exam_config()
    if pin in salas:
        del salas[pin]
        return write_exam_config(salas)
    return "⚠️ PIN no encontrado."

def export_to_pdf(df: pd.DataFrame) -> bytes:
    if not HAS_FPDF or df.empty:
        return b""
    pdf = FPDF(orientation='L', unit='mm', format='A4')
    pdf.add_page()
    pdf.set_font("Arial", size=9)
    # Definir columnas a exportar
    cols = [c for c in ["Fecha / Hora (CST)", "Alumno", "Matrícula", "Tipo de Evento", "Descripción (Transcripción / Objeto)"] if c in df.columns]
    col_widths = [45, 60, 25, 40, 100]
    
    for i, col in enumerate(cols):
        pdf.cell(col_widths[i], 8, txt=str(col), border=1)
    pdf.ln()
    for _, row in df.iterrows():
        for i, col in enumerate(cols):
            val = str(row[col])[:45]
            if col == "Fecha / Hora (CST)":
                val = str(row[col]).split('.')[0]
            pdf.cell(col_widths[i], 8, txt=val, border=1)
        pdf.ln()
    return pdf.output(dest='S').encode('latin-1', errors='replace')


# ── SIDEBAR MINIMALISTA ───────────────────────────────────────────────────────────────────
with st.sidebar:
    col_logo, col_toggle = st.columns([3, 1])
    with col_logo:
        st.markdown(
            "<div style='font-weight:600;font-size:1rem;padding-top:6px'>Centinela IA</div>"
            "<div style='font-size:0.75rem;color:#737373;margin-top:2px'>Panel Docente v3.0</div>",
            unsafe_allow_html=True,
        )
    with col_toggle:
        icon = "☀️" if st.session_state.theme_dash == "dark" else "🌙"
        if st.button(icon, key="theme_toggle_dash", help="Cambiar tema"):
            st.session_state.theme_dash = "light" if st.session_state.theme_dash == "dark" else "dark"
            st.rerun()
    
    st.markdown("<hr style='border:none;border-top:1px solid rgba(128,128,128,0.15);margin:12px 0'>", unsafe_allow_html=True)
    st.markdown("**Control de Datos**")
    
    if st.button("🔄 Actualizar Registros", type="primary", use_container_width=True):
        with st.spinner("Consultando Supabase..."):
            _pines_manual = list(read_exam_config().keys())
            df, msg = fetch_camera_logs(pines=_pines_manual)
        st.session_state.df_logs   = df
        st.session_state.load_msg  = msg
        st.session_state.last_load = datetime.datetime.now().strftime("%H:%M:%S")

    if st.session_state.last_load:
        st.caption(f"🕒 Última carga: **{st.session_state.last_load}**")

    st.markdown("<hr style='border:none;border-top:1px solid rgba(128,128,128,0.15);margin:12px 0'>", unsafe_allow_html=True)
    st.markdown("**Filtros**")
    
    df_current = st.session_state.df_logs
    tipo_col   = "Tipo de Evento"

    available_types: list[str] = []
    if not df_current.empty and tipo_col in df_current.columns:
        available_types = sorted(df_current[tipo_col].dropna().unique().tolist())

    sidebar_filter = st.multiselect(
        "Tipo de Evento",
        options=available_types,
        default=available_types,
        key="sidebar_type_filter",
        placeholder="Selecciona tipos...",
    )

    st.markdown("<hr style='border:none;border-top:1px solid rgba(128,128,128,0.15);margin:12px 0'>", unsafe_allow_html=True)
    st.caption("📖 objeto_prohibido · 🎤 audio_sospechoso · 💬 otros")

# ── HEADER + KPIs MINIMALISTAS ───────────────────────────────────────────────────────────────
df_hero   = st.session_state.df_logs
_tc       = "Tipo de Evento"
n_total   = len(df_hero)
n_vision  = len(df_hero[df_hero[_tc]=="objeto_prohibido"]) if not df_hero.empty and _tc in df_hero.columns else 0
n_audio   = len(df_hero[df_hero[_tc]=="audio_sospechoso"]) if not df_hero.empty and _tc in df_hero.columns else 0
n_other   = n_total - n_vision - n_audio

st.markdown("## Panel Docente")
st.markdown("<p style='color:#737373;margin-top:-12px;margin-bottom:20px'>Centinela IA · Centro de Supervisión</p>", unsafe_allow_html=True)

k1, k2, k3, k4 = st.columns(4, gap="medium")
with k1: st.markdown(f"<div class='kpi-card kpi-total'><span class='kpi-value'>{n_total}</span><span class='kpi-label'>Total Eventos</span></div>", unsafe_allow_html=True)
with k2: st.markdown(f"<div class='kpi-card kpi-vision'><span class='kpi-value'>{n_vision}</span><span class='kpi-label'>Alertas Visión</span></div>", unsafe_allow_html=True)
with k3: st.markdown(f"<div class='kpi-card kpi-audio'><span class='kpi-value'>{n_audio}</span><span class='kpi-label'>Alertas Audio</span></div>", unsafe_allow_html=True)
with k4: st.markdown(f"<div class='kpi-card kpi-other'><span class='kpi-value'>{n_other}</span><span class='kpi-label'>Otros Eventos</span></div>", unsafe_allow_html=True)

st.markdown("<div style='margin-top:24px'></div>", unsafe_allow_html=True)

_msg = st.session_state.load_msg
if "✅" in _msg:
    st.caption(f"✅ {_msg}")
elif "❌" in _msg:
    st.error(_msg)

# ── DataFrame de trabajo ──────────────────────────────────────────────────────────
df = st.session_state.df_logs

# ──────────────────────────── PESTAÑAS (TABS) ──────────────────────────────────────────
tab_config, tab_auditoria, tab_monitoreo = st.tabs([
    "⚙️ Configuración del Examen",
    "📊 Tabla de Auditoría",
    "🎥 Monitoreo en Vivo",
])

# ═════════════ TAB: CONFIGURACIÓN DEL EXAMEN (Multi-Sala) ════════════════════
with tab_config:
    # Inicializar el PIN recién creado en session_state
    if "ultimo_pin_creado" not in st.session_state:
        st.session_state.ultimo_pin_creado = None

    # ── Sección: Crear Sala ───────────────────────────────────────────────────
    st.markdown("<div class='section-title'>🏫 Crear Sala de Examen</div>", unsafe_allow_html=True)

    with st.form("form_crear_sala"):
        url_nueva = st.text_input(
            "URL del Examen",
            placeholder="Ej: https://docs.google.com/forms/d/e/...",
            key="teacher_url_input",
        )
        crear_btn = st.form_submit_button(
            "🚀 Crear Sala de Examen", type="primary", use_container_width=True
        )

    if crear_btn:
        if not url_nueva or not url_nueva.strip().startswith("http"):
            st.error("⚠️ Ingresa una URL válida que comience con http/https.")
        else:
            pin_generado, msg_sala = crear_sala(url_nueva)
            st.session_state.ultimo_pin_creado = pin_generado
            st.success(msg_sala)
            st.rerun()

    # ── Mostrar PIN generado en grande ────────────────────────────────────────
    if st.session_state.ultimo_pin_creado:
        pin_show = st.session_state.ultimo_pin_creado
        st.markdown(
            f"""
            <div style='
                background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15));
                border: 2px solid rgba(139,92,246,0.5);
                border-radius: 24px;
                padding: 40px 20px;
                text-align: center;
                margin: 24px 0;
            '>
                <div style='font-size:0.85rem;color:#94a3b8;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:8px'>PIN de tu Sala</div>
                <div style='font-size:5rem;font-weight:800;letter-spacing:0.3em;
                    background:linear-gradient(135deg,#60a5fa,#a78bfa);
                    -webkit-background-clip:text;-webkit-text-fill-color:transparent;
                    line-height:1.1;'>
                    {pin_show}
                </div>
                <div style='font-size:0.9rem;color:#94a3b8;margin-top:16px'>
                    Comparte este PIN con tus alumnos para que accedan al examen.
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        if st.button("❌ Cerrar aviso de PIN", use_container_width=False, key="btn_close_pin"):
            st.session_state.ultimo_pin_creado = None
            st.rerun()

    # ── Sección: Salas Activas ────────────────────────────────────────────────
    st.markdown("<div class='section-title'>📋 Salas Activas</div>", unsafe_allow_html=True)
    salas_activas = read_exam_config()

    if not salas_activas:
        st.info("📢 No hay salas activas. Crea una arriba.")
    else:
        for pin_k, url_v in list(salas_activas.items()):
            col_pin, col_url, col_del = st.columns([1, 5, 1], gap="small")
            with col_pin:
                st.markdown(
                    f"<div style='font-size:1.4rem;font-weight:800;color:#a78bfa;padding-top:8px;text-align:center'>{pin_k}</div>",
                    unsafe_allow_html=True,
                )
            with col_url:
                st.markdown(
                    f"<div style='font-size:0.85rem;color:#94a3b8;word-break:break-all;padding-top:12px'>{url_v[:80]}{'...' if len(url_v)>80 else ''}</div>",
                    unsafe_allow_html=True,
                )
            with col_del:
                if st.button("🗑️", key=f"del_sala_{pin_k}", help=f"Eliminar sala {pin_k}"):
                    eliminar_sala(pin_k)
                    st.rerun()

    # ── Sección: Últimas Infracciones ─────────────────────────────────────────
    st.markdown("<div class='section-title'>Últimas Infracciones en Vivo</div>", unsafe_allow_html=True)
    if df.empty:
        st.info("📡 Carga los registros desde el panel lateral para ver las infracciones.")
    else:
        df_violations = df[df[_tc].isin(["objeto_prohibido", "audio_sospechoso"])].head(15) if _tc in df.columns else df.head(15)
        if df_violations.empty:
            st.success("✅ Sin infracciones recientes registradas.")
        else:
            cols_show = [c for c in ["Fecha / Hora (CST)", "Alumno", "Matrícula", "Tipo de Evento", "Descripción (Transcripción / Objeto)"] if c in df_violations.columns]
            st.dataframe(df_violations[cols_show] if cols_show else df_violations, use_container_width=True, hide_index=True, height=320)

# ═════════════ TAB: MONITOREO EN VIVO ════════════════════════════════
with tab_monitoreo:
    st.markdown("<div class='section-title'>Vista en Vivo Ligera</div>", unsafe_allow_html=True)
    # ── Auto-refresh cada 2 s + re-fetch filtrado por PINs activos ──────────
    _mon_tick = st_autorefresh(interval=2000, limit=None, key="cctv_refresh")

    # Leer PINs activos del docente desde disco (siempre fresco)
    _pines_mon = list(read_exam_config().keys())

    # Actualizar datos de alumnos filtrados por sala
    _df_mon, _ = fetch_camera_logs(pines=_pines_mon)
    if not _df_mon.empty:
        st.session_state.df_logs = _df_mon
    df = st.session_state.df_logs  # Usar dato fresco

    unique_students = []
    if "Matrícula" in df.columns and "Alumno" in df.columns:
        df_students = df[["Matrícula", "Alumno"]].drop_duplicates().dropna()
        for _, row in df_students.iterrows():
            unique_students.append((row['Matrícula'], row['Alumno']))

    if not unique_students:
        st.info("📡 Esperando que los alumnos se conecten...")
    else:
        for matricula, alumno in unique_students:
            df_alum = df[df["Matrícula"] == matricula]
            if "Fecha / Hora (CST)" in df_alum.columns:
                df_alum = df_alum.sort_values(by="Fecha / Hora (CST)", ascending=False)

            ultimo_evento = df_alum.iloc[0]["Tipo de Evento"] if not df_alum.empty and "Tipo de Evento" in df_alum.columns else ""
            is_disconnected = (ultimo_evento == "desconexion")

            titulo_expander = f"🔴 {alumno} (Desconectado)" if is_disconnected else f"🟢 {alumno} (En vivo)"

            with st.expander(titulo_expander):
                if is_disconnected:
                    st.warning("El alumno ha finalizado el examen o se ha desconectado de la sesión.")
                else:
                    if supabase:
                        try:
                            url_res = supabase.storage.from_("snapshots").get_public_url(f"{matricula}.jpg")
                            img_url = f"{url_res}?t={time.time()}" if isinstance(url_res, str) else f"{url_res.get('publicURL', '')}?t={time.time()}"
                            st.image(img_url, width=450, caption=f"Matrícula: {matricula}")
                        except Exception:
                            st.warning("La cámara de este alumno aún no ha sincronizado o no está disponible.")

# ═════════════ TAB: AUDITORÍA (Tiempo Real) ════════════════════════
with tab_auditoria:
    # ── Auto-refresh + auto-fetch filtrado por PINs activos cada 3 s ──
    _audit_tick = st_autorefresh(interval=3000, limit=None, key="audit_autorefresh")

    # Leer PINs activos del docente (siempre desde disco, nunca cacheados)
    _pines_audit = list(read_exam_config().keys())

    # Fetch filtrado por salas de este docente
    _df_fresh, _msg_fresh = fetch_camera_logs(pines=_pines_audit)
    if not _df_fresh.empty or _audit_tick == 0:
        st.session_state.df_logs  = _df_fresh
        st.session_state.load_msg = _msg_fresh
        st.session_state.last_load = datetime.datetime.now().strftime("%H:%M:%S")

    # Reasignar df local al dato más fresco
    df = st.session_state.df_logs

    # Indicador de latido
    _ts = st.session_state.last_load or "--"
    st.caption(f"🟢 Auto-actualización activa · Última lectura: **{_ts}** · Salas: {', '.join(_pines_audit) or 'ninguna'} · Ciclo #{_audit_tick}")

    if df.empty:
        st.info("⏳ Sin registros aún. Esperando actividad de los alumnos...")
    else:
        st.markdown("<div class='section-title'>Filtros Interactivos</div>", unsafe_allow_html=True)
        filter_col1, filter_col2 = st.columns([2, 3], gap="medium")
        with filter_col1:
            all_types = ["(Todos)"] + (sorted(df[_tc].dropna().unique().tolist()) if _tc in df.columns else [])
            selected_type = st.selectbox("Filtrar por Tipo de Evento", options=all_types, index=0, key="main_type_filter")
        with filter_col2:
            avail_types = sorted(df[_tc].dropna().unique().tolist()) if _tc in df.columns else []
            multi_types = st.multiselect("Filtro múltiple", options=avail_types, default=avail_types, key="main_multi_filter")

        df_filtered = df.copy()
        if _tc in df_filtered.columns:
            if selected_type != "(Todos)": df_filtered = df_filtered[df_filtered[_tc] == selected_type]
            if multi_types: df_filtered = df_filtered[df_filtered[_tc].isin(multi_types)]
            else: df_filtered = df_filtered.iloc[0:0]
        if sidebar_filter and _tc in df_filtered.columns:
            df_filtered = df_filtered[df_filtered[_tc].isin(sidebar_filter)]

        st.markdown("<div class='section-title'>Tabla de Auditoría</div>", unsafe_allow_html=True)
        if df_filtered.empty:
            st.warning("No hay registros que coincidan con los filtros seleccionados.")
        else:
            st.caption(f"Mostrando {len(df_filtered)} de {len(df)} registros.")
            st.dataframe(df_filtered, use_container_width=True, hide_index=True, height=520)

            if HAS_FPDF:
                pdf_bytes = export_to_pdf(df_filtered)
                st.download_button(
                    label="⬇️ Descargar Reporte PDF", data=pdf_bytes,
                    file_name=f"Reporte_Centinela_{datetime.date.today()}.pdf",
                    mime="application/pdf"
                )

        if not df_filtered.empty and _tc in df_filtered.columns:
            st.markdown("<div class='section-title'>Distribución por Tipo</div>", unsafe_allow_html=True)
            chart_data = df_filtered[_tc].value_counts().reset_index()
            chart_data.columns = ["Tipo de Evento", "Cantidad"]
            st.bar_chart(chart_data.set_index("Tipo de Evento"), use_container_width=True, height=260)

# ── CONTROL: ZONA ROJA ────────────────────────────────────────────────────────
st.markdown("<br><br>", unsafe_allow_html=True)
st.markdown("<div class='section-title' style='color:#ef4444'>Zona de Peligro</div>", unsafe_allow_html=True)

if st.button("🔴 Finalizar Examen y Limpiar Base de Datos", use_container_width=True):
    st.session_state.confirm_delete = True

if st.session_state.get("confirm_delete", False):
    st.warning("⚠️ ¿Estás completamente seguro de borrar todos los registros? Acción irreversible.")
    col_del1, col_del2 = st.columns(2)
    with col_del1:
        if st.button("✔️ Confirmar Borrado", type="primary", use_container_width=True):
            if supabase:
                try:
                    supabase.table("camera_logs").delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()
                    st.session_state.df_logs = pd.DataFrame()
                    st.session_state.load_msg = "✅ Sistema Reiniciado con Éxito"
                    st.session_state.confirm_delete = False
                    st.rerun()
                except Exception as e:
                    st.error(f"Error borrando datos: {e}")
    with col_del2:
        if st.button("❌ Cancelar", use_container_width=True):
            st.session_state.confirm_delete = False
            st.rerun()
