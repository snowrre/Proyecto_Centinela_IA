/**
 * useBiometricMonitor.js  ─── Custom Hook  (v4 — Arquitectura Edge AI Unificada)
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsabilidad ÚNICA: ciclo de monitoreo continuo en tiempo real durante el
 * examen. Corre en un bucle requestAnimationFrame fusionando YOLOv8 y MediaPipe.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useBiometric } from '../context/BiometricContext';
import * as ort from 'onnxruntime-web';

// INYECTA ESTA LÍNEA PARA SOLUCIONAR EL ERROR DEL MAGIC WORD
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

// MOTOR UNIFICADO: Usamos Human en lugar de MediaPipe
import { Human } from '@vladmandic/human';
import { supabase } from '../lib/supabase';

// ── CONSTANTES DE CONFIGURACIÓN ───────────────────────────────────────────────
const ALERT_COOLDOWN_MS    = 15_000;  // Anti-spam: mínimo 15 s entre alertas iguales
const YAW_THRESHOLD = 15;
const PITCH_THRESHOLD = 15;
const INFRACTION_TIME_LIMIT_MS = 3000;

// =================================================================
// 1. VARIABLES GLOBALES (SINGLETON) - ¡Fuera del hook de React!
// =================================================================
window.globalSession = window.globalSession || null;
window.globalHumanMonitor = window.globalHumanMonitor || null;
window.isInitializingAI = window.isInitializingAI || false;

export function useBiometricMonitor() {
  const { rostroMaestro } = useBiometric();

  const isRunningRef     = useRef(false);
  const engineReadyRef   = useRef(false);
  const animationFrameId = useRef(null);

  // Variables del Motor de Reglas
  const infractionStartMsRef = useRef(0);
  const currentInfractionRef = useRef(null);
  const alertaEnviadaRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);

  // Cooldowns
  const lastAlertTimeRef = useRef({
    'ESTUDIANTE AUSENTE': 0,
    'MÚLTIPLES PERSONAS DETECTADAS': 0,
    'USO DE DISPOSITIVO NO AUTORIZADO': 0,
    'MIRADA DESVIADA (LADOS)': 0,
    'MIRADA DESVIADA (ABAJO)': 0,
  });

  const enviarTelemetria = useCallback(async (estudianteId, tipoAnomalia, detalles, nivelConfianza = 1.0) => {
    const now = Date.now();
    const lastTime = lastAlertTimeRef.current[tipoAnomalia] ?? 0;

    if (now - lastTime < ALERT_COOLDOWN_MS) {
      return;
    }
    lastAlertTimeRef.current[tipoAnomalia] = now;

    const payload = {
      estudiante_id: estudianteId,
      tipo_anomalia: tipoAnomalia,
      duracion_segundos: parseFloat((INFRACTION_TIME_LIMIT_MS / 1000).toFixed(1)),
      detalles_tecnicos: detalles,
      requiere_revision: true,
      nivel_confianza: parseFloat((nivelConfianza * 100).toFixed(2)),
      creado_en: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.from('telemetria_examenes').insert([payload]);
      if (error) throw error;
      console.warn(`[BioMonitor] 🚨 Telemetría enviada → ${tipoAnomalia}`, payload);
    } catch (err) {
      console.error('[BioMonitor] Fallo al enviar telemetría:', err);
    }
  }, []);

  const ensureEngineReady = useCallback(async () => {
    if (engineReadyRef.current) return true;
    
    // Si ya fue instanciado globalmente, lo reusamos inmediatamente
    if (window.globalSession && window.globalFaceLandmarker) {
      console.log("[BioMonitor] Reusando instancias de MediaPipe y YOLOv8...");
      engineReadyRef.current = true;
      return true;
    }

    if (window.isInitializingAI) {
      // Si ya se está inicializando en otro hilo (ej. StrictMode), esperamos
      while (window.isInitializingAI) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (window.globalSession && window.globalHumanMonitor) {
        engineReadyRef.current = true;
        return true;
      }
    }

    window.isInitializingAI = true;
    try {
      console.log("[BioMonitor] Descargando modelos de visión...");
      
      // Limpieza de memoria WASM
      if (typeof window !== 'undefined' && window.Module) {
          delete window.Module; 
          console.log("[BioMonitor] Memoria WASM purgada y lista.");
      }

      ort.env.wasm.numThreads = 4;
      window.globalSession = await ort.InferenceSession.create('/yolov8n.onnx', { executionProviders: ['wasm'] });
      
      // Inicializar motor Human unificado
      window.globalHumanMonitor = new Human({
        backend: 'wasm', 
        wasmPath: '/wasm/',
        modelBasePath: '/wasm/',
        debug: false,
        face: {
          enabled: true,
          detector: { return: true, rotation: true },
          mesh: { enabled: true },
          iris: { enabled: true }, 
          description: { enabled: false } // APAGADO: Ahorramos memoria, ya validamos identidad
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false }
      });

      await window.globalHumanMonitor.load();
      await window.globalHumanMonitor.warmup();

      engineReadyRef.current = true;
      window.isInitializingAI = false; // Liberamos el candado global
      console.log('[BioMonitor] ¡Human y YOLO inicializados con éxito! Cero choques de memoria.');
      return true;
    } catch (err) {
      console.error('[BioMonitor] Error crítico al cargar la IA:', err);
      window.isInitializingAI = false;
      return false;
    }
  }, []);

  // --- Funciones Matemáticas Auxiliares ---
  const iou = (box1, box2) => {
    const xA = Math.max(box1.x, box2.x);
    const yA = Math.max(box1.y, box2.y);
    const xB = Math.min(box1.x + box1.w, box2.x + box2.w);
    const yB = Math.min(box1.y + box1.h, box2.y + box2.h);
    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const box1Area = box1.w * box1.h;
    const box2Area = box2.w * box2.h;
    return interArea / (box1Area + box2Area - interArea);
  };

  const nms = (boxes, iouThreshold) => {
    boxes.sort((a, b) => b.confidence - a.confidence);
    const result = [];
    while (boxes.length > 0) {
        const best = boxes.shift();
        result.push(best);
        boxes = boxes.filter(box => iou(best, box) < iouThreshold);
    }
    return result;
  };

  const startMonitoring = useCallback(async (videoElement, canvasElement, estudianteId = '', onStatusUpdate = null) => {
    if (isRunningRef.current) return;
    
    const ready = await ensureEngineReady();
    if (!ready) return;

    isRunningRef.current = true;
    console.log('[BioMonitor] ▶ Iniciando ciclo de monitoreo en tiempo real | Alumno:', estudianteId);

    const canvasCtx = canvasElement.getContext('2d');
    const classNames = { 0: "Persona", 67: "Teléfono Móvil" };

    const predictWebcam = async () => {
      if (!isRunningRef.current) return;

      if (videoElement.readyState >= 2 && !videoElement.paused) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        
        let startTimeMs = performance.now();
        
        if (lastVideoTimeRef.current !== videoElement.currentTime) {
          lastVideoTimeRef.current = videoElement.currentTime;
          
          canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

          let currentPersonCount = 0;
          let isPhoneDetected = false;

          // ========================================================
          // LÓGICA YOLOv8 (LETTERBOXING)
          // ========================================================
          if (window.globalSession) {
            const yoloSize = 640;
            const canvasYolo = document.createElement('canvas');
            canvasYolo.width = yoloSize;
            canvasYolo.height = yoloSize;
            const ctxYolo = canvasYolo.getContext('2d', { willReadFrequently: true });

            const vWidth = videoElement.videoWidth;
            const vHeight = videoElement.videoHeight;
            
            const scale = Math.min(yoloSize / vWidth, yoloSize / vHeight);
            const newWidth = vWidth * scale;
            const newHeight = vHeight * scale;
            
            const padX = (yoloSize - newWidth) / 2;
            const padY = (yoloSize - newHeight) / 2;

            ctxYolo.fillStyle = '#000000';
            ctxYolo.fillRect(0, 0, yoloSize, yoloSize);
            ctxYolo.drawImage(videoElement, padX, padY, newWidth, newHeight);
            
            const imgData = ctxYolo.getImageData(0, 0, yoloSize, yoloSize);
            const input = new Float32Array(1 * 3 * yoloSize * yoloSize);
            for (let i = 0; i < imgData.data.length / 4; i++) {
                input[i] = imgData.data[i * 4] / 255.0;
                input[i + yoloSize * yoloSize] = imgData.data[i * 4 + 1] / 255.0;
                input[i + 2 * yoloSize * yoloSize] = imgData.data[i * 4 + 2] / 255.0;
            }
            const tensor = new ort.Tensor('float32', input, [1, 3, yoloSize, yoloSize]);

            try {
                const results = await window.globalSession.run({ images: tensor }); 
                const output = results[Object.keys(results)[0]].data; 
                
                let rawBoxes = [];
                const numBoxes = 8400; 
                const numClasses = 80;

                for (let i = 0; i < numBoxes; i++) {
                    let maxConf = 0;
                    let classId = -1;
                    for (let c = 0; c < numClasses; c++) {
                        const conf = output[(4 + c) * numBoxes + i];
                        if (conf > maxConf) { maxConf = conf; classId = c; }
                    }

                    if (maxConf > 0.50) {
                        const xc = output[0 * numBoxes + i];
                        const yc = output[1 * numBoxes + i];
                        const w = output[2 * numBoxes + i];
                        const h = output[3 * numBoxes + i];
                        rawBoxes.push({
                            x: xc - w / 2, y: yc - h / 2, w: w, h: h, confidence: maxConf, classId: classId
                        });
                    }
                }

                const finalBoxes = nms(rawBoxes, 0.45);
                
                finalBoxes.forEach(box => {
                    if (box.classId === 0 || box.classId === 67) { 
                        if (box.classId === 0) currentPersonCount++;
                        if (box.classId === 67) isPhoneDetected = true;
                        
                        const unpaddedX = (box.x - padX) / scale;
                        const unpaddedY = (box.y - padY) / scale;
                        const unpaddedW = box.w / scale;
                        const unpaddedH = box.h / scale;

                        canvasCtx.strokeStyle = box.classId === 67 ? '#FF0000' : '#00FF00';
                        canvasCtx.lineWidth = 3;
                        canvasCtx.strokeRect(unpaddedX, unpaddedY, unpaddedW, unpaddedH);

                        canvasCtx.fillStyle = box.classId === 67 ? '#FF0000' : '#00FF00';
                        canvasCtx.font = "18px monospace";
                        
                        canvasCtx.save();
                        canvasCtx.translate(unpaddedX + unpaddedW, unpaddedY);
                        canvasCtx.scale(-1, 1);
                        const label = `${classNames[box.classId] || 'Obj'} ${Math.round(box.confidence * 100)}%`;
                        canvasCtx.fillText(label, 0, -5);
                        canvasCtx.restore();
                    }
                });
            } catch (error) { console.error("Error YOLOv8:", error); }
          }

          // ========================================================
          // LÓGICA HUMAN UNIFICADA (HEAD POSE)
          // ========================================================
          let yaw = 0;
          let pitch = 0;

          if (window.globalHumanMonitor) {
              const result = await window.globalHumanMonitor.detect(videoElement);
              if (result.face && result.face.length > 0) {
                  const rostro = result.face[0];
                  
                  if (rostro.rotation && rostro.rotation.angle) {
                      // Human devuelve radianes, los convertimos a grados para la lógica existente
                      pitch = rostro.rotation.angle.pitch * (180 / Math.PI);
                      yaw = rostro.rotation.angle.yaw * (180 / Math.PI);
                  }

                  // Opcional: Dibujar malla para feedback visual en el monitor
                  window.globalHumanMonitor.draw.face(canvasElement, result.face, { 
                      drawPoints: false, 
                      drawPolygons: true, 
                      drawGaze: true 
                  });
              } else {
                  // Si no hay cara, podemos forzar los grados para trigger de "AUSENTE"
                  // o dejar que YOLO detecte currentPersonCount = 0
              }
          }

          // ========================================================
          // MOTOR DE REGLAS (MÁQUINA DE ESTADOS)
          // ========================================================
          let activeViolation = null;

          if (isPhoneDetected) {
              activeViolation = "USO DE DISPOSITIVO NO AUTORIZADO";
          } else if (currentPersonCount > 1) {
              activeViolation = "MÚLTIPLES PERSONAS DETECTADAS";
          } else if (currentPersonCount === 0) {
              activeViolation = "ESTUDIANTE AUSENTE";
          } else if (yaw > YAW_THRESHOLD || yaw < -YAW_THRESHOLD) {
              activeViolation = "MIRADA DESVIADA (LADOS)";
          } else if (pitch > PITCH_THRESHOLD) {
              activeViolation = "MIRADA DESVIADA (ABAJO)";
          }

          const currentTimeMs = performance.now();
          let statusColor = "#00FF00";
          let statusText = "Supervisión Activa (OK)";
          let currentScore = 0;

          if (activeViolation) {
              if (infractionStartMsRef.current === 0) {
                  infractionStartMsRef.current = currentTimeMs;
                  currentInfractionRef.current = activeViolation;
                  alertaEnviadaRef.current = false;
                  statusColor = "#FFFF00"; 
                  statusText = `Evaluando: ${currentInfractionRef.current}...`;
                  currentScore = 50;
              } else {
                  const elapsedSeconds = (currentTimeMs - infractionStartMsRef.current) / 1000;
                  
                  if (elapsedSeconds >= 3.0) {
                      statusColor = "#FF0000"; 
                      statusText = `🚨 INFRACCIÓN: ${currentInfractionRef.current}`;
                      currentScore = 100;
                      
                      if (!alertaEnviadaRef.current) {
                          alertaEnviadaRef.current = true;
                          const detalles = {
                            grados_yaw: parseFloat(yaw.toFixed(2)),
                            grados_pitch: parseFloat(pitch.toFixed(2)),
                            personas_detectadas: currentPersonCount,
                            celular_detectado: isPhoneDetected,
                            motor_ia: isPhoneDetected || currentPersonCount !== 1 ? 'YOLOv8' : 'MediaPipe'
                          };
                          enviarTelemetria(estudianteId, currentInfractionRef.current, detalles, 1.0);
                      }
                  } else {
                      statusColor = "#FFFF00";
                      statusText = `⚠️ Advertencia: ${currentInfractionRef.current} (${elapsedSeconds.toFixed(1)}s)`;
                      currentScore = 50 + (elapsedSeconds / 3.0) * 50;
                  }
              }
          } else {
              infractionStartMsRef.current = 0;
              currentInfractionRef.current = null;
              alertaEnviadaRef.current = false;
              currentScore = 0;
          }

          // Callback UI opcional
          onStatusUpdate?.({
            tipoAnomalia: currentInfractionRef.current,
            suspicionScore: currentScore,
            timestamp: Date.now(),
          });

          // Dibujar Estado UI en Canvas
          canvasCtx.fillStyle = statusColor;
          canvasCtx.font = "bold 20px monospace";
          canvasCtx.save();
          canvasCtx.translate(canvasElement.width, 0); 
          canvasCtx.scale(-1, 1);
          canvasCtx.fillText(statusText, 20, 40);
          
          canvasCtx.font = "14px monospace";
          canvasCtx.fillStyle = "#FFFFFF";
          canvasCtx.fillText(`Yaw: ${yaw.toFixed(1)}° | Pitch: ${pitch.toFixed(1)}°`, 20, 70);
          canvasCtx.fillText(`Personas: ${currentPersonCount} | Celular: ${isPhoneDetected ? 'SI' : 'NO'}`, 20, 90);
          canvasCtx.restore();
        }
      }
      
      animationFrameId.current = window.requestAnimationFrame(predictWebcam);
    };

    predictWebcam();
  }, [ensureEngineReady, enviarTelemetria]);

  const stopMonitoring = useCallback(() => {
    isRunningRef.current = false;
    if (animationFrameId.current) {
      window.cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    
    console.log('[BioMonitor] ⏹ Ciclo de monitoreo detenido. Liberando memoria WebGL...');
    
    // 1. Apagamos el motor unificado
    if (window.globalHumanMonitor) {
        try {
            // Detenemos los procesos en lugar de asignarlo a null sin limpiar
            // window.globalHumanMonitor.dispose();
            // Lo conservamos si es global para el proximo mount, o lo dejamos vivir
        } catch(e) {}
    }
    
    // 2. Reiniciamos el candado
    window.isInitializingAI = false;
    
  }, []);

  useEffect(() => {
    return () => stopMonitoring();
  }, [stopMonitoring]);

  return {
    startMonitoring,
    stopMonitoring,
    isRunning: isRunningRef,
  };
}
