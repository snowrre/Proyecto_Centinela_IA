import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { cn } from '../utils/cn'; // Asumo que cn se puede mover a utils o lo redefinimos aquí.
// Pero como es pequeño, redefinamos cn aquí para evitar problemas de dependencias circulares o rutas si no existe utils/cn.js
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cx(...inputs) {
  return twMerge(clsx(inputs));
}

export function SubmissionCard({ submission, examId, onSegundaOportunidad, onUpdateScore, darkMode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [detallesExamen, setDetallesExamen] = useState([]);
  const [loading, setLoading] = useState(false);

  // Puntaje total visual en vivo, inicializado con el de la DB
  const [puntajeTotal, setPuntajeTotal] = useState(submission.score || 0);

  useEffect(() => {
    if (isOpen && detallesExamen.length === 0) {
      cargarDatosCompletos();
    }
  }, [isOpen]);

  const cargarDatosCompletos = async () => {
    setLoading(true);
    try {
      // 1. Traer preguntas nativas con sus opciones
      // El examId lo obtenemos del AdminDashboard o de la misma submission si es posible
      if (!examId) return;

      const { data: preguntas, error: errorP } = await supabase
        .from('questions')
        .select('*, options(*)')
        .eq('exam_id', examId);
        
      if (errorP) throw errorP;

      // 2. Cruzar con las respuestas del alumno (submission.answers)
      // En submission.answers tenemos { [index_pregunta]: id_opcion_o_texto }
      // Pero no tenemos el ID real de la pregunta en la respuesta, sino el índice.
      // Así que usamos el mismo orden (index).
      
      const detallesCruzados = preguntas.map((q, index) => {
        const respuestaAlumno = submission.answers ? submission.answers[index] : null;
        const esMultiple = q.tipo_pregunta === 'opcion_multiple';
        
        let correcta = false;
        let opcionCorrectaTexto = null;
        let respuestaAlumnoTexto = respuestaAlumno;

        if (esMultiple) {
          const optCorrecta = q.options?.find(o => o.es_correcta);
          if (optCorrecta) opcionCorrectaTexto = optCorrecta.texto_opcion;
          
          const optSeleccionada = q.options?.find(o => o.id === respuestaAlumno);
          if (optSeleccionada) respuestaAlumnoTexto = optSeleccionada.texto_opcion;
          
          if (optCorrecta && respuestaAlumno === optCorrecta.id) {
            correcta = true;
          }
        }

        return {
          ...q,
          index,
          esMultiple,
          respuestaAlumnoTexto,
          opcionCorrectaTexto,
          esCorrectoAuto: correcta,
          // Guardaremos si ya fue calificada manualmente en el feedback del profe
          // Pero por ahora lo dejamos simple.
        };
      });

      setDetallesExamen(detallesCruzados);
    } catch (err) {
      console.error("Error cargando detalles del examen:", err);
    } finally {
      setLoading(false);
    }
  };

  const calificarPreguntaAbierta = async (valorPuntos, esCorrecto) => {
    const puntosAAgregar = esCorrecto ? (valorPuntos || 1) : 0;
    const nuevoScore = puntajeTotal + puntosAAgregar;
    
    // Llamar a la función principal de actualización en AdminDashboard
    await onUpdateScore(submission.id, nuevoScore, "");
    
    setPuntajeTotal(nuevoScore);
    alert(`Pregunta calificada como ${esCorrecto ? 'Correcta' : 'Incorrecta'}`);
  };

  return (
    <div className={cx("border rounded-[28px] overflow-hidden mb-4 shadow-sm transition-colors", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
      {/* CABECERA */}
      <div className={cx("p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b", darkMode ? "bg-white/5 border-white/5" : "bg-neutral-50 border-neutral-100")}>
        <div>
          <h3 className={cx("text-sm font-black uppercase", darkMode ? "text-white" : "text-gray-900")}>{submission.student_name}</h3>
          <p className="text-[10px] font-bold text-neutral-400 mt-1">Enviado: {new Date(submission.created_at).toLocaleTimeString()}</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => onSegundaOportunidad(submission.id)}
            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest border border-red-500/20 transition-colors"
          >
            Borrar (2da Op.)
          </button>
          
          <span className={cx("px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border flex items-center gap-1", 
            submission.estado_calificacion === 'calificado' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
          )}>
            {submission.estado_calificacion === 'calificado' ? '🟢 Calificado' : '🟡 Pendiente'}
          </span>
          
          <span className="px-4 py-1.5 bg-blue-600/10 text-blue-600 dark:text-blue-400 rounded-xl text-[12px] font-black uppercase tracking-widest border border-blue-600/20">
            PTS: {puntajeTotal}
          </span>
          
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className={cx("px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition", darkMode ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-900 text-white hover:bg-neutral-800")}
          >
            {isOpen ? 'Ocultar' : 'Ver Respuestas'}
          </button>
        </div>
      </div>

      {/* ACORDEÓN DESPLEGABLE */}
      {isOpen && (
        <div className={cx("p-6 space-y-4", darkMode ? "bg-black/20" : "bg-white")}>
          {loading ? (
             <div className="py-6 text-center text-xs font-bold text-neutral-500 uppercase animate-pulse">Cargando respuestas reales...</div>
          ) : detallesExamen.length > 0 ? (
             detallesExamen.map((q) => (
                <div key={q.id} className={cx("border rounded-[20px] p-5", darkMode ? "bg-white/5 border-white/5" : "bg-neutral-50 border-neutral-100")}>
                  {q.esMultiple ? (
                     <>
                        {/* MÚLTIPLE */}
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Opción Múltiple</span>
                          <span className={cx("text-[10px] font-black uppercase tracking-widest", q.esCorrectoAuto ? "text-emerald-500" : "text-red-500")}>
                             {q.esCorrectoAuto ? `✅ +${q.valor_puntos || 1} Pt` : '❌ 0 Pts'}
                          </span>
                        </div>
                        <p className={cx("font-bold text-sm mb-4", darkMode ? "text-neutral-200" : "text-neutral-800")}>{q.texto_pregunta}</p>
                        <div className="space-y-2">
                          <div className={cx("p-3 rounded-xl text-xs font-bold flex items-start gap-2 border", q.esCorrectoAuto ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400")}>
                            <span>{q.esCorrectoAuto ? '✅' : '❌'}</span>
                            <div>
                               <span className="block italic text-[10px] uppercase opacity-70 mb-1">Respuesta del alumno:</span>
                               {q.respuestaAlumnoTexto || "Sin respuesta"}
                            </div>
                          </div>
                          {!q.esCorrectoAuto && (
                             <div className="p-3 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/5 text-xs font-bold text-neutral-600 dark:text-neutral-400">
                                <span className="block italic text-[10px] uppercase opacity-70 mb-1">Respuesta correcta:</span>
                                {q.opcionCorrectaTexto || "Desconocida"}
                             </div>
                          )}
                        </div>
                     </>
                  ) : (
                     <>
                        {/* ABIERTA */}
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Pregunta Abierta</span>
                          <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">Por calificar</span>
                        </div>
                        <p className={cx("font-bold text-sm mb-4", darkMode ? "text-neutral-200" : "text-neutral-800")}>{q.texto_pregunta}</p>
                        <div className={cx("p-4 rounded-xl text-sm italic mb-4 border", darkMode ? "bg-black/50 border-white/10 text-neutral-300" : "bg-white border-neutral-200 text-neutral-700")}>
                          "{q.respuestaAlumnoTexto || "Sin respuesta"}"
                        </div>
                        
                        {/* Controles del Profesor */}
                        {submission.estado_calificacion === 'pendiente_revision' && (
                           <div className="flex flex-col sm:flex-row gap-2 border-t dark:border-white/5 pt-4 mt-2">
                             <button 
                               onClick={() => calificarPreguntaAbierta(q.valor_puntos, true)}
                               className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest flex-1 transition-colors"
                             >
                               ✅ Correcto (+{q.valor_puntos || 1} Pt)
                             </button>
                             <button 
                               onClick={() => calificarPreguntaAbierta(q.valor_puntos, false)}
                               className="bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border border-red-500/30 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest flex-1 transition-colors"
                             >
                               ❌ Incorrecto (0 Pts)
                             </button>
                           </div>
                        )}
                     </>
                  )}
                </div>
             ))
          ) : (
             <div className="py-6 text-center text-xs font-bold text-neutral-400 uppercase">
                Modo legado: Las preguntas detalladas no están disponibles para este examen antiguo.
             </div>
          )}
        </div>
      )}
    </div>
  );
}
