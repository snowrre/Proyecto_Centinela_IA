import os
import csv
import io
import base64
import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from logic import ProctorVision
from dotenv import load_dotenv
import mercadopago
from concurrent.futures import ThreadPoolExecutor

# Activamos un pool de hilos para aprovechar el hardware al máximo
executor = ThreadPoolExecutor(max_workers=4)

load_dotenv()

app = Flask(__name__)
# Esto le dice a Python que acepte el tráfico de cualquier dominio
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Obtenemos el token de forma segura
MP_ACCESS_TOKEN = os.getenv("MP_ACCESS_TOKEN")
if not MP_ACCESS_TOKEN:
    raise ValueError("Token de Mercado Pago no configurado en el entorno")
sdk = mercadopago.SDK(MP_ACCESS_TOKEN)

# ── Motor de inferencia YOLO ──────────────────────────────────────────────────
proctor = ProctorVision()

# ── Cliente Supabase con service_role (bypassa RLS) ───────────────────────────
# Usa SUPABASE_SERVICE_KEY del .env — nunca la clave anon/pública.
_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

supabase_admin = None
if _SUPABASE_URL and _SUPABASE_SERVICE_KEY:
    try:
        from supabase import create_client
        supabase_admin = create_client(_SUPABASE_URL, _SUPABASE_SERVICE_KEY)
        print("[Centinela] Cliente Supabase admin (service_role) inicializado [OK]")
    except Exception as e:
        print(f"[Centinela] ADVERTENCIA: No se pudo inicializar supabase_admin: {e}")
        print("[Centinela] El endpoint /api/grade no estará disponible hasta que se configure SUPABASE_SERVICE_KEY.")
else:
    print("[Centinela] ADVERTENCIA: SUPABASE_SERVICE_KEY no encontrada en .env — /api/grade deshabilitado.")


# ── Endpoint: Inferencia de frames YOLO ──────────────────────────────────────
def procesar_imagen_pesada(base64_str):
    """ Función que decodifica y analiza la imagen en un hilo secundario """
    img_data = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_data, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        raise ValueError("Invalid image format")

    report = proctor.analyze_frame(frame)
    
    detections = []
    if report and report.objects:
        for box in report.objects.yolo_boxes:
            detections.append({
                'class': box['name'].lower(),
                'confidence': box['conf'],
                'bbox': box['box']
            })
    return detections

@app.route('/api/analyze-frame', methods=['POST'])
@app.route('/api/predict_frame', methods=['POST'])
def analyze_frame():
    try:
        data = request.json
        if not data or 'image' not in data:
            return jsonify({'error': 'No image provided'}), 400

        base64_str = data['image']
        if ',' in base64_str:
            base64_str = base64_str.split(',')[1]
        
        # Delegamos la tarea pesada a los hilos de fondo
        future = executor.submit(procesar_imagen_pesada, base64_str)
        detections = future.result()
        
        return jsonify({'detections': detections, 'status': 'success'})
        
    except Exception as e:
        print(f"Error procesando frame: {e}")
        return jsonify({'error': str(e)}), 500


# ── Endpoint: Guardar respuestas correctas (solo backend, service_role) ───────
@app.route('/api/save-exam-answers', methods=['POST'])
def save_exam_answers():
    """
    Recibe {pin, correct_options} del docente al crear un examen.
    Guarda en exam_answers usando service_role — el rol anon NUNCA puede escribir aquí.
    """
    if supabase_admin is None:
        return jsonify({'error': 'Backend no configurado: falta SUPABASE_SERVICE_KEY en .env'}), 503

    try:
        data = request.json
        pin = data.get('pin')
        correct_options = data.get('correct_options')

        if not pin or correct_options is None:
            return jsonify({'error': 'Faltan campos: pin y correct_options son requeridos'}), 400

        # Upsert: si el PIN ya existe (re-publicación), actualiza las respuestas
        res = supabase_admin.table('exam_answers').upsert(
            {'pin': str(pin), 'correct_options': correct_options},
            on_conflict='pin'
        ).execute()

        return jsonify({'status': 'ok', 'pin': pin})

    except Exception as e:
        print(f"[save-exam-answers] Error: {e}")
        return jsonify({'error': str(e)}), 500


# ── Endpoint: Calificación segura en el servidor ─────────────────────────────
@app.route('/api/grade', methods=['POST'])
def grade_exam():
    """
    Recibe {pin, answers: {"0": "a", "1": "c", ...}} del alumno.
    Lee las respuestas correctas de exam_answers (tabla protegida con RLS).
    Calcula y devuelve solo el puntaje — nunca expone correctOption al cliente.
    """
    if supabase_admin is None:
        # Si no hay service key, devolver score 0 como fallback seguro
        return jsonify({'score': 0, 'correctas': 0, 'total': 0, 'fallback': True}), 200

    try:
        data = request.json
        pin = data.get('pin')
        answers = data.get('answers', {})  # {"0": "a", "1": "c", ...}

        if not pin:
            return jsonify({'error': 'Falta el campo pin'}), 400

        # Leer respuestas correctas de la tabla protegida (service_role bypassa RLS)
        res = supabase_admin.table('exam_answers') \
            .select('correct_options') \
            .eq('pin', str(pin)) \
            .single() \
            .execute()

        if not res.data:
            # Examen sin respuestas registradas (ej: Google Forms) → score null
            return jsonify({'score': None, 'correctas': None, 'total': None})

        correct_options = res.data.get('correct_options', {})  # {"0": "a", "1": null, ...}

        # Calcular calificación comparando respuestas del alumno vs correctas
        total = len(correct_options)
        correctas = 0

        for idx_str, correct_val in correct_options.items():
            if correct_val is None:
                # Pregunta abierta — no se califica automáticamente
                continue
            student_ans = str(answers.get(idx_str, '')).strip().lower()
            if student_ans == str(correct_val).strip().lower():
                correctas += 1

        # Calcular solo sobre preguntas calificables (con correct_val != null)
        gradeable = sum(1 for v in correct_options.values() if v is not None)
        score = round((correctas / gradeable) * 100) if gradeable > 0 else 0

        return jsonify({'score': score, 'correctas': correctas, 'total': gradeable})

    except Exception as e:
        print(f"[grade] Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/create-preference', methods=['POST', 'OPTIONS'])
def create_preference():
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type, ngrok-skip-browser-warning")
        response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
        return response

    # Aquí definimos lo que vas a cobrar
    preference_data = {
        "items": [
            {
                "title": "Licencia Campus - Centinela IA (Prueba)",
                "quantity": 1,
                "unit_price": 10.00,
                "currency_id": "MXN"
            }
        ],
        "back_urls": {
            "success": "https://centinela-ia-frontend.vercel.app/exito", # A donde volverá el usuario tras pagar
            "failure": "https://centinela-ia-frontend.vercel.app/error",
            "pending": "https://centinela-ia-frontend.vercel.app/pendiente"
        },
        "auto_return": "approved"
    }

    preference_response = sdk.preference().create(preference_data)
    preference = preference_response["response"]
    
    # Devolvemos el link de cobro a React
    return jsonify({"init_point": preference["init_point"]})

@app.route('/api/crear-campus', methods=['POST', 'OPTIONS'])
def crear_campus():
    # 1. Pase VIP para el CORS
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type, ngrok-skip-browser-warning")
        response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
        return response

    # 2. Leer FormData (texto en request.form, archivo en request.files)
    payment_id       = request.form.get('payment_id')
    nombre_institucion = request.form.get('nombre_institucion')
    correo_admin     = request.form.get('correo_admin')
    dominio          = request.form.get('dominio')
    archivo_csv      = request.files.get('archivo_csv')

    if not payment_id or not nombre_institucion or not correo_admin or not dominio or not archivo_csv:
        return jsonify({"error": "Faltan datos requeridos (payment_id, institución, correo, dominio) o el archivo CSV"}), 400

    if supabase_admin is None:
        return jsonify({"error": "Backend no configurado: falta SUPABASE_SERVICE_KEY en .env"}), 503

    # 3. Guardia de Mercado Pago: verificar que el pago sea real y esté aprobado
    try:
        pago_info = sdk.payment().get(payment_id)
        if pago_info["response"]["status"] != "approved":
            return jsonify({"error": "El pago no está aprobado o es inválido"}), 400
    except Exception as e:
        print(f"[crear-campus] Error consultando MP: {e}")
        return jsonify({"error": "No se pudo validar el pago con Mercado Pago"}), 500

    # 4. Registrar Universidad en Supabase y capturar su ID generado
    try:
        datos_campus = {
            "nombre_institucion": nombre_institucion,
            "mercadopago_payment_id": str(payment_id),
            "licencia_activa": True,
            "plan_contratado": "campus",
            "correo_admin": correo_admin,
            "dominio_permitido": dominio
        }
        respuesta_campus = supabase_admin.table('universidades').insert(datos_campus).execute()

        # Supabase devuelve la fila recién creada — extraemos el UUID
        id_universidad = respuesta_campus.data[0]['id']
        print(f"[crear-campus] Universidad registrada con id: {id_universidad}")

    except Exception as e:
        # El motor de BD lanzará error si el payment_id ya existe (UNIQUE constraint)
        print(f"[crear-campus] Error insertando universidad: {e}")
        return jsonify({"error": "Este pago ya fue utilizado. Intento de fraude bloqueado."}), 403

    # 5. ¡LA MAGIA! Procesar el CSV y registrar a cada profesor
    # Usamos utf-8-sig para limpiar el BOM oculto que Excel a veces agrega al inicio del archivo
    stream = io.StringIO(archivo_csv.stream.read().decode("utf-8-sig"), newline=None)
    csv_reader = csv.DictReader(stream)

    # Limpiamos los espacios en blanco invisibles de los nombres de las columnas
    if csv_reader.fieldnames:
        csv_reader.fieldnames = [str(field).strip() for field in csv_reader.fieldnames]

    cuentas_creadas  = 0
    cuentas_fallidas = []

    for row in csv_reader:
        # Buscamos múltiples variantes para ser a prueba de errores humanos
        nombre    = (row.get('Nombre') or row.get('nombre_completo') or row.get('nombre') or '').strip()
        correo    = (row.get('Correo') or row.get('correo_institucional') or row.get('correo') or '').strip()
        matricula = (row.get('Matricula') or row.get('matricula_empleado') or row.get('matricula') or '').strip()

        if not correo or not matricula:
            continue  # Fila incompleta, saltar

        # Contraseña temporal: 'Centinela' + matrícula del empleado
        password_temporal = f"Centinela{matricula}"

        try:
            # A. Crear la cuenta en Supabase Auth (sistema de autenticación)
            user_response = supabase_admin.auth.admin.create_user({
                "email": correo,
                "password": password_temporal,
                "email_confirm": True,  # Sin correo de confirmación — acceso inmediato
            })

            # Extraemos el UUID del usuario recién creado
            nuevo_usuario_id = user_response.user.id

            # B. Insertar el perfil en la tabla pública 'usuarios' vinculado a su universidad
            supabase_admin.table('usuarios').insert({
                "id":            nuevo_usuario_id,
                "email":         correo,
                "nombre":        nombre,
                "rol":           "profesor",
                "matricula":     matricula,
                "id_universidad": id_universidad  # ¡La conexión que lo ata a su campus!
            }).execute()

            cuentas_creadas += 1
            print(f"[crear-campus] Profesor registrado: {correo} → universidad {id_universidad}")

        except Exception as e:
            # Si el correo ya existía u otro error, lo registramos y continuamos
            print(f"[crear-campus] Error creando perfil para {correo}: {e}")
            cuentas_fallidas.append(correo)

    return jsonify({
        "mensaje": f"¡Campus '{nombre_institucion}' creado! Se activaron {cuentas_creadas} cuentas de profesores.",
        "cuentas_creadas":  cuentas_creadas,
        "cuentas_fallidas": cuentas_fallidas,
        "id_universidad":   id_universidad
    }), 200

if __name__ == '__main__':
    print("Iniciando Centinela Backend Server en el puerto 5000...")
    app.run(host='0.0.0.0', port=5000, debug=False)

