"""
Repair script for teacher_dashboard.py:
- Restores the missing supabase init block (load_dotenv / get_supabase_client / supabase)
- Fixes the corrupted except line 263 (has trailing old code appended)
- Removes duplicate old function body (lines 264-274)
"""
import sys, io, os

TARGET = "teacher_dashboard.py"
data = open(TARGET, "rb").read()
content = data.decode("utf-8", "replace")
lines = content.split("\n")

print(f"Original line count: {len(lines)}")

# ── Fix 1: Line 211 (index 210) ─────────────────────────────────────────────
# Currently: merged "# ── Supabase Init ──...# ── Funciones ──..."
# Replace with: full supabase init block + funciones header
supabase_init_block = (
    "# \u2500\u2500 Supabase Init \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "load_dotenv()\n"
    'SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")\n'
    'SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")\n'
    "\n"
    "@st.cache_resource(show_spinner=False)\n"
    "def get_supabase_client() -> Client | None:\n"
    "    if not SUPABASE_URL or not SUPABASE_KEY:\n"
    "        return None\n"
    "    try:\n"
    "        return create_client(SUPABASE_URL, SUPABASE_KEY)\n"
    "    except Exception:\n"
    "        return None\n"
    "\n"
    "supabase: Client | None = get_supabase_client()\n"
    "\n"
    "# \u2500\u2500 Funciones \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
)
lines[210] = supabase_init_block

# ── Fix 2: Line 263 (index 262) ──────────────────────────────────────────────
# Currently: '        return pd.DataFrame(), f"❌ Error al consultar Supabase: {exc}"atrícula...'
# Fix: clean to just the return statement
lines[262] = '        return pd.DataFrame(), f"\u274c Error al consultar Supabase: {exc}"'

# ── Fix 3: Remove residual old function body (was lines 264-274, now 263-273 after fix2) ─
# After the supabase_init_block insertion in step 1, indices shift by +15 (the extra lines)
# Let's recalculate: the block we inserted has \n separators, which split() will expand.
# Rebuild first, then re-split to get correct indices, then remove residual.
content_mid = "\n".join(lines)
lines2 = content_mid.split("\n")

print(f"After fix 1+2, line count: {len(lines2)}")

# Find and remove the orphaned old-body block:
#   '        }' followed by df.rename, priority list, existing, rest, old return, except, return
# These appear right after the new fetch function's except block.
# Identify by searching for the specific orphaned content.
target_start = None
for i, l in enumerate(lines2):
    if i > 260 and l.strip() == '}' and i < 310:
        # Check context: next lines should be df.rename... (orphaned)
        if i + 1 < len(lines2) and 'df.rename' in lines2[i+1]:
            target_start = i
            break

if target_start is not None:
    # Find end: look for the second 'except Exception as exc:' after target_start
    end_idx = None
    exc_count = 0
    for j in range(target_start, min(target_start + 20, len(lines2))):
        if 'except Exception as exc:' in lines2[j]:
            exc_count += 1
            if exc_count >= 1:
                # include this except and next return line
                end_idx = j + 2
                break
    if end_idx:
        print(f"Removing orphaned lines {target_start+1}..{end_idx} ({end_idx - target_start} lines)")
        del lines2[target_start:end_idx]
    else:
        print("WARNING: could not find end of orphaned block")
else:
    print("WARNING: orphaned block start not found — checking manually...")
    for i in range(255, 295):
        if i < len(lines2):
            print(f"  {i+1}: {lines2[i][:100]}")

print(f"Final line count: {len(lines2)}")

# Write fixed file
new_content = "\n".join(lines2)
open(TARGET, "wb").write(new_content.encode("utf-8"))
print("Repair complete!")

# Quick syntax check
import py_compile, tempfile
tmp = tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="wb")
tmp.write(new_content.encode("utf-8"))
tmp.close()
try:
    py_compile.compile(tmp.name, doraise=True)
    print("✅ Syntax OK")
except py_compile.PyCompileError as e:
    print(f"❌ Syntax error: {e}")
finally:
    os.unlink(tmp.name)
