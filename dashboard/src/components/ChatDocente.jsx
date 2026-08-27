import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Send, MessageSquare } from 'lucide-react';

/**
 * ChatDocente — Panel de chat embebido en el Dashboard del Profesor.
 * Props:
 *   pin_sala: string  — El PIN de sala que el profesor está gestionando
 *   darkMode: boolean — Hereda el tema del dashboard
 */
export default function ChatDocente({ pin_sala, darkMode }) {
  const [mensajes, setMensajes] = useState([]);
  const [nuevoMensaje, setNuevoMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const mensajesEndRef = useRef(null);

  useEffect(() => {
    mensajesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  useEffect(() => {
    if (!pin_sala) return;

    setMensajes([]); // Limpiar al cambiar de sala

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
      .channel(`chat_docente_${pin_sala}`)
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
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
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
        remitente_nombre: 'Profesor (Monitor)',
        rol: 'docente',
        mensaje: texto,
      },
    ]);
    setEnviando(false);
  };

  const base = darkMode
    ? 'bg-[#111111] border-white/10 text-white'
    : 'bg-white border-neutral-200 text-gray-900';

  const msgBubbleDocente = darkMode
    ? 'bg-white/10 text-white'
    : 'bg-gray-800 text-white';

  const msgBubbleAlumno = darkMode
    ? 'bg-white/5 border border-white/10 text-white/90'
    : 'bg-gray-100 border border-gray-200 text-gray-800';

  return (
    <div
      className={`flex flex-col rounded-3xl border overflow-hidden shadow-xl ${base}`}
      style={{ height: '480px' }}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between px-5 py-4 ${
          darkMode ? 'bg-white/5 border-b border-white/10' : 'bg-gray-50 border-b border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className={darkMode ? 'text-blue-400' : 'text-blue-600'} />
          <span className="font-black text-sm uppercase tracking-widest">
            Chat de Sala — {pin_sala}
          </span>
        </div>
        <span className="text-xs bg-green-500 text-white px-2 py-1 rounded-full font-bold animate-pulse">
          EN VIVO
        </span>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {mensajes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-30">
            <MessageSquare size={28} />
            <p className="text-xs mt-2 uppercase tracking-widest font-bold">Sin mensajes aún</p>
          </div>
        ) : (
          mensajes.map((msg, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${msg.rol === 'docente' ? 'items-end' : 'items-start'}`}
            >
              <span
                className={`text-[10px] font-bold mb-1 ${
                  darkMode ? 'text-white/40' : 'text-gray-400'
                }`}
              >
                {msg.remitente_nombre}
              </span>
              <div
                className={`px-3 py-2 rounded-xl text-sm max-w-[80%] leading-snug ${
                  msg.rol === 'docente'
                    ? `${msgBubbleDocente} rounded-br-none`
                    : `${msgBubbleAlumno} rounded-bl-none`
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
        className={`p-3 flex gap-2 border-t ${
          darkMode ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-gray-50'
        }`}
      >
        <input
          type="text"
          value={nuevoMensaje}
          onChange={(e) => setNuevoMensaje(e.target.value)}
          placeholder="Enviar aviso a la sala..."
          className={`flex-1 rounded-xl px-3 py-2 text-sm outline-none border transition-colors ${
            darkMode
              ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-blue-500'
              : 'bg-white border-gray-300 text-gray-900 focus:border-gray-800'
          }`}
          disabled={enviando}
        />
        <button
          type="submit"
          disabled={enviando || !nuevoMensaje.trim()}
          className={`p-2.5 rounded-xl flex items-center justify-center transition-colors disabled:opacity-40 ${
            darkMode
              ? 'bg-white/10 hover:bg-white/20 text-white'
              : 'bg-gray-800 hover:bg-gray-900 text-white'
          }`}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
