import sys

with open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/app.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []

in_login_block = False
in_sidebar_or_main = False

login_lines = []
sidebar_and_main_lines = []

# First pass: collect chunks
idx = 0
while idx < len(lines):
    line = lines[idx]
    
    # Check if we hit the sidebar (start of UI code)
    if line.startswith("# ═══════════════════════════ SIDEBAR ══════════════════════════════════════════"):
        break
    
    new_lines.append(line)
    idx += 1


start_ui_idx = idx

# Collect login form lines from original file
login_found = False
login_start = 0
login_end = 0
for i in range(start_ui_idx, len(lines)):
    if 'with col2:' in lines[i] and ' st.markdown("<br><br><br>", unsafe_allow_html=True)' in lines[i+1]:
        login_start = i - 1 # from 'col1, col2, col3 = st.columns([1, 2, 1])'
        login_found = True
    if login_found and "st.error(f\"Error de base de datos" in lines[i]:
        login_end = i + 1
        break

login_code = "".join(lines[login_start:login_end+1])

# Build the if/else block
new_lines.append("\n# ═══════════════════════ GATING / STATE MANAGEMENT ════════════════════════════\n")
new_lines.append("if not st.session_state.user_matricula:\n")
new_lines.append("    # Muestra UNICAMENTE el login\n")

# We need to indent login_code by 4 spaces because it was under `if mode == "login":` which is also 4 spaces! Wait, if it was under `if mode == "login":`, it ALREADY has 4 spaces!
# `col1, col2 = ...` has 4 spaces.
for ll in lines[login_start:login_end+1]:
    new_lines.append(ll)

new_lines.append("\n    st.stop()  # Halt execution just in case, though the 'else' protects it.\n\n")
new_lines.append("else:\n")

# Now append everything else (Sidebar + Main Content idle/active)
# We must indent everything by 4 spaces.
for i in range(start_ui_idx, len(lines)):
    line = lines[i]
    
    # Skip the old login block
    if login_start <= i <= login_end:
        continue
    
    # Also skip "if mode == "login" or not st.session_state.user_matricula:"
    if 'if mode == "login" or not st.session_state.user_matricula:' in line:
        continue
    if 'if mode == "login":' in line:
        continue
    
    # Remove the gating from the sidebar we added previously
    if line.startswith("if st.session_state.user_matricula:"):
        continue
    if "with st.sidebar:" in line and "    with st.sidebar:" in lines[i]: # The indented one
        # Because we skip the explicit gating line, we can just unindent the sidebar back to normal before re-indenting it by 4 spaces
        pass

    # We will just apply a simple indentation logic to the raw parts
    if line.strip() == "":
        new_lines.append(line)
    else:
        # Since we are putting it under `else:`, we prepend 4 spaces
        new_lines.append("    " + line)


with open("c:/Users/sergio/Desktop/Proyecto_Centinela_IA/app.py", "w", encoding="utf-8") as f:
    f.writelines(new_lines)
