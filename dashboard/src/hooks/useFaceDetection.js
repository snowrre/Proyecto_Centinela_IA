/**
 * useFaceDetection.js  ─── Custom Hook
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsabilidad ÚNICA: gestionar el ciclo de vida de la cámara y del
 * motor de visión artificial @vladmandic/human.
 *
 * FIXES v3.1
 * ──────────────────────────────────────────────────────────────────────────
 * Fix #ALPHA — detectFaceInFrame leía human.ready desde el closure del
 *   useCallback (valor congelado en el momento de creación). Si human.ready
 *   era false cuando se creó el callback, el candado nunca se abría aunque
 *   warmup() hubiese terminado. Solución: leer siempre el singleton desde
 *   window.__HUMAN_INSTANCE__ dentro del cuerpo de la función.
 *
 * Fix #BETA  — readyState guard subido de >= 2 (HAVE_CURRENT_DATA) a >= 3
 *   (HAVE_FUTURE_DATA). Con >= 2 el decoder tiene datos del frame actual pero
 *   NO garantiza que el siguiente esté decodificado → human.detect() podía
 *   recibir un bitmap negro en el primer frame. Con >= 3 hay al menos un frame
 *   futuro decodificado, suficiente para que la inferencia arranque limpia.
 *
 * Fix #GAMMA — startCamera ahora espera a que videoElement.play() resuelva
 *   ANTES de retornar. Antes, play() se llamaba con await pero el estado
 *   'challenge' se disparaba antes en algunos engines (Gecko, WebKit). Ahora
 *   la promesa de startCamera no resuelve hasta que play() haya terminado
 *   y readyState >= 3, eliminando la race condition entre el RAF loop y la
 *   reproducción inicial del stream.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useRef, useCallback, useEffect } from 'react';
import Human from '@vladmandic/human';
// NOTA: NO importamos @tensorflow/tfjs-backend-wasm directamente.
// Si lo importamos, Vite lo bundlea y pre-inicializa WASM aunque el backend
// sea 'webgl', causando el error "Multiple volume of Wasm sessions".
// Human gestiona la carga de su propio backend internamente.
import { useBiometric } from '../context/BiometricContext';

// ── CONFIGURACIÓN CENTRAL DE @vladmandic/human ───────────────────────────────
//
// FIX VRAM: Configuración de bajo consumo para evitar el crash "abort(Module.noExitRuntime)"
// que ocurre cuando WebGL agota la memoria de video en tarjetas con drivers de Linux.
//
// Cambios vs config anterior:
//   • mesh.enabled: false  — La malla de 468 puntos consume >60% de la VRAM. Para
//     comparación biométrica solo necesitamos el embedding, no la malla visual.
//   • gesture.enabled: false — Desactivado para ahorrar ciclos de GPU adicionales.
//   • detector.maxDetected: 1 — Solo procesar UN rostro. Más de uno desperdicia VRAM.
//   • detector.minConfidence: 0.5 — Umbral estándar, evita procesar "caras fantasma".
//   • detector.maxSize: 256  — Reescala internamente a 256px antes de inferir.
//     Reduce VRAM ~75% vs el valor por defecto (1024px). Suficiente para embeddings.
//
// COMPATIBILIDAD LAPTOP (Fix del 2026-08-18):
//   Cambiado backend: 'webgl' → 'wasm' para que funcione en laptops sin GPU dedicada.
//   Firefox en Linux suprime WebGL silenciosamente en tarjetas integradas, devolviendo
//   result.face = [] sin lanzar error — el sistema queda en 0% para siempre.
//   Con 'wasm' (CPU / WebAssembly), el análisis funciona en cualquier hardware.
//
const HUMAN_CONFIG = {
  backend: 'wasm',      // CPU fallback — compatible con laptop sin GPU dedicada
  wasmPath: '/wasm/',
  modelBasePath: '/wasm/',
  debug: false,
  cacheSensitivity: 0,  // Desactivar caché de tensores — libera VRAM entre frames
  face: {
    detector: {
      rotation: true,        // REQUERIDO: para Liveness (giros de cabeza)
      maxDetected: 1,        // Solo 1 rostro — ahorra memoria
      minConfidence: 0.5,
      maxSize: 256,          // FIX VRAM: reescalar a 256px antes de inferir
    },
    mesh:      { enabled: true },   // REQUERIDO: la malla calcula los ángulos de Euler
    iris:      { enabled: false },
    emotion:   { enabled: false },
    description: { enabled: true }, // Necesario para el embedding biométrico
  },
  body:    { enabled: false },
  hand:    { enabled: false },
  object:  { enabled: false },
  gesture: { enabled: false },  // DESACTIVADO — ahorra ciclos de GPU
};

export const getHumanInstance = () => {
  if (!window.__HUMAN_INSTANCE__) {
    window.__HUMAN_INSTANCE__ = new Human(HUMAN_CONFIG);
  }
  return window.__HUMAN_INSTANCE__;
};

// ── HOOK PRINCIPAL ─────────────────────────────────────────────────────────────
export function useFaceDetection() {
  const { modelsLoaded, setModelsLoaded } = useBiometric();
  const streamRef = useRef(null);
  const videoRef  = useRef(null);

  // ── CARGA DE MODELOS ────────────────────────────────────────────────────────
  const loadModels = useCallback(async () => {
    if (modelsLoaded) return true;

    const h = getHumanInstance();
    try {
      console.log('[Centinela Bio] Cargando modelos de @vladmandic/human...');

      await h.load();
      await h.warmup();

      setModelsLoaded(true);
      console.log('[Centinela Bio] Motor Human listo ✓  |  Backend:', h.tf.getBackend(), '|  models ready:', h.models ? 'true' : 'false');
      return true;
    } catch (err) {
      console.error('[Centinela Bio] Error al inicializar Human:', err);
      return false;
    }
  }, [modelsLoaded, setModelsLoaded]);

  // ── INICIO DE CÁMARA ────────────────────────────────────────────────────────
  //
  // Fix #GAMMA: la función no retorna hasta que:
  //   1. canplay haya disparado (primer bitmap disponible)
  //   2. play() haya completado
  //   3. readyState >= 3 (HAVE_FUTURE_DATA)
  //
  // Esto garantiza que cuando BiometricAuth.jsx hace setUiPhase('challenge')
  // y el RAF loop arranca, el video ya tiene frames reales para procesar.
  //
  const startCamera = useCallback(async (videoElement) => {
    try {
      const obtenerCamaraFisica = async () => {
        // PASO 1: Pedir un stream temporal PRIMERO
        let streamTemporal;
        try {
          streamTemporal = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (error) {
          throw new Error("PERMISOS_DENEGADOS");
        }

        // PASO 2: Leer todos los dispositivos multimedia conectados
        const dispositivos = await navigator.mediaDevices.enumerateDevices();
        const camaras = dispositivos.filter(d => d.kind === 'videoinput');

        // PASO 3: Apagar el stream temporal
        streamTemporal.getTracks().forEach(track => track.stop());

        // PASO 4: La "Lista Negra"
        const softwareVirtual = [
          'obs', 'virtual', 'manycam', 'snap', 'epoccam', 'iriun', 'xsplit', 'vdo.ninja', 'camlink', 'droidcam', 'camo'
        ];

        // PASO 5: Evaluar y encontrar la primera cámara real disponible
        const camaraValida = camaras.find(camara => {
          const nombre = camara.label.toLowerCase();
          const esVirtual = softwareVirtual.some(trampa => nombre.includes(trampa));
          return !esVirtual; 
        });

        if (!camaraValida) {
          throw new Error("VIRTUAL_CAMERA_DETECTED"); 
        }

        return camaraValida.deviceId;
      };

      const idCamaraSegura = await obtenerCamaraFisica();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          deviceId: { exact: idCamaraSegura },
          // FIX VRAM: Resolución reducida a 640×360 para aliviar la memoria de GPU.
          // 1280×720 (HD) multiplica por 4 el costo de procesamiento del tensor.
          // 640×360 es más que suficiente para la detección de rostros y el embedding.
          width:  { ideal: 640,  max: 640  },
          height: { ideal: 360,  max: 360  },
          frameRate: { ideal: 15, max: 20 },  // 15fps en lugar de 30 — libera GPU
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoElement) {
        videoRef.current  = videoElement;
        videoElement.srcObject = stream;

        // Fix #GAMMA: esperar canplay Y play() antes de retornar.
        // Usamos una promesa que:
        //   • Si el video ya está en readyState >= 3 → resuelve de inmediato
        //   • Si no → espera canplay, luego dispara play(), luego retorna
        await new Promise((resolve, reject) => {
          const TIMEOUT_MS = 10_000;
          let   settled    = false;

          const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            videoElement.removeEventListener('canplay',  onCanPlay);
            videoElement.removeEventListener('error',    onError);
            resolve();
          };

          const fail = (reason) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            videoElement.removeEventListener('canplay',  onCanPlay);
            videoElement.removeEventListener('error',    onError);
            reject(new Error(reason));
          };

          const timer = setTimeout(() => fail('VIDEO_TIMEOUT'), TIMEOUT_MS);

          const onError = () => fail('VIDEO_ERROR');

          const onCanPlay = () => {
            // Disparar play() y esperar su resolución DENTRO del handler
            videoElement.play()
              .then(done)
              .catch(() => done()); // play() rechaza en Safari si ya está reproduciendo
          };

          videoElement.addEventListener('error',   onError,   { once: true });

          // Fix #GAMMA parte 2: si readyState ya es suficiente, no esperar el evento
          if (videoElement.readyState >= 3) {
            videoElement.play()
              .then(done)
              .catch(() => done());
          } else {
            videoElement.addEventListener('canplay', onCanPlay, { once: true });
          }
        });

        // Verificación final: si por algún edge case readyState es bajo, esperamos
        if (videoElement.readyState < 2) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      return stream;
    } catch (err) {
      console.error('[Centinela Bio] Error al iniciar cámara:', err);
      throw err;
    }
  }, []);

  // ── DETECCIÓN COMPLETA DE UN FRAME ──────────────────────────────────────────
  //
  // Fix #ALPHA: leemos human.ready SIEMPRE desde el singleton global, nunca
  //   desde el closure del useCallback. Esto garantiza que, si warmup()
  //   terminó después de que se creó el callback, el guard sí se abre.
  //
  // Fix #BETA: guard de readyState subido de >= 2 → >= 3 (HAVE_FUTURE_DATA)
  //   para asegurar que hay frames reales disponibles en el decoder.
  //
  const detectFaceInFrame = useCallback(async (videoElement) => {
    if (!modelsLoaded) return null;

    const el = videoElement || videoRef.current;
    if (!el || el.readyState < 3) return null;  // Fix #BETA: >= 3

    // Fix #ALPHA: leer el singleton AHORA, no desde el closure
    const h = getHumanInstance();

    // NOTA: en @vladmandic/human v3.3.6 .ready no existe (es undefined).
    // Usamos .models como indicador de que load() y warmup() completaron.
    if (!h.models) {
      console.debug('[Centinela Bio] human.models aún no disponible, esperando próximo frame...');
      return null;
    }

    try {
      const result = await h.detect(el);
      // 🔍 DIAGNÓSTICO #1 — ELIMINAR antes del despliegue final
      console.log('1. ¿La IA ve mi cara?:', result?.face ? result.face.length : 0,
        '| backend:', h.tf?.getBackend?.() ?? 'desconocido');
      return result;
    } catch (err) {
      // Errores de frame transitorios — no son fatales
      console.warn('[Centinela Bio] detect() error transitorio:', err?.message);
      return null;
    }
  // Fix #ALPHA: `human` eliminado de las deps — se lee en tiempo de ejecución
  }, [modelsLoaded]);

  // ── PARADA DE CÁMARA ────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load();
    }
  }, []);

  useEffect(() => {
    return () => {
      // No llamar stopCamera aquí — el stream puede compartirse con el examen
    };
  }, []);

  return {
    streamRef,
    videoRef,
    modelsLoaded,
    loadModels,
    startCamera,
    detectFaceInFrame,
    stopCamera,
    human: getHumanInstance(), // Expuesto para human.draw() en BiometricAuth
  };
}
