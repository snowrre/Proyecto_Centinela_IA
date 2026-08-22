import os
import json
import tempfile

# Asegurar que Vercel/Werkzeug use /tmp para cualquier archivo pesado en memoria
os.environ['TMPDIR'] = '/tmp'
tempfile.tempdir = '/tmp'

from flask import Flask, request, jsonify
from google.cloud import vision
from google.oauth2 import service_account
from supabase import create_client, Client, ClientOptions

app = Flask(__name__)

def obtener_cliente_vision():
    # En Vercel, la llave JSON vivirá como un texto en las variables de entorno
    credenciales_texto = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    if not credenciales_texto:
        raise ValueError("Falta la llave de Google Vision en Vercel")
    
    credenciales_dict = json.loads(credenciales_texto)
    credenciales = service_account.Credentials.from_service_account_info(credenciales_dict)
    return vision.ImageAnnotatorClient(credentials=credenciales)

def extraer_datos_ine(texto_completo):
    lineas = texto_completo.split('\n')
    for i, linea in enumerate(lineas):
        if "NOMBRE" in linea.upper():
            try:
                apellidos = lineas[i+1]
                nombres = lineas[i+2]
                return f"{nombres} {apellidos}".strip()
            except IndexError:
                pass
    return "No detectado"

@app.route('/api/leer_ine', methods=['POST'])
def leer_ine():
    try:
        if 'foto' not in request.files or 'id_alumno' not in request.form:
            return jsonify({"error": "Falta la foto o el ID del alumno"}), 400
            
        foto = request.files['foto']
        id_alumno = request.form['id_alumno']
        
        # Conectar a Supabase usando variables de entorno
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY") # Aquí irá tu SERVICE_ROLE
        
        # Apagamos el guardado de la sesión en disco para evitar [Errno 16] en Vercel
        opciones = ClientOptions(persist_session=False)
        supabase: Client = create_client(supabase_url, supabase_key, options=opciones)
        
        # Leer imagen y procesar con Google Vision
        content = foto.read()
        client = obtener_cliente_vision()
        image = vision.Image(content=content)
        response = client.text_detection(image=image)
        
        if response.error.message:
            return jsonify({"error": f"Error de Vision: {response.error.message}"}), 500
            
        textos = response.text_annotations
        if not textos:
            return jsonify({"error": "No se detectó texto en la INE"}), 400
            
        texto_crudo = textos[0].description
        nombre_extraido = extraer_datos_ine(texto_crudo)
        
        # Guardar en Supabase
        datos_insercion = {
            "id_alumno": id_alumno,
            "ine_nombre_extraido": nombre_extraido,
            "ocr_exitoso": True,
            "estado_verificacion": "pendiente_biometria"
        }
        
        supabase.table("verificacion_identidad").insert(datos_insercion).execute()
        
        return jsonify({
            "mensaje": "INE procesada con éxito",
            "nombre": nombre_extraido
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
