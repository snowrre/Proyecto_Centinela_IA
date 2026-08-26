import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase'; 

export default function CronometroExamen({ pin, matricula, onTimeUp, biometriaAprobada }) {
  const [tiempoRestante, setTiempoRestante] = useState(null); // en segundos
  const [sesion, setSesion] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [mostrarModalGuillotina, setMostrarModalGuillotina] = useState(false);

  // 1. Cargar configuración del examen y sesión del alumno al entrar
  useEffect(() => {
    // 🔥 EL GATILLO: Si la biometría no ha terminado, no arranques el reloj ni guardes la hora.
    if (!biometriaAprobada) return;

    async function inicializarReloj() {
      try {
        // A) Traer los límites del examen (duración y fecha fin global)
        const { data: examenData, error: errExamen } = await supabase
          .from('exams')
          .select('duracion_minutos, fecha_fin_global')
          .eq('pin_sala', pin)
          .single();

        if (errExamen) throw errExamen;

        // B) Buscar si ya existe una sesión para este alumno en este examen
        let { data: sesionData, error: errSesion } = await supabase
          .from('exam_sessions')
          .select('*')
          .eq('pin_sala', pin)
          .eq('matricula_alumno', matricula)
          .maybeSingle();

        // Si es su primera vez entrando, creamos su registro con el segundo exacto
        if (!sesionData) {
          const { data: nuevaSesion, error: errNew } = await supabase
            .from('exam_sessions')
            .insert([
              { 
                pin_sala: pin, 
                matricula_alumno: matricula, 
                hora_inicio_real: new Date().toISOString() 
              }
            ])
            .select()
            .single();

          if (errNew) throw errNew;
          sesionData = nuevaSesion;
        } else if (!sesionData.hora_inicio_real) {
          // Si fue creado en login sin hora de inicio real, la actualizamos
          const { data: sesionActualizada, error: errUpdate } = await supabase
            .from('exam_sessions')
            .update({ hora_inicio_real: new Date().toISOString() })
            .eq('id', sesionData.id)
            .select()
            .single();
          if (!errUpdate && sesionActualizada) {
            sesionData = sesionActualizada;
          } else {
            sesionData.hora_inicio_real = new Date().toISOString();
          }
        }

        setSesion(sesionData);

        // C) Calcular el tiempo restante inicial
        calcularRestante(examenData, sesionData);

      } catch (error) {
        console.error("Error al inicializar el tiempo del examen:", error);
      }
    }

    if (pin && matricula) {
      inicializarReloj();
    }
  }, [pin, matricula, biometriaAprobada]);

  // 2. Función matemática para calcular qué tiempo se acaba primero
  const calcularRestante = (examen, sesion) => {
    const ahora = new Date().getTime();
    let limites = [];

    // Límite 1: Duración individual del alumno
    if (examen.duracion_minutos && sesion.hora_inicio_real) {
      const inicioReal = new Date(sesion.hora_inicio_real).getTime();
      const limiteIndividual = inicioReal + (examen.duracion_minutos * 60 * 1000);
      limites.push(limiteIndividual);
    }

    // Límite 2: Cierre global del profesor
    if (examen.fecha_fin_global) {
      const limiteGlobal = new Date(examen.fecha_fin_global).getTime();
      limites.push(limiteGlobal);
    }

    if (limites.length === 0) {
      setTiempoRestante(null);
      return;
    }

    const tiempoFinalExamen = Math.min(...limites);
    const segundos = Math.floor((tiempoFinalExamen - ahora) / 1000);

    // DEBUG LIMPIO PARA VER LA HORA REAL DE MÉXICO
    console.log("=== DEBUG LIMPIO ===");
    console.log("Hora actual:", new Date(ahora).toLocaleString());
    console.log("Hora de guillotina:", new Date(tiempoFinalExamen).toLocaleString());
    console.log("Segundos de vida:", segundos);

    if (segundos <= 0) {
      setTiempoRestante(0);
      ejecutarGuillotina(true);
    } else {
      setTiempoRestante(segundos);
    }
  };

  // 3. El motor de cuenta regresiva (corre cada 1 segundo)
  useEffect(() => {
    if (tiempoRestante === null || tiempoRestante <= 0) return;

    const intervalo = setInterval(() => {
      setTiempoRestante((prev) => {
        if (prev <= 1) {
          clearInterval(intervalo);
          ejecutarGuillotina(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalo);
  }, [tiempoRestante]);

  // 4. La Guillotina: Auto-envío forzoso
  const ejecutarGuillotina = async (esForzoso = false) => {
    if (enviando) return;
    setEnviando(true);
    
    // 1. ACTIVAMOS EL DISEÑO BONITO (Esto reemplaza al alert feo)
    setMostrarModalGuillotina(true);

    try {
      if (esForzoso && sesion) {
        await supabase
          .from('exam_sessions')
          .update({ envio_forzado: true })
          .eq('id', sesion.id);
      }

      // 2. EL TÚNEL (Aquí pondremos tu función cuando me la mandes)
      if (typeof onTimeUp === 'function') {
         await onTimeUp(); 
      }

      // 3. Esperamos 4 segundos para que el alumno lea el modal bonito y luego lo sacamos
      setTimeout(() => {
        window.location.href = "/dashboard-alumnos";
      }, 4000);

    } catch (error) {
      console.error("Error en la guillotina:", error);
    }
  };

  // Formato visual amigable (HH:MM:SS o MM:SS)
  const formatearReloj = (segundosTotales) => {
    const horas = Math.floor(segundosTotales / 3600);
    const minutos = Math.floor((segundosTotales % 3600) / 60);
    const segundos = segundosTotales % 60;

    if (horas > 0) {
      return `${horas}:${minutos < 10 ? '0' : ''}${minutos}:${segundos < 10 ? '0' : ''}${segundos}`;
    }
    return `${minutos}:${segundos < 10 ? '0' : ''}${segundos}`;
  };

  return (
    <div className="bg-white dark:bg-[#111111] px-6 py-3 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 flex items-center justify-between mb-6">
      <div className="flex items-center space-x-2">
        <span className="w-3 h-3 bg-green-500 rounded-full animate-ping"></span>
        <span className="text-sm font-semibold text-gray-600 dark:text-neutral-300">Evaluación Segura en Curso</span>
      </div>

      {tiempoRestante !== null && (
        <div className={`font-mono text-base font-bold px-4 py-1.5 rounded-xl transition-all ${
          tiempoRestante < 300 
            ? 'bg-red-100 text-red-600 animate-pulse border border-red-200' 
            : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-800'
        }`}>
          ⏳ Tiempo: {formatearReloj(tiempoRestante)}
        </div>
      )}

      {/* MODAL DE AUTO-ENVÍO (Reemplaza al alert) */}
      {mostrarModalGuillotina && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 text-center transform scale-100">
            
            {/* Icono de Reloj animado */}
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-6">
              <svg className="h-8 w-8 text-red-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              ¡El tiempo se ha agotado!
            </h3>
            <p className="text-gray-500 mb-6 text-sm">
              Tu examen ha sido bloqueado y tus respuestas seleccionadas se están enviando automáticamente al profesor...
            </p>
            
            {/* Spinner de carga */}
            <div className="flex justify-center">
              <svg className="animate-spin h-6 w-6 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
