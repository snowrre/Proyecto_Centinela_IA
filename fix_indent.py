import os

lines = open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/teacher_dashboard.py", encoding='utf8').readlines()

new_lines = []
in_tab_section = False

for i, line in enumerate(lines):
    if line.startswith("# ──────────────────────────── KPIs ────────────────────────────────────────────"):
        in_tab_section = True
        
        # Insert Tabs logic
        new_lines.append("# ──────────────────────────── PESTAÑAS (TABS) ───────────────────────────────\n")
        new_lines.append("tab_auditoria, tab_monitoreo = st.tabs([\"📊 Tabla de Auditoría\", \"🎥 Monitoreo en Vivo\"])\n\n")
        new_lines.append("import time\n")
        new_lines.append("with tab_monitoreo:\n")
        new_lines.append("    st.markdown(\"<div class='section-title'>🎥 Vista en Vivo Ligera</div>\", unsafe_allow_html=True)\n")
        new_lines.append("    \n")
        new_lines.append("    unique_students = []\n")
        new_lines.append("    if \"Matrícula\" in df.columns and \"Alumno\" in df.columns:\n")
        new_lines.append("        df_students = df[[\"Matrícula\", \"Alumno\"]].drop_duplicates().dropna()\n")
        new_lines.append("        for _, row in df_students.iterrows():\n")
        new_lines.append("            unique_students.append(f\"{row['Matrícula']} - {row['Alumno']}\")\n")
        new_lines.append("            \n")
        new_lines.append("    if not unique_students:\n")
        new_lines.append("        st.info(\"No se encontraron alumnos registrados para monitorear.\")\n")
        new_lines.append("    else:\n")
        new_lines.append("        selected_student = st.selectbox(\"Selecciona un Alumno a Monitorear\", options=unique_students)\n")
        new_lines.append("        matricula_sel = selected_student.split(\" - \")[0].strip()\n")
        new_lines.append("        \n")
        new_lines.append("        if st.button(\"🔄 Actualizar Cámara\", type=\"primary\", use_container_width=True):\n")
        new_lines.append("            st.session_state[f\"cam_{matricula_sel}\"] = time.time()\n")
        new_lines.append("            \n")
        new_lines.append("        timestamp_cache = st.session_state.get(f\"cam_{matricula_sel}\", 0)\n")
        new_lines.append("        \n")
        new_lines.append("        if supabase:\n")
        new_lines.append("            try:\n")
        new_lines.append("                url_res = supabase.storage.from_(\"snapshots\").get_public_url(f\"{matricula_sel}.jpg\")\n")
        new_lines.append("                img_url = f\"{url_res}?t={timestamp_cache}\" if isinstance(url_res, str) else f\"{url_res.get('publicURL', '')}?t={timestamp_cache}\"\n")
        new_lines.append("                st.image(img_url, caption=f\"📍 {selected_student}\", use_container_width=True)\n")
        new_lines.append("            except Exception as e:\n")
        new_lines.append("                st.warning(\"La cámara de este alumno aún no ha sincronizado o no está disponible.\")\n\n")

        new_lines.append("with tab_auditoria:\n")
        new_lines.append("    " + line)
        continue
    
    if in_tab_section:
        if line.startswith("# ──────────────────────────── CONTROL: ZONA ROJA ──────────────────────────────"):
            in_tab_section = False
            new_lines.append(line)
        else:
            if line == "\n":
                new_lines.append("\n")
            else:
                new_lines.append("    " + line)
    else:
        new_lines.append(line)

with open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/teacher_dashboard.py", "w", encoding='utf8') as f:
    f.writelines(new_lines)
