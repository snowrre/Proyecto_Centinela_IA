import os
import json
import tempfile
import google.generativeai as genai
from dotenv import load_dotenv
from flask import Flask, request, jsonify

# Cargamos las variables de entorno
load_dotenv()
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))

app = Flask(__name__)

@app.route('/api/lector_examenes', methods=['POST'])
def procesar_pdf_a_json():
    archivo_ia = None
    ruta_tmp = None
    try:
        if 'examen_pdf' not in request.files:
            return jsonify({"error": "No se envió ningún archivo PDF."}), 400
            
        archivo_pdf = request.files['examen_pdf']
        
        # Guardamos temporalmente el PDF en la carpeta /tmp (permitida por Vercel)
        fd, ruta_tmp = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        archivo_pdf.save(ruta_tmp)
        
        # 1. Subimos el PDF directo a Gemini (¡súper ligero, sin librerías de imagen!)
        archivo_ia = genai.upload_file(ruta_tmp, mime_type="application/pdf")
        
        # 2. El modelo de IA
        modelo = genai.GenerativeModel('gemini-1.5-pro')
        
        # 3. Instrucciones estrictas
        instrucciones = """
        Eres un analizador de exámenes. Lee este examen en PDF y devuelve un objeto JSON válido.
        Tu respuesta debe ser EXCLUSIVAMENTE el JSON, sin texto antes ni después (sin bloques markdown).
        
        Sigue estrictamente esta estructura:
        {
          "titulo_examen": "Nombre o tema del examen",
          "preguntas": [
            {
              "numero": 1,
              "tipo": "opcion_multiple", 
              "texto": "¿Cuál es la pregunta?",
              "opciones": ["Opción A", "Opción B", "Opción C"],
              "respuesta_correcta": "Aquí va la respuesta correcta o null si no se infiere"
            }
          ]
        }
        """
        
        # 4. Hacemos la llamada forzando la respuesta JSON
        respuesta = modelo.generate_content(
            [archivo_ia, instrucciones],
            generation_config={"response_mime_type": "application/json"}
        )
        
        # 5. Convertimos a diccionario nativo
        examen_estructurado = json.loads(respuesta.text)
        return jsonify(examen_estructurado), 200

    except json.JSONDecodeError:
        return jsonify({"error": "Gemini no devolvió un JSON válido."}), 500
    except Exception as e:
        print("Error interno:", str(e))
        return jsonify({"error": "Error al procesar el examen", "detalle": str(e)}), 500
    finally:
        # 6. Limpiamos la memoria para que Vercel no colapse
        if archivo_ia:
            try:
                genai.delete_file(archivo_ia.name)
            except:
                pass
        if ruta_tmp and os.path.exists(ruta_tmp):
            os.remove(ruta_tmp)

if __name__ == "__main__":
    app.run(debug=True, port=5001)
