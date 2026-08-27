/**
 * useBiometricMonitor.js  ─── Custom Hook  (v4 — Arquitectura Edge AI Unificada)
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsabilidad ÚNICA: ciclo de monitoreo continuo en tiempo real durante el
 * examen. Corre en un bucle requestAnimationFrame fusionando YOLOv8 y MediaPipe.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useBiometric } from '../context/BiometricContext';

// MOTOR UNIFICADO: Usamos Human en lugar de MediaPipe y YOLO
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
  const sniperIntervalId = useRef(null);

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
      
      // INSERCIÓN DUAL: Mandamos la misma alerta a la tabla general para que 
      // aparezca en la barra lateral del profesor.
      await supabase.from('camera_logs').insert([{
        matricula: estudianteId,
        event_type: 'CRÍTICO', // La marcamos como crítica para que salga en rojo
        description: `IA DETECTA: ${tipoAnomalia} (${(nivelConfianza * 100).toFixed(0)}%)`,
        created_at: payload.creado_en
      }]);

      // IA SILENCIOSA: Ocultamos el log de telemetría para evitar ingeniería inversa por parte del alumno
      // console.warn(`[BioMonitor] 🚨 Telemetría enviada → ${tipoAnomalia}`, payload);
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
          window.Module = undefined; 
          console.log("[BioMonitor] Memoria WASM purgada y lista.");
      }

      // Inicializar motor Human unificado
      window.globalHumanMonitor = new Human({
        backend: 'wasm', 
        wasmPath: '/wasm/',
        modelBasePath: '/wasm/',
        debug: false,
        face: {
          enabled: true,
          detector: { return: true, rotation: true, maxSize: 256 },
          mesh: { enabled: true },
          iris: { enabled: false }, // APAGADO: Consume RAM y no lo usamos para pitch/yaw
          description: { enabled: false } // APAGADO: Ahorramos memoria, ya validamos identidad
        },
        body: { enabled: false },
        hand: { enabled: false }, // APAGADO
        object: { enabled: false }, // APAGADO
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
          let yaw = 0;
          let pitch = 0;
          let activeViolation = null;

          // ========================================================
          // LÓGICA DE ROSTROS Y CABEZA (Con Candado AWS)
          // ========================================================
          if (window.globalHumanMonitor) {
              const result = await window.globalHumanMonitor.detect(videoElement);
              
              let activeViolationTemporal = null;
              currentPersonCount = result.face ? result.face.length : 0;
              isPhoneDetected = false;

              // 1. PRIORIDAD SUPREMA: EL FRANCOTIRADOR AWS
              if (window.awsCandadoCelular) {
                  activeViolationTemporal = "USO DE DISPOSITIVO NO AUTORIZADO";
              }
              // 2. EVALUACIÓN DE ROSTROS Y AUSENCIA (Si AWS no ha detectado nada)
              else if (currentPersonCount > 1) {
                  activeViolationTemporal = "MÚLTIPLES PERSONAS DETECTADAS";
              } 
              else if (currentPersonCount === 0) {
                  activeViolationTemporal = "ESTUDIANTE AUSENTE";
              } 
              else {
                  // 3. SENSOR DE MIRADA (Estricto a 0.35 radianes / ~20 grados)
                  const rostro = result.face[0];
                  yaw = rostro.rotation?.angle?.yaw || 0;
                  pitch = rostro.rotation?.angle?.pitch || 0;

                  if (yaw > 0.35) {
                      activeViolationTemporal = "MIRADA DESVIADA (IZQUIERDA)";
                  } else if (yaw < -0.35) {
                      activeViolationTemporal = "MIRADA DESVIADA (DERECHA)";
                  } else if (pitch > 0.35) {
                      activeViolationTemporal = "MIRADA DESVIADA (ABAJO)";
                  } else if (pitch < -0.35) {
                      activeViolationTemporal = "MIRADA DESVIADA (ARRIBA)"; 
                  }
              }

              activeViolation = activeViolationTemporal;
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
                  
                  // Los dispositivos son cero tolerancia (0.0s). Otras infracciones tienen 3.0s de gracia.
                  const requiredTime = currentInfractionRef.current === "USO DE DISPOSITIVO NO AUTORIZADO" ? 0.0 : 3.0;
                  
                  if (elapsedSeconds >= requiredTime) {
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
                            motor_ia: 'Human Edge AI Unificado'
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

          // IA INVISIBLE: Desactivamos el panel HUD del canvas (Status, Yaw, Pitch)
          // Esto evita que el estudiante intente "medir" los límites del sistema.
          /*
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
          */
        }
      }
      // EL TRUCO DE RENDIMIENTO: 
      // Pausamos 200ms antes del siguiente escaneo. Tu laptop te lo agradecerá.
      setTimeout(() => {
          if (isRunningRef.current) {
              animationFrameId.current = window.requestAnimationFrame(predictWebcam);
          }
      }, 200);
    };

    predictWebcam();

    // ========================================================
    // EL FRANCOTIRADOR AWS — MONITOR UNIVERSAL (Celular + Suplantación)
    // ========================================================
    if (!sniperIntervalId.current) {
      console.log("--- Monitor Universal AWS Activado (Ciclo de 10 segundos) ---");
      sniperIntervalId.current = setInterval(async () => {
        // No disparamos si ya hay una infracción activa no relacionada a AWS
        if (currentInfractionRef.current &&
            currentInfractionRef.current !== "USO DE DISPOSITIVO NO AUTORIZADO" &&
            currentInfractionRef.current !== "SUPLANTACIÓN DE IDENTIDAD") return;

        try {
          const canvas = document.createElement('canvas');
          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

          canvas.toBlob(async (blob) => {
            if (!blob) return;
            const formData = new FormData();
            formData.append('foto', blob, 'monitoreo_universal.jpg');
            formData.append('matricula', estudianteId); // Matrícula del alumno en examen

            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
            const response = await fetch(`${apiUrl}/api/monitoreo_continuo`, {
              method: 'POST',
              body: formData
            });

            if (!response.ok) throw new Error('Fallo en servidor de monitoreo');
            const data = await response.json();

            // A. Prioridad 1: Celular detectado
            if (data.is_phone) {
              console.log("¡AVISO ROJO: AWS Detectó un Celular!");
              window.awsCandadoCelular = true;
              setTimeout(() => { window.awsCandadoCelular = false; }, 5000);
            }
            // B. Prioridad 2: Suplantación de identidad
            else if (data.es_el_alumno === false && data.razon && data.razon.includes("SUPLANTACIÓN")) {
              console.log(`¡ALERTA CRÍTICA: ${data.razon}`);
              window.awsCandadoCelular = true;
              setTimeout(() => { window.awsCandadoCelular = false; }, 5000);
            }
          }, 'image/jpeg', 0.8);
        } catch (error) {
          // Fallos silenciosos — la red del alumno no debe interrumpir su examen
        }
      }, 10000);
    }
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
    
    // 2. Apagar Francotirador AWS
    if (sniperIntervalId.current) {
        clearInterval(sniperIntervalId.current);
        sniperIntervalId.current = null;
        console.log("--- Francotirador AWS Desactivado ---");
    }

    // 3. Reiniciamos el candado
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
