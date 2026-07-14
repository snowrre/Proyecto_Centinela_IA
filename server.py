import os
import base64
import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from logic import ProctorVision
from dotenv import load_dotenv
import stripe

load_dotenv()

app = Flask(__name__)
# Esto permite que Vercel entre y que acepte los headers especiales
CORS(app, resources={r"/api/*": {"origins": "https://centinela-ia-frontend.vercel.app"}}, supports_credentials=True)

# Reemplaza con tu clave secreta de prueba real de Stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "sk_test_123456789")

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

@app.route('/api/create-checkout-session', methods=['POST'])
def create_checkout_session():
    try:
        data = request.json
        plan_type = data.get('plan', 'departamental')
        # Capturamos el ID del cliente (enviado desde React al iniciar la compra)
        client_id = data.get('clientId')

        # Definir los datos del producto y precio según el botón presionado
        if plan_type == 'campus':
            price_data = {
                'currency': 'mxn',
                'product_data': {
                    'name': 'Licencia Campus - Centinela IA',
                    'description': 'Alumnos ilimitados, métricas avanzadas y soporte prioritario institucionales.',
                },
                'unit_amount': 3999900,  # $39,999.00 MXN en centavos
            }
        else:
            price_data = {
                'currency': 'mxn',
                'product_data': {
                    'name': 'Licencia Departamental - Centinela IA',
                    'description': 'Hasta 500 alumnos simultáneos y reportes estándar.',
                },
                'unit_amount': 1499900,   # $14,999.00 MXN en centavos
            }

        # Crear la sesión de checkout de Stripe
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            client_reference_id=client_id, # <- Vinculamos el ID aquí
            line_items=[{
                'price_data': price_data,
                'quantity': 1,
            }],
            mode='payment',
            # URL a la que regresa si el pago es exitoso
            success_url='http://localhost:5173/dashboard?session_id={CHECKOUT_SESSION_ID}',
            # URL a la que regresa si cancela o cierra la pestaña de pago
            cancel_url='http://localhost:5173/',
        )

        return jsonify({'url': checkout_session.url})

    except Exception as e:
        return jsonify(error=str(e)), 403


# El secreto del webhook de Stripe para pruebas locales (lo obtendrás de Stripe CLI)
ENDPOINT_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_...")

@app.route('/api/webhook', methods=['POST'])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get('Stripe-Signature')
    event = None

    try:
        # Verificar la autenticidad del evento usando la firma de Stripe
        event = stripe.Webhook.construct_event(
            payload, sig_header, ENDPOINT_SECRET
        )
    except ValueError as e:
        # Payload inválido
        return 'Invalid payload', 400
    except stripe.error.SignatureVerificationError as e:
        # Firma inválida
        return 'Invalid signature', 400

    # Manejar el evento específico de checkout completado
    if event.type == 'checkout.session.completed':
        session = event.data.object
        
        # Extraemos la información que guardamos previamente
        client_id = getattr(session, 'client_reference_id', None)
        # Nota: Ajustamos el monto para que coincida con los precios configurados en Centinela
        plan_pagado = "campus" if getattr(session, 'amount_total', 0) == 3999900 else "departamental"
        
        if client_id:
            try:
                if supabase_admin is None:
                    print("❌ Error: supabase_admin no está configurado.")
                    return 'Database not configured', 500

                # Actualizar el estado de la licencia en la tabla 'universidades'
                resultado = supabase_admin.table('universidades').upsert({
                    'id': client_id,
                    'nombre_institucion': 'Universidad (Stripe)',
                    'licencia_activa': True,
                    'plan_contratado': plan_pagado,
                    'stripe_customer_id': getattr(session, 'customer', None)
                }).execute()
                
                print(f"✅ Licencia activada con éxito para el cliente {client_id}")
            except Exception as supabase_error:
                print(f"❌ Error al actualizar Supabase: {str(supabase_error)}")
                return 'Database update failed', 500

    return jsonify(success=True), 200

if __name__ == '__main__':
    print("Iniciando Centinela Backend Server en el puerto 5000...")
    app.run(host='0.0.0.0', port=5000, debug=False)

