import * as faceMesh from '@mediapipe/face_mesh';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';

export class CentinelaEngine {
    constructor(callbacks) {
        this.callbacks = callbacks; // { onAlert: (msg) => {}, onStatus: (status) => {} }
        this.faceMesh = null;
        this.objectModel = null;
        this.isRunning = false;
        this.lastAlertTime = 0;
        this.suspicionScore = 0;
        this.lastScoreUpdate = Date.now();
    }

    async init() {
        try {
            // Cargar Face Mesh
            this.faceMesh = new faceMesh.FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
            });

            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            this.faceMesh.onResults(this.onFaceResults.bind(this));

            // Cargar YOLO/COCO-SSD para objetos
            this.objectModel = await cocoSsd.load();

            console.log("Centinela Engine: Inicializado [OK]");
            return true;
        } catch (error) {
            console.error("Centinela Engine: Error de inicialización", error);
            return false;
        }
    }

    async start(videoElement) {
        this.isRunning = true;
        const process = async () => {
            if (!this.isRunning) return;
            
            if (videoElement.readyState === 4) {
                // Decaimiento natural de la sospecha (cada segundo baja un poco)
                const now = Date.now();
                if (now - this.lastScoreUpdate > 1000) {
                    this.suspicionScore = Math.max(0, this.suspicionScore - 2);
                    this.lastScoreUpdate = now;
                    this.callbacks.onStatus?.({ suspicionScore: this.suspicionScore });
                }

                // Procesar cara
                await this.faceMesh.send({ image: videoElement });
                
                // Procesar objetos (cada 10 frames para no saturar)
                if (Math.random() > 0.8) {
                    const predictions = await this.objectModel.detect(videoElement);
                    this.checkObjects(predictions);
                }
            }
            
            requestAnimationFrame(process);
        };
        process();
    }

    stop() {
        this.isRunning = false;
    }

    onFaceResults(results) {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            this.handleViolation("AUSENCIA_ROSTRO", "No se detecta rostro frente a la cámara");
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];
        
        // Lógica simplificada de mirada (Gaze)
        // Usamos los puntos de la nariz (1) y laterales (234, 454) para estimar rotación
        const nose = landmarks[1];
        const leftSide = landmarks[234];
        const rightSide = landmarks[454];

        const horizontalRatio = (nose.x - leftSide.x) / (rightSide.x - leftSide.x);
        
        if (horizontalRatio < 0.35) {
            this.handleViolation("MIRADA_LATERAL", "Mirando hacia la izquierda", 5);
        } else if (horizontalRatio > 0.65) {
            this.handleViolation("MIRADA_LATERAL", "Mirando hacia la derecha", 5);
        }
    }

    checkObjects(predictions) {
        const suspicious = predictions.find(p => 
            p.class === 'cell phone' || p.class === 'book' || p.class === 'laptop'
        );

        if (suspicious && suspicious.score > 0.6) {
            this.handleViolation("OBJETO_PROHIBIDO", `Se detectó: ${suspicious.class}`, 25);
        }
    }

    handleViolation(type, msg, scorePenalty = 10) {
        const now = Date.now();
        
        // Incrementar sospecha
        this.suspicionScore = Math.min(100, this.suspicionScore + scorePenalty);
        this.callbacks.onStatus?.({ suspicionScore: this.suspicionScore });

        if (now - this.lastAlertTime > 4000) { // Throttle 4s para alertas persistentes
            this.lastAlertTime = now;
            this.callbacks.onAlert({ type, message: msg, timestamp: now });
        }
    }
}
