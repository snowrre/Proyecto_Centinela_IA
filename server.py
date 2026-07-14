import os
import base64
import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from logic import ProctorVision
from dotenv import load_dotenv
import mercadopago

load_dotenv()

app = Flask(__name__)
# Esto le dice a Python que acepte el tráfico de cualquier dominio
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Inicializa Mercado Pago con tu Access Token de Producción
sdk = mercadopago.SDK("APP_USR-2799377136698972-071400-bc05d85d92beca01572b91e15db1703c-1986408007")

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
        
        img_data = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({'error': 'Invalid image format'}), 400

        report = proctor.analyze_frame(frame)
        
        detections = []
        if report and report.objects:
            for box in report.objects.yolo_boxes:
                detections.append({
                    'class': box['name'].lower(),
                    'confidence': box['conf'],
                    'bbox': box['box']
                })
        
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
    # Aquí definimos lo que vas a cobrar
    preference_data = {
        "items": [
            {
                "title": "Licencia Campus - Centinela IA",
                "quantity": 1,
                "unit_price": 39999.00,
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

if __name__ == '__main__':
    print("Iniciando Centinela Backend Server en el puerto 5000...")
    app.run(host='0.0.0.0', port=5000, debug=False)

