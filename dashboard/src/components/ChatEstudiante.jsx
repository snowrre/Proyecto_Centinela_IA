import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { MessageCircle, X, Send } from 'lucide-react';

/**
 * ChatEstudiante — Botón flotante de chat para el alumno durante el examen.
 * Props:
 *   pin_sala    : string  — El PIN de sala del examen actual
 *   nombreAlumno: string  — Nombre o matrícula del alumno
 */
export default function ChatEstudiante({ pin_sala, nombreAlumno }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [nuevoMensaje, setNuevoMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [tieneNuevos, setTieneNuevos] = useState(false);
  const mensajesEndRef = useRef(null);

  // Auto-scroll al último mensaje
  useEffect(() => {
    mensajesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  // Quitar notificación cuando el alumno abre el chat
  useEffect(() => {
    if (isOpen) setTieneNuevos(false);
  }, [isOpen]);

  // Cargar mensajes y suscribirse a cambios en tiempo real
  useEffect(() => {
    if (!pin_sala) return;

    const fetchMensajes = async () => {
      const { data } = await supabase
        .from('mensajes_examen')
        .select('*')
        .eq('sala_id', pin_sala)
        .order('creado_en', { ascending: true });
      if (data) setMensajes(data);
    };
    fetchMensajes();

    const channel = supabase
      .channel(`chat_alumno_${pin_sala}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'mensajes_examen',
          filter: `sala_id=eq.${pin_sala}`,
        },
        (payload) => {
          setMensajes((prev) => [...prev, payload.new]);
          // Mostrar punto de notificación si el chat está cerrado y es del docente
          if (!isOpen && payload.new.rol === 'docente') {
            setTieneNuevos(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pin_sala]);

  const enviarMensaje = async (e) => {
    e.preventDefault();
    const texto = nuevoMensaje.trim();
    if (!texto || enviando) return;

    setEnviando(true);
    setNuevoMensaje('');
    await supabase.from('mensajes_examen').insert([
      {
        sala_id: String(pin_sala),
        remitente_nombre: nombreAlumno || 'Alumno',
        rol: 'alumno',
        mensaje: texto,
      },
    ]);
    setEnviando(false);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Ventana de Chat */}
      {isOpen && (
        <div
          className="mb-4 flex flex-col overflow-hidden rounded-2xl shadow-2xl border"
          style={{
            width: '320px',
            height: '420px',
            background: 'rgba(15,15,20,0.97)',
            borderColor: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-blue-600">
            <div className="flex items-center gap-2">
              <MessageCircle size={16} className="text-white opacity-80" />
              <span className="text-white font-bold text-sm">Chat con el Docente</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white/70 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {mensajes.length === 0 ? (
              <p className="text-center text-white/30 text-xs mt-10">
                Aún no hay mensajes. Escribe tu duda.
              </p>
            ) : (
              mensajes.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${msg.rol === 'alumno' ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-[10px] text-white/40 mb-1">{msg.remitente_nombre}</span>
                  <div
                    className={`px-3 py-2 rounded-xl text-sm max-w-[85%] leading-snug ${
                      msg.rol === 'alumno'
                        ? 'bg-blue-600 text-white rounded-br-none'
                        : 'bg-white/10 text-white rounded-bl-none'
                    }`}
                  >
                    {msg.mensaje}
                  </div>
                </div>
              ))
            )}
            <div ref={mensajesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={enviarMensaje}
            className="border-t border-white/10 p-3 flex gap-2 bg-black/20"
          >
            <input
              type="text"
              value={nuevoMensaje}
              onChange={(e) => setNuevoMensaje(e.target.value)}
              placeholder="Escribe tu duda..."
              className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-blue-500 transition-colors"
              disabled={enviando}
            />
            <button
              type="submit"
              disabled={enviando || !nuevoMensaje.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white p-2 rounded-lg transition-colors flex items-center justify-center"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      {/* Botón Flotante */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="relative bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-full shadow-xl transition-all duration-200 hover:scale-105 flex items-center justify-center"
        title="Chat con el Docente"
      >
        <MessageCircle size={22} />
        {/* Punto de notificación */}
        {tieneNuevos && !isOpen && (
          <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-blue-600 animate-pulse" />
        )}
      </button>
    </div>
  );
}
