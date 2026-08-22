import os
import boto3
from flask import Flask, request, jsonify

app = Flask(__name__)

# Boto3 detecta automáticamente AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# y AWS_REGION desde las variables de entorno de Vercel — sin hardcodear llaves
rekognition = boto3.client(
    'rekognition',
    region_name=os.environ.get('AWS_REGION', 'us-east-2')
)

@app.route('/api/verificar_rostro', methods=['POST'])
def verificar_rostro():
    try:
        # Recibir las dos imágenes desde React como archivos multipart
        if 'foto_ine' not in request.files or 'foto_selfie' not in request.files:
            return jsonify({"error": "Faltan imágenes para la verificación"}), 400

        foto_ine    = request.files['foto_ine'].read()
        foto_selfie = request.files['foto_selfie'].read()

        # Mandar a Amazon Rekognition a comparar ambas fotos
        response = rekognition.compare_faces(
            SourceImage={'Bytes': foto_ine},
            TargetImage={'Bytes': foto_selfie},
            SimilarityThreshold=80.0  # Mínimo 80% de similitud biométrica
        )

        # Evaluar el veredicto de la IA
        if len(response['FaceMatches']) > 0:
            similitud = response['FaceMatches'][0]['Similarity']
            return jsonify({
                "match":    True,
                "similitud": similitud,
                "mensaje":  "¡Identidad verificada con éxito!"
            }), 200
        else:
            return jsonify({
                "match":   False,
                "similitud": 0,
                "mensaje": "Los rostros no coinciden. Intenta de nuevo con mejor iluminación."
            }), 401

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Solo para pruebas locales — Vercel ignora este bloque
if __name__ == '__main__':
    app.run(debug=True)
