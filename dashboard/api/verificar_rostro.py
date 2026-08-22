import os
import boto3
from flask import Flask, request, jsonify

app = Flask(__name__)

# Boto3 es tan inteligente que detectará automáticamente las variables 
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y AWS_DEFAULT_REGION que pusiste en Vercel
rekognition = boto3.client('rekognition')

@app.route('/api/verificar_rostro', methods=['POST'])
def verificar_rostro():
    try:
        # 1. Recibir las dos imágenes desde el frontend en React
        if 'foto_ine' not in request.files or 'foto_selfie' not in request.files:
            return jsonify({"error": "Faltan imágenes para la verificación"}), 400

        foto_ine = request.files['foto_ine'].read()
        foto_selfie = request.files['foto_selfie'].read()

        # 2. Mandar a Amazon Rekognition a comparar
        response = rekognition.compare_faces(
            SourceImage={'Bytes': foto_ine},
            TargetImage={'Bytes': foto_selfie},
            SimilarityThreshold=80.0  # Exigimos al menos un 80% de similitud biométrica
        )

        # 3. Evaluar la respuesta de la IA
        if len(response['FaceMatches']) > 0:
            similitud = response['FaceMatches'][0]['Similarity']
            return jsonify({
                "match": True,
                "similitud": similitud,
                "mensaje": "¡Identidad verificada con éxito!"
            }), 200
        else:
            return jsonify({
                "match": False,
                "mensaje": "Los rostros no coinciden. Por favor, intenta de nuevo con mejor iluminación."
            }), 401

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Configuración necesaria para pruebas locales (Vercel lo ignora)
if __name__ == '__main__':
    app.run(debug=True)
