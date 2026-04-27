import os

with open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/app.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

# Localizar la línea exacta del login_start
login_start = 0
login_end = 0

for i, line in enumerate(lines):
    if "if mode == \"login\" or not st.session_state.user_matricula:" in line:
        login_start = i
    if login_start > 0 and "elif mode == \"idle\":" in line:
        login_end = i - 1
        break

# Remover el login viejo de las lineas para poder reescribir
clean_lines = lines[:login_start] + lines[login_end+1:]

# Ahora buscar donde empieza SIDEBAR
sidebar_idx = 0
for i, line in enumerate(clean_lines):
    if line.startswith("# ═══════════════════════════ SIDEBAR ══════════════════════════════════════════"):
        sidebar_idx = i
        break

final_lines = clean_lines[:sidebar_idx+1]
final_lines.append("\n# ═══════════════════════ BLOQUEO GATING (STATE MANAGEMENT) ══════════════════\n")
final_lines.append("if not st.session_state.get('user_matricula'):\n")

# Agregar el login identado bajo el if
for l in lines[login_start+1:login_end+1]: # Omitir el if mode == login
    final_lines.append("    " + l.replace("if mode == \"login\" or not st.session_state.user_matricula:", "").strip("\n") + "\n")

final_lines.append("\nelse:\n")

# El resto del codigo (desde sidebar hasta final), indentado 4 espacios.
# OJO: Ya tenemos que quitarle el viejo "if st.session_state.user_matricula:" al sidebar si está ahí.
skip_next = False
for i in range(sidebar_idx+1, len(clean_lines)):
    line = clean_lines[i]
    if line.startswith("if st.session_state.user_matricula:"):
        continue
    if "with st.sidebar:" in line and "    with st.sidebar:" in line:
        final_lines.append("    with st.sidebar:\n")
        continue

    # Cleanup mode = login en sidebar
    if "elif mode == \"idle\" and st.session_state.user_matricula:" in line:
        final_lines.append("    if mode == \"idle\":\n")
        continue
    if "elif mode == \"active\" and st.session_state.user_matricula:" in line:
        final_lines.append("    elif mode == \"active\":\n")
        continue
    if "elif mode == \"idle\":" in line:
        final_lines.append("    if mode == \"idle\":\n")
        continue
    
    if line.strip() == "":
        final_lines.append("\n")
    else:
        # Avoid double indent if it was already indented under the sidebar 'if'
        if line.startswith("    ") and "with st.sidebar" not in line and i < sidebar_idx + 20: 
            # Actually, just blindly prepend "    " unless we specifically unindent.
            pass
        
        # We'll just strip trailing newlines and prepend 4 spaces
        final_lines.append("    " + line)

with open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/app.py", "w", encoding="utf-8") as f:
    f.writelines(final_lines)
