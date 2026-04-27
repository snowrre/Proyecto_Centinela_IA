import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Mic, ShieldAlert, CheckCircle2, AlertTriangle, LogOut, Loader2, Play, Lock, User, Mail, Hash, Video } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CentinelaEngine } from '../lib/monitoring_engine';
import { supabase } from '../lib/supabase';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function StudentPortal({ onExit, darkMode, studentData }) {
  const [step, setStep] = useState('check'); // Empezar directamente en verificación
  const [formData] = useState({
    matricula: studentData?.matricula || '',
    correo: studentData?.correo || '',
    pin: studentData?.pin || ''
  });
  const [examData, setExamData] = useState(studentData?.exam || null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [suspicionScore, setSuspicionScore] = useState(0);
  const [loading, setLoading] = useState(false);
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const engineRef = useRef(null);

  useEffect(() => {
    if (studentData) {
      initCamera();
    }
  }, [studentData]);

  const handleLogin = (e) => {
    e.preventDefault();
    // Ya no es necesario, el login ocurre en la landing
  };

  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 }, 
        audio: true 
      });
      streamRef.current = stream;
      setCameraGranted(true);
      setMicGranted(true);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error media devices.", err);
      alert("Se requiere acceso a la cámara y micrófono para realizar el examen.");
    }
  };
  const startExam = async () => {
    setStep('active');
    engineRef.current = new CentinelaEngine({
      onStatus: (status) => {
        if (status.suspicionScore !== undefined) {
          setSuspicionScore(status.suspicionScore);
        }
      },
      onAlert: async (alertData) => {
        setAlerts(prev => [alertData, ...prev].slice(0, 5));
        
        // Log a Supabase con todos los datos del alumno
        await supabase.from('camera_logs').insert([{
          event_type: alertData.type,
          description: alertData.message,
          nombre_completo: formData.matricula, // Usamos matrícula como identificador principal
          matricula: formData.matricula,
          correo: formData.correo,
          pin_sala: formData.pin.toUpperCase(),
          created_at: new Date().toISOString()
        }]);

        // Intentar subir captura si es una alerta crítica
        if (alertData.type === 'OBJETO_PROHIBIDO') {
           captureAndUpload();
        }
      }
    });

    await engineRef.current.init();
    setTimeout(() => {
        if (videoRef.current) {
            engineRef.current.start(videoRef.current);
        }
    }, 800);
  };

  useEffect(() => {
    let captureInterval;
    if (step === 'active') {
        captureInterval = setInterval(captureAndUpload, 30000);
    }
    return () => {
        if (captureInterval) clearInterval(captureInterval);
    };
  }, [step]);

  const captureAndUpload = async () => {
    if (!videoRef.current) return;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
        if (blob) {
            const fileName = `${formData.matricula}.jpg`;
            await supabase.storage.from('snapshots').upload(fileName, blob, {
                upsert: true
            });
        }
    } catch (e) {
        console.warn("Error uploading snapshot:", e);
    }
  };

  const exitPortal = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (engineRef.current) engineRef.current.stop();
    onExit();
  };

  useEffect(() => {
    if ((step === 'check' || step === 'active') && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [step, cameraGranted]);

  useEffect(() => {
    if (step === 'active' && formData.matricula) {
      const channel = supabase
        .channel(`student-commands-${formData.matricula}`)
        .on(
          'postgres_changes',
          { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'commands', 
            filter: `matricula=eq.${formData.matricula}` 
          },
          (payload) => {
            const cmd = payload.new;
            if (cmd.command === 'ALERTA') {
              const msg = cmd.payload?.message || "Llamada de atención del docente.";
              setAlerts(prev => [{ type: 'SISTEMA', message: msg }, ...prev].slice(0, 5));
              // Mostrar una notificación visual persistente o un alert simple
              alert(`⚠️ MENSAJE DEL DOCENTE: ${msg}`);
            } else if (cmd.command === 'EXPULSAR') {
              alert("🚨 Has sido expulsado del examen por el docente.");
              exitPortal();
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [step, formData.matricula]);

  return (
    <div className={cn("min-h-screen font-sans transition-colors duration-300", darkMode ? "bg-surf-dark text-neutral-100" : "bg-[#f8f9fa] text-neutral-900")}>
      <nav className={cn("flex items-center justify-between px-8 py-5 border-b sticky top-0 z-50", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="font-black text-sm uppercase tracking-tighter block text-white">Centinela IA</span>
            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Portal Estudiantil</span>
          </div>
        </div>
        
        <button onClick={exitPortal} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-red-500 hover:bg-red-500/10 transition-all">
          <LogOut className="w-4 h-4" /> SALIR
        </button>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {/* El paso de login ha sido movido a LoginLanding.jsx */}

          {step === 'check' && (
            <motion.div key="check" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={cn("p-12 rounded-[48px] border", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-2xl")}>
              <h2 className="text-2xl font-black mb-10 text-center uppercase tracking-tight">Verificación de Hardware</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div className="relative group">
                  <div className="w-full aspect-video bg-black rounded-[32px] overflow-hidden relative border-4 border-neutral-200 dark:border-neutral-800 shadow-2xl">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                    {!cameraGranted && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
                            <Loader2 className="w-8 h-8 text-white animate-spin mb-4" />
                            <span className="text-xs font-black text-white uppercase tracking-widest text-center px-6">Solicitando Acceso...</span>
                        </div>
                    )}
                  </div>
                </div>
                
                <div className="space-y-6">
                    <CheckItem active={cameraGranted} label="Cámara Web" icon={<Camera className="w-5 h-5" />} />
                    <CheckItem active={micGranted} label="Micrófono" icon={<Mic className="w-5 h-5" />} />
                    <div className="p-8 rounded-[32px] border-2 border-blue-500/10 bg-blue-500/5">
                        <div className="flex items-center gap-3 mb-3">
                            <Video className="w-5 h-5 text-blue-600" />
                            <span className="text-xs font-black uppercase text-blue-600">Aviso de Privacidad</span>
                        </div>
                        <p className="text-[11px] font-bold text-neutral-500 leading-relaxed italic">
                          "El sistema detectará automáticamente objetos no permitidos y movimientos sospechosos. Tu privacidad está protegida."
                        </p>
                    </div>
                </div>
              </div>
              <div className="mt-16 flex flex-col items-center gap-4">
                <button 
                  onClick={startExam} 
                  disabled={!cameraGranted} 
                  className="px-16 py-6 bg-black dark:bg-white dark:text-black text-white rounded-[28px] text-base font-black hover:scale-[1.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-2xl uppercase tracking-widest"
                >
                  <Play className="inline mr-3 w-5 h-5 fill-current" /> Iniciar Monitoreo
                </button>
              </div>
            </motion.div>
          )}

          {step === 'active' && (
            <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col lg:flex-row gap-8 min-h-[85vh]">
              {/* LADO IZQUIERDO: MONITOREO IA */}
              <div className="w-full lg:w-[400px] space-y-6 shrink-0">
                <div className={cn("p-8 rounded-[40px] border shadow-2xl sticky top-28", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                  <div className="w-full aspect-video bg-black rounded-[32px] overflow-hidden relative border-2 border-neutral-800 shadow-2xl mb-8">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                    <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                        <span className="text-[10px] text-white font-black uppercase tracking-widest">CENTINELA LIVE</span>
                    </div>
                  </div>

                  {/* Barra de Sospecha */}
                  <div className="space-y-3 mb-8">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Nivel de Sospecha</span>
                        <span className={cn("text-xs font-black", suspicionScore > 50 ? "text-red-500" : (suspicionScore > 20 ? "text-yellow-500" : "text-emerald-500"))}>
                            {suspicionScore}%
                        </span>
                    </div>
                    <div className="h-3 w-full bg-neutral-200 dark:bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                            animate={{ width: `${suspicionScore}%` }}
                            className={cn("h-full transition-colors duration-500", suspicionScore > 50 ? "bg-red-500" : (suspicionScore > 20 ? "bg-yellow-500" : "bg-emerald-500"))}
                        />
                    </div>
                  </div>
                  
                  <div className="pt-8 border-t border-neutral-100 dark:border-white/5">
                      <div className="flex items-center justify-between mb-6">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Alertas de IA</span>
                        <span className="text-[10px] font-black text-emerald-500 uppercase flex items-center gap-2">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                            Activo
                        </span>
                      </div>
                      <div className="space-y-4">
                          {alerts.length === 0 ? (
                              <div className="flex items-center gap-3 p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-600">
                                <CheckCircle2 className="w-5 h-5" />
                                <span className="text-[10px] font-black uppercase">Sin Incidentes</span>
                              </div>
                          ) : (
                              alerts.map((a, i) => (
                                <motion.div key={i} initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-start gap-4 p-4 rounded-2xl bg-red-500/5 border border-red-500/10">
                                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                                    <div>
                                        <span className="text-[10px] font-black text-red-600 uppercase block mb-1">{a.type}</span>
                                        <p className="text-[10px] text-neutral-500 leading-tight font-medium">{a.message}</p>
                                    </div>
                                </motion.div>
                              ))
                          )}
                      </div>
                  </div>
                </div>
              </div>

              {/* LADO DERECHO: EXAMEN */}
              <div className={cn("flex-1 rounded-[40px] border overflow-hidden flex flex-col shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                <div className="px-12 py-10 border-b border-neutral-100 dark:border-white/5 flex items-center justify-between bg-blue-600">
                    <div>
                        <span className="text-[10px] font-black text-blue-100 uppercase tracking-[0.2em] mb-2 block">Evaluación Digital</span>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tight">{examData?.titulo}</h3>
                    </div>
                    <div className="text-right">
                        <span className="text-[10px] font-black text-blue-100 uppercase block mb-1">Matrícula</span>
                        <span className="text-sm font-bold text-white">{formData.matricula}</span>
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-12 space-y-12">
                    {examData?.preguntas && examData.preguntas.length > 0 ? (
                        examData.preguntas.map((q, idx) => (
                            <div key={idx} className="space-y-6">
                                <div className="flex gap-6">
                                    <span className="w-10 h-10 bg-neutral-100 dark:bg-white/5 rounded-2xl flex items-center justify-center text-xs font-black shrink-0">{idx + 1}</span>
                                    <h4 className="text-lg font-bold leading-relaxed">{q.text}</h4>
                                </div>
                                {q.type === 'multiple' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-16">
                                        {q.options.map(opt => (
                                            <button key={opt.id} className="text-left p-5 rounded-[20px] border-2 border-neutral-100 dark:border-white/5 hover:border-blue-600 hover:bg-blue-600/5 transition-all flex items-center gap-4 group">
                                                <div className="w-6 h-6 rounded-full border-2 border-neutral-300 dark:border-neutral-700 flex items-center justify-center group-hover:border-blue-600">
                                                    <span className="text-[10px] font-black uppercase text-neutral-400 group-hover:text-blue-600">{opt.id}</span>
                                                </div>
                                                <span className="text-sm font-bold">{opt.text}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {q.type === 'open' && (
                                    <div className="ml-16">
                                        <textarea 
                                            placeholder="Escribe tu respuesta aquí..."
                                            className="w-full p-6 rounded-[24px] border-2 border-neutral-100 dark:border-white/5 bg-transparent focus:border-blue-600 focus:outline-none transition-all font-medium"
                                            rows={4}
                                        />
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
                            <h4 className="text-lg font-black uppercase mb-2">Examen Completado o Sin Preguntas</h4>
                            <p className="text-xs text-neutral-500 uppercase tracking-widest">Espera instrucciones de tu docente.</p>
                        </div>
                    )}
                </div>

                <div className="p-8 border-t dark:border-white/5 bg-neutral-50 dark:bg-white/2 flex justify-end">
                    <button onClick={exitPortal} className="px-10 py-4 bg-emerald-600 text-white rounded-[20px] font-black uppercase text-xs tracking-widest hover:scale-105 transition-all shadow-xl shadow-emerald-600/20">
                        Enviar Respuestas
                    </button>
                </div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function CheckItem({ active, label, icon }) {
    return (
        <div className={cn("p-8 rounded-[32px] border-2 transition-all flex items-center justify-between", active ? "bg-emerald-500/10 border-emerald-500/20" : "bg-neutral-50 dark:bg-white/5 border-neutral-100 dark:border-white/5")}>
            <div className="flex items-center gap-5">
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm", active ? "bg-emerald-500 text-white" : "bg-neutral-200 dark:bg-white/10 text-neutral-400")}>
                    {icon}
                </div>
                <span className="text-sm font-black uppercase tracking-tight">{label}</span>
            </div>
            {active && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
        </div>
    );
}
