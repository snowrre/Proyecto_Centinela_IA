import os

lines = open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/app.py", encoding='utf8').readlines()

new_lines = []

for idx, line in enumerate(lines):
    # 1. Inicialización
    if "from logic import ProctorVision, SuspicionLevel, SetupStatus" in line:
        new_lines.append(line)
        new_lines.append("\nif 'user_matricula' not in st.session_state:\n")
        new_lines.append("    st.session_state.user_matricula = None\n")
        new_lines.append("if 'user_name' not in st.session_state:\n")
        new_lines.append("    st.session_state.user_name = None\n")
        new_lines.append("if 'user_email' not in st.session_state:\n")
        new_lines.append("    st.session_state.user_email = None\n")
        continue

    # 2. Gating y Re-indent del Sidebar y Main Content que no sean el form
    if "with st.sidebar:" in line:
        new_lines.append("if st.session_state.user_matricula:\n")
        new_lines.append("    " + line)
        continue
        
    # Check if we are inside the sidebar area. Lines 541 to 632.
    if 540 <= idx <= 633:
        if line.strip() == "":
            new_lines.append(line)
        else:
            new_lines.append("    " + line)
        continue
        
    # Gating del MAIN CONTENT (idle y active)
    # The prompt says ALL except the login form should be gated.
    # The logical place to gate the rest is right before "elif mode == "idle":"
    if line.startswith("elif mode == \"idle\":"):
        new_lines.append("elif mode == \"idle\" and st.session_state.user_matricula:\n")
        continue
    if line.startswith("elif mode == \"active\":"):
        new_lines.append("elif mode == \"active\" and st.session_state.user_matricula:\n")
        continue

    # 3. Fallback logic in make_processor
    if "return CentinelaProcessor(proctor, matricula=st.session_state.user_matricula, supabase_client=supabase)" in line:
        new_lines.append("        matricula_segura = st.session_state.get('user_matricula', 'Desconocido')\n")
        new_lines.append("        return CentinelaProcessor(proctor, matricula=matricula_segura, supabase_client=supabase)\n")
        continue

    new_lines.append(line)

with open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/app.py", "w", encoding='utf8') as f:
    f.writelines(new_lines)
