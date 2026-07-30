import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
// redefinimos cx aquí para evitar problemas
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cx(...inputs) {
  return twMerge(clsx(inputs));
}

export function SubmissionCard({ submission, examId, onSegundaOportunidad, onUpdateScore, darkMode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [detallesExamen, setDetallesExamen] = useState([]);
  const [loading, setLoading] = useState(false);

  // Estados matemáticos
  const [puntosMultiplesGanados, setPuntosMultiplesGanados] = useState(0);
  const [totalPuntosMaximos, setTotalPuntosMaximos] = useState(0);
  const [puntosAbiertas, setPuntosAbiertas] = useState({}); // { [pregunta_id]: puntos }

  useEffect(() => {
    if (isOpen && detallesExamen.length === 0) {
      cargarDatosCompletos();
    }
  }, [isOpen]);

  const cargarDatosCompletos = async () => {
    setLoading(true);
    try {
      if (!examId) return;

      const { data: preguntas, error: errorP } = await supabase
        .from('questions')
        .select('*, options(*)')
        .eq('exam_id', examId);
        
      if (errorP) throw errorP;
      
      let sumPuntosMultiples = 0;
      let sumPuntosMax = 0;

      const detallesCruzados = preguntas.map((q, index) => {
        const respuestaAlumno = submission.answers ? submission.answers[index] : null;
        const esMultiple = q.tipo_pregunta === 'opcion_multiple';
        const valorPts = parseFloat(q.valor_puntos) || 1;
        sumPuntosMax += valorPts;
        
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
            sumPuntosMultiples += valorPts;
          }
        }

        return {
          ...q,
          index,
          esMultiple,
          valorPts,
          respuestaAlumnoTexto,
          opcionCorrectaTexto,
          esCorrectoAuto: correcta,
        };
      });

      setPuntosMultiplesGanados(sumPuntosMultiples);
      setTotalPuntosMaximos(sumPuntosMax);
      setDetallesExamen(detallesCruzados);
    } catch (err) {
      console.error("Error cargando detalles del examen:", err);
    } finally {
      setLoading(false);
    }
  };

  // Inicialización desde la base de datos
  const [puntajeTotal, setPuntajeTotal] = useState(submission?.score || 0);

  const calificarPreguntaAbierta = async (idPregunta, valorPuntos, esCorrecto) => {
    // 1. Definimos los puntos (valorPuntos o 0)
    const puntosAsignados = esCorrecto ? valorPuntos : 0;
    
    // 2. Actualizamos la pantalla de inmediato (Visual - Historial)
    setPuntosAbiertas(prev => ({
      ...prev,
      [idPregunta]: puntosAsignados
    }));
    
    // 3. Calculamos el total de puntos que va a tener el alumno
    // Sumamos lo que sacó en las múltiples + lo que ya lleva de abiertas (excluyendo esta para reemplazarla)
    const otrasAbiertas = Object.entries(puntosAbiertas)
      .filter(([k]) => k !== idPregunta)
      .reduce((acc, [, v]) => acc + v, 0);
      
    const nuevoTotal = puntosMultiplesGanados + otrasAbiertas + puntosAsignados;
    const nuevoPorcentaje = totalPuntosMaximos > 0 ? Math.round((nuevoTotal / totalPuntosMaximos) * 100) : 0;

    setPuntajeTotal(nuevoPorcentaje); // Actualizar UI en vivo

    // 4. EL CÓDIGO FALTANTE: Guardar definitivamente en Supabase
    const { error } = await supabase
      .from('exam_submissions')
      .update({ 
        score: nuevoPorcentaje, 
        estado_calificacion: 'calificado' 
      })
      .eq('id', submission.id);

    if (error) {
      console.error("Error guardando calificación:", error);
      alert("Hubo un error al guardar en la base de datos.");
    }
  };

  return (
    <div className={cx("bg-white border rounded-xl shadow-sm mb-4 overflow-hidden transition-all", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-gray-200")}>
      
      {/* CABECERA RESUMEN */}
      <div className={cx("p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b", darkMode ? "bg-[#161616] border-white/10" : "bg-gray-50 border-gray-100")}>
        <div>
          <h3 className={cx("text-lg font-bold", darkMode ? "text-white" : "text-gray-800")}>{submission.student_name || submission.matricula || 'Desconocido'}</h3>
          <p className="text-sm text-gray-500">Enviado: {new Date(submission.created_at).toLocaleTimeString()}</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => onSegundaOportunidad(submission.id)}
            className="text-xs font-bold text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
          >
            BORRAR (2DA OP.)
          </button>
          
          <span className={cx("px-3 py-1.5 rounded-lg text-xs font-bold", submission.estado_calificacion === 'calificado' ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>
            {submission.estado_calificacion === 'calificado' ? '🟢 CALIFICADO' : '🟡 PENDIENTE'}
          </span>
          
          <span className="font-bold text-blue-700 bg-blue-50 border border-blue-200 px-4 py-1.5 rounded-lg text-sm">
            PTS: {puntajeTotal}%
          </span>
          
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="bg-gray-900 text-white text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-gray-800 transition"
          >
            {isOpen ? 'OCULTAR' : 'ABRIR'}
          </button>
        </div>
      </div>

      {/* DESGLOSE DEL EXAMEN (El Acordeón) */}
      {isOpen && (
        <div className={cx("p-6 space-y-6", darkMode ? "bg-black" : "bg-white")}>
          {loading ? (
             <div className="py-6 text-center text-xs font-bold text-neutral-500 uppercase animate-pulse">Cruzando datos con la base de datos...</div>
          ) : detallesExamen.length > 0 ? (
             detallesExamen.map((q) => (
                <div key={q.id} className={cx("border rounded-xl p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-200")}>
                  {q.esMultiple ? (
                     <>
                        {/* MÚLTIPLE */}
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-xs font-bold text-gray-400 tracking-wider">OPCIÓN MÚLTIPLE</span>
                          <span className={cx("font-extrabold text-sm flex items-center gap-1", q.esCorrectoAuto ? "text-green-600" : "text-red-500")}>
                             {q.esCorrectoAuto ? `✅ +${q.valorPts} PT` : '❌ 0 PTS'}
                          </span>
                        </div>
                        <p className={cx("font-semibold mb-4 text-base", darkMode ? "text-white" : "text-gray-800")}>{q.texto_pregunta}</p>
                        
                        <div className={cx("p-4 rounded-lg border mb-3", q.esCorrectoAuto ? "bg-green-50/50 border-green-200" : "bg-red-50/50 border-red-200")}>
                          <p className={cx("text-xs font-bold mb-1", q.esCorrectoAuto ? "text-green-700" : "text-red-700")}>
                             {q.esCorrectoAuto ? '✅' : '❌'} RESPUESTA DEL ALUMNO:
                          </p>
                          <p className={cx("text-sm font-medium", q.esCorrectoAuto ? "text-green-900" : "text-red-900")}>
                             {q.respuestaAlumnoTexto || "Sin respuesta"}
                          </p>
                        </div>

                        {!q.esCorrectoAuto && (
                           <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg dark:bg-white/5 dark:border-white/10">
                             <p className="text-xs font-bold text-gray-500 mb-1">RESPUESTA CORRECTA ERA:</p>
                             <p className="text-sm font-medium text-gray-800 dark:text-gray-300">{q.opcionCorrectaTexto || "Desconocida"}</p>
                           </div>
                        )}
                     </>
                  ) : (
                     <>
                        {/* ABIERTA */}
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-xs font-bold text-blue-500 tracking-wider">PREGUNTA ABIERTA</span>
                          
                          {puntosAbiertas[q.id] !== undefined ? (
                            <span className="text-green-600 font-extrabold text-sm flex items-center gap-1">
                               {puntosAbiertas[q.id] === q.valorPts ? `✅ +${q.valorPts} PT` : '❌ 0 PTS'}
                            </span>
                          ) : (
                            <span className="text-yellow-600 font-extrabold text-sm bg-yellow-100 px-3 py-1 rounded-md">
                              POR CALIFICAR
                            </span>
                          )}
                        </div>
                        
                        <p className={cx("font-semibold mb-4 text-base", darkMode ? "text-white" : "text-gray-800")}>{q.texto_pregunta}</p>
                        
                        <div className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 p-4 rounded-lg text-sm text-gray-700 dark:text-gray-300 mb-5 italic shadow-inner">
                          "{q.respuestaAlumnoTexto || "Sin respuesta"}"
                        </div>
                        
                        {/* CONTROLES DE CALIFICACIÓN */}
                        <div className="flex gap-3 border-t border-gray-200 dark:border-white/10 pt-4">
                          <button 
                            onClick={() => calificarPreguntaAbierta(q.id, q.valorPts, true)}
                            className="flex-1 bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800 py-2.5 rounded-lg font-bold text-sm transition-colors duration-200 border border-green-200"
                          >
                            ✅ CORRECTA ({q.valorPts} PT)
                          </button>
                          <button 
                            onClick={() => calificarPreguntaAbierta(q.id, q.valorPts, false)}
                            className="flex-1 bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800 py-2.5 rounded-lg font-bold text-sm transition-colors duration-200 border border-red-200"
                          >
                            ❌ INCORRECTA (0 PTS)
                          </button>
                        </div>
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
