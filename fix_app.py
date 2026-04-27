import os

lines = open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/app.py", encoding='utf8').readlines()

new_lines = []

for idx, line in enumerate(lines):
    # 1. Inicialización segura
    if line.startswith("# ── Autorefresh opcional ──────────────────────────────────────────────────────"):
        new_lines.append("if 'user_matricula' not in st.session_state:\n")
        new_lines.append("    st.session_state.user_matricula = None\n")
        new_lines.append("if 'user_name' not in st.session_state:\n")
        new_lines.append("    st.session_state.user_name = None\n")
        new_lines.append("if 'user_email' not in st.session_state:\n")
        new_lines.append("    st.session_state.user_email = None\n\n")
        new_lines.append(line)
        continue

    # 2. Gating SIDEBAR
    if line.startswith("with st.sidebar:"):
        new_lines.append("if st.session_state.user_matricula:\n")
        new_lines.append("    with st.sidebar:\n")
        continue

    # Indent elements recursively inside the sidebar up to MAIN CONTENT
    # However we know the old file has the sidebar unindented until MAIN CONTENT
    # I can just look forward and indent it dynamically or use a state
    # Wait, it's easier to just do it via exact line replacements.
