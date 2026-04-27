"""
Inserta sidebar + header KPIs en teacher_dashboard.py
"""
import re

with open("teacher_dashboard.py", encoding="utf-8") as f:
    content = f.read()

# Encontrar donde termina el bloque CSS
css_marker = "_build_dash_css(st.session_state.theme_dash"
idx = content.find(css_marker)
# Avanzar hasta el final de esa linea
eol = content.find("\n", idx)
insert_after = eol + 1  # justo despues del newline

# Encontrar el marcador del dataframe de trabajo
df_marker = "df = st.session_state.df_logs"
idx_df = content.find(df_marker)

print(f"insert_after={insert_after}, idx_df={idx_df}")
print("After CSS:", repr(content[insert_after:insert_after+60]))
print("DF marker:", repr(content[idx_df:idx_df+60]))

NEW_BLOCK = '''
# Estado de sesion
if "df_logs" not in st.session_state:
    st.session_state.df_logs   = __import__("pandas").DataFrame()
    st.session_state.load_msg  = "Haz clic en Actualizar Registros para cargar los datos."
    st.session_state.last_load = None

# SIDEBAR
with st.sidebar:
    col_logo, col_toggle = st.columns([3, 1])
    with col_logo:
        st.markdown(
            "<div style=\\'font-weight:600;font-size:1rem;padding-top:6px\\'>Centinela IA</div>"
            "<div style=\\'font-size:0.75rem;color:#737373;margin-top:2px\\'>Panel Docente v3.0</div>",
            unsafe_allow_html=True,
        )
    with col_toggle:
        icon = "Sol" if st.session_state.theme_dash == "dark" else "Luna"
        if st.button(icon, key="theme_toggle_dash", help="Cambiar tema"):
            st.session_state.theme_dash = "light" if st.session_state.theme_dash == "dark" else "dark"
            st.rerun()
    st.markdown("---")
    st.markdown("**Control de Datos**")
    if st.button("Actualizar Registros", type="primary", use_container_width=True):
        with st.spinner("Consultando Supabase..."):
            df_tmp, msg_tmp = fetch_camera_logs()
        st.session_state.df_logs   = df_tmp
        st.session_state.load_msg  = msg_tmp
        st.session_state.last_load = __import__("datetime").datetime.now().strftime("%H:%M:%S")
    if st.session_state.last_load:
        st.caption(f"Ultima carga: {st.session_state.last_load}")
    st.markdown("---")
    st.markdown("**Filtros**")
    df_current = st.session_state.df_logs
    tipo_col   = "Tipo de Evento"
    available_types = []
    if not df_current.empty and tipo_col in df_current.columns:
        available_types = sorted(df_current[tipo_col].dropna().unique().tolist())
    sidebar_filter = st.multiselect(
        "Tipo de Evento",
        options=available_types,
        default=available_types,
        key="sidebar_type_filter",
        placeholder="Selecciona tipos...",
    )
    st.caption("objeto_prohibido / audio_sospechoso / otros")

# HEADER + KPIs
df_hero  = st.session_state.df_logs
_tc      = "Tipo de Evento"
n_total  = len(df_hero)
n_vision = len(df_hero[df_hero[_tc]=="objeto_prohibido"]) if not df_hero.empty and _tc in df_hero.columns else 0
n_audio  = len(df_hero[df_hero[_tc]=="audio_sospechoso"]) if not df_hero.empty and _tc in df_hero.columns else 0
n_other  = n_total - n_vision - n_audio

st.markdown("## Panel Docente")
st.markdown("<p style=\\'color:#737373;margin-top:-12px;margin-bottom:20px\\'>Centinela IA Centro de Supervision</p>", unsafe_allow_html=True)
k1, k2, k3, k4 = st.columns(4, gap="medium")
with k1:
    st.markdown(f"<div class=\\'kpi-card kpi-total\\'><span class=\\'kpi-value\\'>{n_total}</span><span class=\\'kpi-label\\'>Total Eventos</span></div>", unsafe_allow_html=True)
with k2:
    st.markdown(f"<div class=\\'kpi-card kpi-vision\\'><span class=\\'kpi-value\\'>{n_vision}</span><span class=\\'kpi-label\\'>Alertas Vision</span></div>", unsafe_allow_html=True)
with k3:
    st.markdown(f"<div class=\\'kpi-card kpi-audio\\'><span class=\\'kpi-value\\'>{n_audio}</span><span class=\\'kpi-label\\'>Alertas Audio</span></div>", unsafe_allow_html=True)
with k4:
    st.markdown(f"<div class=\\'kpi-card kpi-other\\'><span class=\\'kpi-value\\'>{n_other}</span><span class=\\'kpi-label\\'>Otros Eventos</span></div>", unsafe_allow_html=True)
st.markdown("<div style=\\'margin-top:24px\\'></div>", unsafe_allow_html=True)
_msg = st.session_state.load_msg
if "OK" in _msg or "correcto" in _msg or "registro" in _msg:
    st.caption(_msg)
elif "Error" in _msg or "no disponible" in _msg:
    st.error(_msg)

'''

print("Writing new file...")
new_content = content[:insert_after] + NEW_BLOCK + "\n" + content[idx_df:]
with open("teacher_dashboard.py", "w", encoding="utf-8", errors="replace") as f:
    f.write(new_content)
print(f"Done. Lines: {new_content.count(chr(10))}")
