/**
 * TerminosYPrivacidad.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Pantalla legal que el alumno DEBE aceptar antes de que se active la cámara
 * y el proceso biométrico de Centinela IA.
 *
 * Flujo:
 *   1. Se muestra después del login, antes de BiometricAuth / EnrolamientoFacial
 *   2. El alumno debe marcar las 3 casillas obligatorias
 *   3. Al presionar "Aceptar y Continuar" → onAccept()
 *   4. Si cierra/rechaza → onReject() (vuelve al login)
 *
 * Props:
 *   darkMode   {boolean}   — Tema visual
 *   onAccept   {Function}  — Callback al aceptar todas las casillas
 *   onReject   {Function}  — Callback al rechazar / volver atrás
 *   studentName {string}   — Nombre del alumno para personalizar el saludo
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Camera, Fingerprint, BookOpen, ChevronRight, X, CheckCircle2 } from 'lucide-react';

// ── Definición de las 3 casillas obligatorias ────────────────────────────────
const CLAUSULAS = [
  {
    id: 'hardware',
    icono: Camera,
    color: 'blue',
    titulo: 'Uso de Hardware',
    descripcion:
      'Autorizo a Centinela IA a acceder a la cámara web y al micrófono de este equipo ' +
      'durante toda la sesión del examen con fines exclusivos de supervisión académica.',
  },
  {
    id: 'biometria',
    icono: Fingerprint,
    color: 'purple',
    titulo: 'Procesamiento Biométrico',
    descripcion:
      'Entiendo que el sistema analizará mi rostro para crear un vector matemático único ' +
      '(no una fotografía). Este dato se almacenará de forma cifrada y no será compartido ' +
      'con terceros fuera del ámbito institucional.',
  },
  {
    id: 'integridad',
    icono: BookOpen,
    color: 'emerald',
    titulo: 'Reglas de Integridad Académica',
    descripcion:
      'Acepto que cualquier anomalía detectada (cambio de persona, dispositivos prohibidos, ' +
      'salida de pantalla) quedará registrada y podrá ser reportada al docente, con las ' +
      'consecuencias académicas que la institución determine.',
  },
];

// Mapa de colores por id para evitar purga de Tailwind
const COLOR_MAP = {
  blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',   icon: 'text-blue-400',   ring: 'ring-blue-500'   },
  purple:  { bg: 'bg-purple-500/10',  border: 'border-purple-500/30', icon: 'text-purple-400', ring: 'ring-purple-500' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30',icon: 'text-emerald-400',ring: 'ring-emerald-500'},
};

export default function TerminosYPrivacidad({ darkMode = false, onAccept, onReject, studentName }) {
  const [aceptadas, setAceptadas] = useState({ hardware: false, biometria: false, integridad: false });

  const todasAceptadas = Object.values(aceptadas).every(Boolean);

  const toggleClausula = (id) => {
    setAceptadas(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Estilos de tema
  const bg   = darkMode ? 'bg-[#0a0a0a]'   : 'bg-slate-100';
  const card = darkMode ? 'bg-[#111111] border-white/8' : 'bg-white border-slate-200';
  const text = darkMode ? 'text-white'      : 'text-slate-900';
  const sub  = darkMode ? 'text-slate-400'  : 'text-slate-500';
  const divider = darkMode ? 'border-white/8' : 'border-slate-200';

  return (
    <div className={`min-h-screen ${bg} flex items-center justify-center p-4`}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden ${card}`}
      >
        {/* ── Encabezado ── */}
        <div className={`px-8 pt-8 pb-6 border-b ${divider}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/30">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className={`text-lg font-black tracking-tight ${text}`}>
                Aviso de Privacidad
              </h1>
              <p className={`text-xs font-semibold ${sub}`}>Centinela IA · Supervisión Académica</p>
            </div>
          </div>

          <p className={`text-sm leading-relaxed ${sub}`}>
            {studentName ? (
              <>Hola, <span className={`font-bold ${text}`}>{studentName}</span>. Antes de</>
            ) : 'Antes de'} encender la cámara, debes leer y aceptar los siguientes términos. Son de cumplimiento <span className="font-bold text-red-400">obligatorio</span>.
          </p>
        </div>

        {/* ── Cláusulas ── */}
        <div className="px-8 py-6 space-y-4">
          {CLAUSULAS.map((c) => {
            const aceptada = aceptadas[c.id];
            const col = COLOR_MAP[c.color];
            const Icono = c.icono;

            return (
              <motion.button
                key={c.id}
                onClick={() => toggleClausula(c.id)}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 flex gap-4 items-start
                  ${aceptada
                    ? `${col.bg} ${col.border} ring-1 ${col.ring}`
                    : darkMode ? 'bg-white/3 border-white/10 hover:bg-white/5' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
              >
                {/* Ícono de la cláusula */}
                <div className={`shrink-0 p-2 rounded-xl ${aceptada ? col.bg : darkMode ? 'bg-white/5' : 'bg-slate-200'}`}>
                  <Icono className={`w-4 h-4 ${aceptada ? col.icon : sub}`} />
                </div>

                {/* Texto */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold mb-1 ${text}`}>{c.titulo}</p>
                  <p className={`text-xs leading-relaxed ${sub}`}>{c.descripcion}</p>
                </div>

                {/* Checkbox visual */}
                <div className="shrink-0 mt-0.5">
                  <AnimatePresence mode="wait">
                    {aceptada ? (
                      <motion.div
                        key="check"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                      >
                        <CheckCircle2 className={`w-5 h-5 ${col.icon}`} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="empty"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        className={`w-5 h-5 rounded-full border-2 ${darkMode ? 'border-white/20' : 'border-slate-300'}`}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* ── Contador y botones ── */}
        <div className={`px-8 pb-8 pt-2 border-t ${divider} space-y-3`}>
          {/* Progreso */}
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-bold ${sub}`}>
              {Object.values(aceptadas).filter(Boolean).length} / {CLAUSULAS.length} aceptadas
            </span>
            <div className="flex gap-1.5">
              {CLAUSULAS.map(c => (
                <div
                  key={c.id}
                  className={`h-1.5 w-8 rounded-full transition-all duration-300 ${
                    aceptadas[c.id] ? 'bg-blue-500' : darkMode ? 'bg-white/10' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Botón principal */}
          <motion.button
            onClick={() => todasAceptadas && onAccept?.()}
            disabled={!todasAceptadas}
            whileHover={todasAceptadas ? { scale: 1.02 } : {}}
            whileTap={todasAceptadas ? { scale: 0.98 } : {}}
            className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-all duration-300
              ${todasAceptadas
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
                : darkMode ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
          >
            {todasAceptadas
              ? <><ShieldCheck className="w-4 h-4" /> Aceptar y Continuar<ChevronRight className="w-4 h-4" /></>
              : 'Acepta todas las cláusulas para continuar'
            }
          </motion.button>

          {/* Botón secundario — rechazar/volver */}
          <button
            onClick={() => onReject?.()}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-xs font-semibold transition-colors
              ${darkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <X className="w-3.5 h-3.5" />
            No acepto — volver al inicio
          </button>
        </div>
      </motion.div>
    </div>
  );
}
