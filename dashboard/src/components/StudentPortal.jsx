import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Mic, ShieldAlert, CheckCircle2, AlertTriangle, LogOut, FileText, Loader2, Play, Lock, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CentinelaEngine } from '../lib/monitoring_engine';
import { supabase } from '../lib/supabase';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function StudentPortal({ onExit, darkMode }) {
  const [step, setStep] = useState('pin'); 
  const [pin, setPin] = useState('');
  const [examData, setExamData] = useState(null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const engineRef = useRef(null);

  const handleVerifyPin = async () => {
    if (!pin) return;
    setLoading(true);
    
    // PIN Maestro para pruebas rápidas o búsqueda en DB
    if (pin === '5700' || pin === 'ALUMNO123') {
        setExamData({ title: "Examen de Prueba - Centinela IA", questions: [{text: "Responde honestamente."}] });
        setStep('check');
        initCamera();
    } else {
        try {
            const { data } = await supabase.from('exams').select('*').eq('pin', pin.toUpperCase()).single();
            if (data) {
                setExamData(data);
                setStep('check');
                initCamera();
            } else {
                alert("PIN Inválido. Usa 5700 para probar.");
            }
        } catch (err) {
            console.error("Error verifying PIN:", err);
            alert("Error de conexión. Intenta con 5700.");
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
      alert("No se pudo acceder a la cámara. Verifica los permisos de tu navegador.");
    }
  };

  const startExam = async () => {
    setStep('active');
    
    engineRef.current = new CentinelaEngine({
      onAlert: async (alertData) => {
        setAlerts(prev => [alertData, ...prev].slice(0, 5));
        
        await supabase.from('camera_logs').insert([{
          event_type: "alerta_comportamiento",
          description: `[${alertData.type}] ${alertData.message}`,
          nombre_completo: "Estudiante Prueba",
          matricula: pin, 
          risk_score: 85,
          timestamp: new Date().toISOString()
        }]);
      }
    });

    await engineRef.current.init();
    setTimeout(() => {
        if (videoRef.current) {
            engineRef.current.start(videoRef.current);
        }
    }, 800);
  };

  const exitPortal = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (engineRef.current) engineRef.current.stop();
    onExit();
  };

  useEffect(() => {
    if (step === 'check' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [step, cameraGranted]);

  return (
    <div className={cn("min-h-screen font-sans transition-colors duration-300", darkMode ? "bg-surf-dark text-neutral-100" : "bg-[#f8f9fa] text-neutral-900")}>
      <nav className={cn("flex items-center justify-between px-8 py-5 border-b sticky top-0 z-50", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="font-black text-sm uppercase tracking-tighter block">Centinela IA</span>
            <span className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">Portal del Alumno</span>
          </div>
        </div>
        
        <button onClick={exitPortal} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-red-500 hover:bg-red-500/10 transition-all">
          <LogOut className="w-4 h-4" /> SALIR
        </button>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {step === 'pin' && (
            <motion.div key="pin" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className={cn("w-full max-w-md p-10 rounded-[40px] border shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                    <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-2xl flex items-center justify-center mb-8 mx-auto">
                        <Lock className="w-8 h-8 text-blue-600" />
                    </div>
                    <h2 className="text-2xl font-black mb-2 text-center uppercase tracking-tight">Acceso a Examen</h2>
                    <p className="text-sm text-neutral-500 mb-8 text-center">Ingresa el código PIN o 5700 para probar.</p>
                    <input 
                        type="text" 
                        placeholder="#UTC-0000" 
                        value={pin}
                        onChange={(e) => setPin(e.target.value.toUpperCase())}
                        className={cn("w-full bg-transparent border-2 rounded-2xl px-6 py-4 font-black text-2xl text-center mb-6 tracking-widest focus:outline-none transition-all", darkMode ? "border-white/5 focus:border-blue-500" : "border-neutral-100 focus:border-blue-500")}
                    />
                    <button onClick={handleVerifyPin} disabled={loading} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-500/20 hover:scale-[1.02] active:scale-98 transition-all disabled:opacity-50">
                        {loading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : "ACCEDER"}
                    </button>
                </div>
            </motion.div>
          )}

          {step === 'check' && (
            <motion.div key="check" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={cn("p-12 rounded-[48px] border", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-2xl")}>
              <h2 className="text-2xl font-black mb-10 text-center uppercase tracking-tight">Configuración de Cámara</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div className="relative group">
                  <div className="w-full aspect-video bg-black rounded-[32px] overflow-hidden relative border-4 border-neutral-200 dark:border-neutral-800 shadow-2xl">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                    {!cameraGranted && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
                            <Loader2 className="w-8 h-8 text-white animate-spin mb-4" />
                            <span className="text-xs font-black text-white uppercase tracking-widest text-center px-6">Esperando permiso de cámara...</span>
                        </div>
                    )}
                  </div>
                </div>
                
                <div className="space-y-6">
                    <CheckItem active={cameraGranted} label="Cámara Web" icon={<Camera className="w-5 h-5" />} />
                    <CheckItem active={micGranted} label="Micrófono" icon={<Mic className="w-5 h-5" />} />
                    <div className="p-6 rounded-[28px] border-2 border-blue-500/20 bg-blue-500/5">
                        <p className="text-xs font-medium text-neutral-500 leading-relaxed italic">
                          "Centinela utilizará tu cámara únicamente para verificar la integridad del examen. No se grabará video sin tu consentimiento."
                        </p>
                    </div>
                </div>
              </div>
              <div className="mt-16 flex flex-col items-center gap-4">
                <button 
                  onClick={startExam} 
                  disabled={!cameraGranted} 
                  className="px-16 py-5 bg-black dark:bg-white dark:text-black text-white rounded-[24px] text-base font-black hover:scale-[1.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-2xl"
                >
                  <Play className="inline mr-2 w-5 h-5 fill-current" /> EMPEZAR EXAMEN
                </button>
              </div>
            </motion.div>
          )}

          {step === 'active' && (
            <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col lg:flex-row gap-8 h-[70vh]">
              <div className={cn("flex-1 rounded-[40px] border overflow-hidden relative flex flex-col", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-xl")}>
                <div className="px-8 py-4 border-b border-neutral-100 dark:border-white/5 flex items-center justify-between">
                    <span className="text-xs font-black text-blue-600 uppercase tracking-widest">{examData?.title}</span>
                </div>
                <div className="flex-1 bg-neutral-200 dark:bg-black/40 flex items-center justify-center p-12">
                    <div className={cn("w-full h-full rounded-2xl shadow-2xl flex flex-col items-center justify-center p-10 text-center", darkMode ? "bg-[#181818]" : "bg-white")}>
                        <Sparkles className="w-12 h-12 text-blue-500 mb-6" />
                        <h3 className="text-xl font-black mb-4">Evaluación en Progreso</h3>
                        <p className="text-sm text-neutral-500 max-w-md">El sistema está monitoreando activamente tu comportamiento mediante IA.</p>
                        <div className="mt-10 space-y-4 w-full max-w-md text-left">
                            <div className="p-4 rounded-xl border border-neutral-100 dark:border-white/5 bg-neutral-50 dark:bg-white/5">
                                <p className="text-xs font-bold text-neutral-400 mb-2 uppercase tracking-widest">Instrucciones</p>
                                <ul className="text-xs space-y-2 list-disc pl-4 text-neutral-500">
                                  <li>Mantén tu rostro visible en todo momento.</li>
                                  <li>No utilices dispositivos móviles.</li>
                                  <li>Evita distracciones prolongadas.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
              </div>

              <div className="w-full lg:w-80 space-y-6 shrink-0">
                <div className={cn("p-6 rounded-[32px] border", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-lg")}>
                  <div className="w-full aspect-video bg-black rounded-[24px] overflow-hidden relative border-2 border-neutral-800">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[9px] text-white font-black uppercase tracking-widest">IA ACTIVA</span>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-6 border-t border-neutral-100 dark:border-white/5">
                      <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-4 block">Alertas Recientes</span>
                      <div className="space-y-3">
                          {alerts.length === 0 ? (
                              <div className="flex items-center gap-2 text-emerald-500">
                                <CheckCircle2 className="w-4 h-4" />
                                <span className="text-[10px] font-bold uppercase tracking-tight">Comportamiento Normal</span>
                              </div>
                          ) : (
                              alerts.map((a, i) => (
                                <motion.div key={i} initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-start gap-3 p-3 rounded-2xl bg-red-500/5 border border-red-500/10">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                                    <div>
                                        <span className="text-[10px] font-black text-red-600 uppercase block">{a.type}</span>
                                        <p className="text-[9px] text-neutral-500 leading-tight">{a.message}</p>
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
        <div className={cn("p-6 rounded-[28px] border-2 transition-all flex items-center justify-between", active ? "bg-emerald-500/10 border-emerald-500/20" : "bg-neutral-50 dark:bg-white/5 border-neutral-100 dark:border-white/5")}>
            <div className="flex items-center gap-4">
                <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center transition-colors", active ? "bg-emerald-500 text-white" : "bg-neutral-200 dark:bg-white/10 text-neutral-400")}>
                    {icon}
                </div>
                <span className="text-sm font-black uppercase">{label}</span>
            </div>
            {active && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
        </div>
    );
}
