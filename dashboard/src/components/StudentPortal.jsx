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

export default function StudentPortal({ onExit, darkMode }) {
  const [step, setStep] = useState('login'); // login, check, active
  const [formData, setFormData] = useState({
    matricula: '',
    nombre: '',
    correo: '',
    pin: ''
  });
  const [examData, setExamData] = useState(null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const engineRef = useRef(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!formData.pin || !formData.matricula) return;
    setLoading(true);
    
    try {
      // Verificar PIN en Supabase
      const { data, error } = await supabase
        .from('exams')
        .select('id, pin_sala, titulo, preguntas, created_at')
        .eq('pin_sala', formData.pin.toUpperCase())
        .single();

      if (data) {
        setExamData(data);
        setStep('check');
        initCamera();
      } else {
        alert("PIN Inválido. Por favor verifica con tu docente.");
      }
    } catch (err) {
      console.error("Error verifying PIN:", err);
      // Fallback para pruebas con PIN 5700
      if (formData.pin === '5700') {
        setExamData({ titulo: "Examen de Prueba (Local)", pin_sala: '5700' });
        setStep('check');
        initCamera();
      } else {
        alert("Error de conexión con el servidor.");
      }
    }
    setLoading(false);
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
      onAlert: async (alertData) => {
        setAlerts(prev => [alertData, ...prev].slice(0, 5));
        
        // Log a Supabase con todos los datos del alumno
        await supabase.from('camera_logs').insert([{
          event_type: alertData.type,
          description: alertData.message,
          nombre_completo: formData.nombre,
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
          {step === 'login' && (
            <motion.div key="login" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex flex-col items-center justify-center min-h-[70vh]">
                <form onSubmit={handleLogin} className={cn("w-full max-w-lg p-10 rounded-[40px] border shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                    <div className="text-center mb-10">
                        <div className="w-16 h-16 bg-blue-600/10 rounded-3xl flex items-center justify-center mb-4 mx-auto">
                            <Lock className="w-8 h-8 text-blue-600" />
                        </div>
                        <h2 className="text-2xl font-black uppercase tracking-tight">Acceso Estudiante</h2>
                        <p className="text-xs text-neutral-500 font-medium">Completa tus datos para iniciar el monitoreo.</p>
                    </div>

                    <div className="space-y-4 mb-8">
                        <div className="relative">
                            <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                            <input 
                                required
                                type="text" 
                                placeholder="Matrícula" 
                                value={formData.matricula}
                                onChange={(e) => setFormData({...formData, matricula: e.target.value})}
                                className={cn("w-full pl-12 pr-6 py-4 rounded-2xl border-2 font-bold text-sm focus:outline-none transition-all", darkMode ? "bg-white/5 border-white/5 focus:border-blue-500 text-white" : "bg-neutral-50 border-neutral-100 focus:border-blue-500")}
                            />
                        </div>
                        <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                            <input 
                                required
                                type="text" 
                                placeholder="Nombre Completo" 
                                value={formData.nombre}
                                onChange={(e) => setFormData({...formData, nombre: e.target.value})}
                                className={cn("w-full pl-12 pr-6 py-4 rounded-2xl border-2 font-bold text-sm focus:outline-none transition-all", darkMode ? "bg-white/5 border-white/5 focus:border-blue-500 text-white" : "bg-neutral-50 border-neutral-100 focus:border-blue-500")}
                            />
                        </div>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                            <input 
                                required
                                type="email" 
                                placeholder="Correo Institucional" 
                                value={formData.correo}
                                onChange={(e) => setFormData({...formData, correo: e.target.value})}
                                className={cn("w-full pl-12 pr-6 py-4 rounded-2xl border-2 font-bold text-sm focus:outline-none transition-all", darkMode ? "bg-white/5 border-white/5 focus:border-blue-500 text-white" : "bg-neutral-50 border-neutral-100 focus:border-blue-500")}
                            />
                        </div>
                        <div className="relative">
                            <ShieldAlert className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                            <input 
                                required
                                type="text" 
                                placeholder="PIN de la Sala" 
                                value={formData.pin}
                                onChange={(e) => setFormData({...formData, pin: e.target.value.toUpperCase()})}
                                className={cn("w-full pl-12 pr-6 py-4 rounded-2xl border-2 font-black text-lg focus:outline-none transition-all tracking-[0.2em]", darkMode ? "bg-white/5 border-white/5 focus:border-blue-500 text-white" : "bg-neutral-50 border-neutral-100 focus:border-blue-500")}
                            />
                        </div>
                    </div>

                    <button type="submit" disabled={loading} className="w-full py-5 bg-blue-600 text-white rounded-[24px] font-black shadow-xl shadow-blue-500/25 hover:scale-[1.02] active:scale-98 transition-all disabled:opacity-50">
                        {loading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : "ACCEDER AL EXAMEN"}
                    </button>
                </form>
            </motion.div>
          )}

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
            <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col lg:flex-row gap-8 h-[75vh]">
              <div className={cn("flex-1 rounded-[40px] border overflow-hidden relative flex flex-col shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                <div className="px-10 py-6 border-b border-neutral-100 dark:border-white/5 flex items-center justify-between">
                    <div>
                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-1 block">Examen en Curso</span>
                        <h3 className="text-lg font-black tracking-tight">{examData?.titulo}</h3>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-neutral-400">PIN: <span className="text-blue-600">{examData?.pin_sala}</span></span>
                    </div>
                </div>
                <div className="flex-1 bg-neutral-100 dark:bg-black/40 flex items-center justify-center p-12">
                    <div className={cn("w-full h-full rounded-[40px] shadow-2xl flex flex-col items-center justify-center p-16 text-center border", darkMode ? "bg-[#0d0d0d] border-white/5" : "bg-white border-neutral-100")}>
                        <div className="w-24 h-24 bg-blue-600/10 rounded-full flex items-center justify-center mb-8 relative">
                            <ShieldAlert className="w-10 h-10 text-blue-600" />
                            <div className="absolute inset-0 rounded-full border-2 border-blue-600/30 animate-ping" />
                        </div>
                        <h3 className="text-2xl font-black mb-4 uppercase tracking-tight">Centinela Activo</h3>
                        <p className="text-sm text-neutral-500 max-w-md leading-relaxed">
                            No cierres esta pestaña. El monitoreo por IA se suspenderá si cambias de ventana o apagas la cámara.
                        </p>
                    </div>
                </div>
              </div>

              <div className="w-full lg:w-96 space-y-6 shrink-0">
                <div className={cn("p-8 rounded-[40px] border shadow-xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                  <div className="w-full aspect-video bg-black rounded-[32px] overflow-hidden relative border-2 border-neutral-800 shadow-inner">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                    <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                        <span className="text-[10px] text-white font-black uppercase tracking-widest">LIVE</span>
                    </div>
                  </div>
                  
                  <div className="mt-8 pt-8 border-t border-neutral-100 dark:border-white/5">
                      <div className="flex items-center justify-between mb-6">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Señales IA</span>
                        <span className="text-[10px] font-black text-emerald-500 uppercase">Conectado</span>
                      </div>
                      <div className="space-y-4">
                          {alerts.length === 0 ? (
                              <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-600">
                                <CheckCircle2 className="w-5 h-5" />
                                <span className="text-[10px] font-black uppercase">Sin Incidencias</span>
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
