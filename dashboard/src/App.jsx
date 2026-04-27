import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, AlertCircle, AlertTriangle,
  Users, BarChart3, Search, Settings,
  Sun, Moon, Presentation, LogOut, PlusSquare, Trash2,
  Activity, Video, Clock, ChevronRight, Mic
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './lib/supabase';
import LoginLanding from './components/LoginLanding';
import MagicExamCreator from './components/MagicExamCreator';
import StudentPortal from './components/StudentPortal';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [view, setView] = useState('landing');
  const [teacherTab, setTeacherTab] = useState(() => localStorage.getItem('centinela_tab') || 'monitor');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('centinela_dark') === 'true');

  useEffect(() => {
    localStorage.setItem('centinela_tab', teacherTab);
    localStorage.setItem('centinela_dark', darkMode);
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [teacherTab, darkMode]);

  const handleLogout = () => {
    setView('landing');
  };

  if (view === 'landing') {
    return (
      <LoginLanding 
        onLoginTeacher={() => setView('teacher_dashboard')} 
        onLoginStudent={() => setView('student_dashboard')} 
      />
    );
  }

  if (view === 'student_dashboard') {
    return <StudentPortal onExit={handleLogout} darkMode={darkMode} />;
  }

  return (
    <div className={cn("min-h-screen flex transition-colors duration-300", darkMode ? "bg-surf-dark text-white" : "bg-[#f8f9fa] text-neutral-900")}>
      {/* Sidebar */}
      <aside className={cn("w-72 border-r flex flex-col transition-all duration-500", darkMode ? "border-white/10 bg-[#050505]" : "border-neutral-200 bg-white")}>
        <div className="p-10 flex items-center gap-4">
          <div className="p-2.5 bg-blue-600 rounded-2xl shadow-xl shadow-blue-600/20">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-black tracking-tighter uppercase text-black dark:text-white">Centinela IA</h1>
        </div>

        <nav className="flex-1 px-6 py-4 space-y-2">
          <SidebarItem active={teacherTab === 'monitor'} onClick={() => setTeacherTab('monitor')} icon={<BarChart3 className="w-4 h-4" />} label="Monitoreo" dark={darkMode} />
          <SidebarItem active={teacherTab === 'creator'} onClick={() => setTeacherTab('creator')} icon={<PlusSquare className="w-4 h-4" />} label="Crear Examen" dark={darkMode} />
          <SidebarItem icon={<Users className="w-4 h-4" />} label="Estudiantes" dark={darkMode} />
          <SidebarItem icon={<Settings className="w-4 h-4" />} label="Ajustes" dark={darkMode} />
        </nav>

        <div className="p-8 border-t dark:border-white/10">
          <button onClick={handleLogout} className="w-full flex items-center gap-4 px-6 py-4 text-neutral-400 hover:text-red-500 transition-colors font-black text-xs uppercase tracking-widest">
            <LogOut className="w-4 h-4" /> Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className={cn("h-28 border-b flex items-center justify-between px-12 transition-all duration-500", darkMode ? "border-white/10 bg-[#050505]/50 backdrop-blur-3xl" : "border-neutral-200 bg-white/50 backdrop-blur-3xl")}>
          <div className="relative w-[450px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input type="text" placeholder="Buscar por PIN o Matrícula..." className={cn("w-full pl-14 pr-6 py-4 rounded-[24px] text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-blue-600/50", darkMode ? "bg-white/5 border-white/10 text-white" : "bg-neutral-100 border-transparent text-neutral-900")} />
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => setDarkMode(!darkMode)} className={cn("p-4 rounded-[22px] border transition-all hover:scale-105 active:scale-95 shadow-sm", darkMode ? "border-white/10 bg-white/5 text-yellow-400" : "border-neutral-200 bg-white text-blue-600")}>
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="w-12 h-12 rounded-[22px] bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-xl shadow-blue-600/20 flex items-center justify-center font-black text-white text-xs">AD</div>
          </div>
        </header>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {teacherTab === 'monitor' && <MonitorView darkMode={darkMode} />}
          {teacherTab === 'creator' && <MagicExamCreator darkMode={darkMode} onComplete={() => setTeacherTab('monitor')} />}
        </div>
      </main>
    </div>
  );
}

function MonitorView({ darkMode }) {
  const [logs, setLogs] = useState([]);
  const [activeExams, setActiveExams] = useState([]);
  const [studentStatus, setStudentStatus] = useState({});
  const [filterPin, setFilterPin] = useState(null);

  const fetchData = async () => {
    try {
      const { data: logData } = await supabase
        .from('camera_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      setLogs(logData || []);

      const status = {};
      (logData || []).forEach(log => {
        if (!status[log.matricula]) {
          status[log.matricula] = {
            nombre: log.nombre_completo,
            matricula: log.matricula,
            ultimo_evento: log.event_type,
            fecha: log.created_at,
            alerta: log.event_type?.includes('OBJETO') || log.event_type?.includes('sospechoso') || log.event_type?.includes('GAZE'),
            pin_sala: log.pin_sala,
            lastUpdate: Date.now()
          };
        }
      });
      setStudentStatus(status);

      const { data: examData, error: examError } = await supabase.from('exams')
        .select('id, pin_sala, titulo, created_at')
        .order('created_at', { ascending: false });
      
      const localExams = JSON.parse(localStorage.getItem('active_exams') || '[]');
      
      // Combinar y eliminar duplicados por PIN
      const combined = [...(examData || [])];
      localExams.forEach(local => {
        if (!combined.find(e => e.pin_sala === local.pin_sala)) {
          combined.push(local);
        }
      });

      setActiveExams(combined);
      if (examError) console.warn("Note: Could not fetch all exams from DB, using local cache.");
    } catch (e) {
      console.error("Error fetching data:", e);
      const localExams = JSON.parse(localStorage.getItem('active_exams') || '[]');
      setActiveExams(localExams);
    }
  };

  const handleDeleteExam = async (pin) => {
    const confirmMsg = pin ? `¿Seguro que quieres eliminar la sala ${pin}?` : "¿Seguro que quieres eliminar esta sala corrupta?";
    if (!window.confirm(confirmMsg)) return;
    
    try {
      console.log("Intentando eliminar sala:", pin);
      
      // 1. Eliminar de Supabase (si hay PIN)
      if (pin) {
        try {
          await supabase.from('exams').delete().eq('pin_sala', pin);
        } catch (e) {
          console.warn("Supabase delete failed:", e);
        }
      }

      // 2. Eliminar de localStorage (usando PIN o filtrando corruptos)
      const localExams = JSON.parse(localStorage.getItem('active_exams') || '[]');
      const filtered = localExams.filter(e => {
        if (!pin) return e.pin_sala; // Si no hay pin buscado, mantenemos los que si tienen
        return String(e.pin_sala) !== String(pin);
      });
      
      // Si el pin era nulo/vacio, eliminamos el primer elemento sin pin para limpiar basura
      if (!pin) {
        const firstCorruptIndex = localExams.findIndex(e => !e.pin_sala);
        if (firstCorruptIndex > -1) localExams.splice(firstCorruptIndex, 1);
        localStorage.setItem('active_exams', JSON.stringify(localExams));
        setActiveExams([...localExams]);
      } else {
        localStorage.setItem('active_exams', JSON.stringify(filtered));
        setActiveExams(filtered);
      }

      if (filterPin === pin) setFilterPin(null);
      
      fetchData();
      alert("Sala eliminada correctamente.");
    } catch (err) {
      console.error("Error deleting exam:", err);
      alert("No se pudo eliminar la sala. Reintenta.");
    }
  };

  useEffect(() => {
    fetchData();

    // Suscripción Realtime a la tabla de logs
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'camera_logs' },
        (payload) => {
          const log = payload.new;
          setLogs(prev => [log, ...prev].slice(0, 100));
          setStudentStatus(prev => ({
            ...prev,
            [log.matricula]: {
              nombre: log.nombre_completo,
              matricula: log.matricula,
              ultimo_evento: log.event_type,
              fecha: log.created_at,
              alerta: log.event_type?.includes('OBJETO') || log.event_type?.includes('sospechoso') || log.event_type?.includes('GAZE'),
              pin_sala: log.pin_sala,
              lastUpdate: Date.now() // Forzar refresco de imagen
            }
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-12 space-y-12">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <KpiCard title="Alertas Críticas" value={logs.filter(l => l.event_type?.includes('OBJETO') || l.event_type?.includes('sospechoso')).length} icon={<AlertCircle className="w-6 h-6 text-red-500" />} dark={darkMode} color="red" />
        <KpiCard title="Avisos Sistema" value={logs.filter(l => l.event_type?.includes('MIRADA') || l.event_type?.includes('AUSENCIA')).length} icon={<AlertTriangle className="w-6 h-6 text-yellow-500" />} dark={darkMode} color="yellow" />
        <KpiCard title="Alumnos en Línea" value={Object.keys(studentStatus).length} icon={<Users className="w-6 h-6 text-blue-500" />} dark={darkMode} color="blue" />
        <KpiCard title="Salas Activas" value={activeExams.length} icon={<Presentation className="w-6 h-6 text-purple-500" />} dark={darkMode} color="purple" />
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500 flex items-center gap-3">
                <Activity className="w-4 h-4 text-blue-600" /> 
                {filterPin ? `Monitoreando Sala: ${filterPin}` : "Mapeo de Señales en Vivo"}
            </h3>
            <div className="flex gap-4">
              {filterPin && (
                <button 
                  onClick={() => setFilterPin(null)}
                  className="px-4 py-1.5 rounded-full bg-neutral-100 dark:bg-white/10 text-[10px] font-black uppercase tracking-widest border dark:border-white/10 hover:bg-neutral-200 dark:hover:bg-white/20 transition-all"
                >
                  Ver Todos
                </button>
              )}
              <span className="px-4 py-1.5 rounded-full bg-blue-600/10 text-blue-600 text-[10px] font-black uppercase tracking-widest animate-pulse border border-blue-600/20">Sincronizado</span>
            </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {Object.values(studentStatus)
            .filter(student => !filterPin || student.pin_sala === filterPin)
            .map(student => (
            <div key={student.matricula} className={cn("p-8 rounded-[40px] border group transition-all hover:shadow-2xl relative", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-xl")}>
              {/* Visualización de Cámara en Vivo */}
              <div className="relative aspect-video rounded-3xl overflow-hidden mb-6 bg-neutral-900 shadow-inner group-hover:shadow-2xl transition-all duration-500">
                <img 
                  src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/snapshots/${student.matricula}.jpg?t=${student.lastUpdate}`}
                  className="w-full h-full object-cover"
                  alt="Live feed"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                  }}
                />
                <div className="hidden absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 text-neutral-500 gap-2">
                  <Video className="w-6 h-6 opacity-20" />
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Sin Señal</span>
                </div>
                
                {/* Overlay Indicators */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                  <div className="flex gap-1.5">
                    {student.alerta && (
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                    )}
                    <div className="px-2 py-1 bg-black/40 backdrop-blur-md rounded-lg text-[8px] font-black text-white uppercase tracking-widest border border-white/10">
                      LIVE
                    </div>
                  </div>
                  {student.ultimo_evento?.includes('AUDIO') && (
                    <div className="p-1.5 bg-red-600 rounded-lg shadow-lg">
                      <Mic className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs", student.alerta ? "bg-red-500 text-white" : "bg-blue-600 text-white shadow-lg shadow-blue-600/20")}>
                      {student.nombre?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-black uppercase tracking-tight truncate">{student.nombre}</h4>
                    <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">{student.matricula}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                   <button 
                      onClick={async () => {
                        const { error } = await supabase.from('commands').insert({
                          matricula: student.matricula,
                          command: 'ALERTA',
                          payload: { message: 'Por favor mantén la vista en el examen.' }
                        });
                        if (!error) alert("Advertencia enviada");
                      }}
                      className="p-2 bg-yellow-500/10 text-yellow-600 rounded-xl hover:bg-yellow-500 hover:text-white transition-all shadow-sm" title="Enviar Advertencia">
                      <ShieldAlert className="w-3.5 h-3.5" />
                   </button>
                   <button 
                      onClick={async () => {
                        if(confirm(`¿Expulsar a ${student.nombre}?`)) {
                          await supabase.from('commands').insert({
                            matricula: student.matricula,
                            command: 'EXPULSAR'
                          });
                        }
                      }}
                      className="p-2 bg-red-500/10 text-red-600 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-sm" title="Expulsar Estudiante">
                      <Trash2 className="w-3.5 h-3.5" />
                   </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <span className={cn("px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border", 
                      student.alerta ? "bg-red-600 text-white border-red-400" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20")}>
                        {student.ultimo_evento?.replace('_', ' ') || 'Normal'}
                    </span>
                    <span className="text-[9px] px-3 py-1.5 bg-neutral-100 dark:bg-white/5 rounded-full text-neutral-400 font-black uppercase tracking-widest border dark:border-white/5">{student.pin_sala}</span>
                </div>
                
                <div className="pt-6 border-t dark:border-white/5 mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest">{new Date(student.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <button 
                      onClick={() => {
                        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/snapshots/${student.matricula}.jpg?t=${Date.now()}`;
                        window.open(url, '_blank');
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg shadow-blue-600/20">
                      Ampliar <ChevronRight className="w-3 h-3" />
                    </button>
                </div>
              </div>
            </div>
          ))}
          {Object.keys(studentStatus).length === 0 && (
            <div className="col-span-full py-20 text-center border-2 border-dashed rounded-[40px] border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5">
                <Users className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
                <p className="text-xs font-black text-neutral-400 uppercase tracking-widest">Esperando conexión de alumnos...</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-8">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500">Exámenes Activos</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {activeExams.map(exam => (
                    <div key={exam.id} className={cn("p-10 rounded-[40px] border group transition-all hover:shadow-2xl", darkMode ? "bg-[#111111] border-white/10 hover:border-blue-500/50" : "bg-white border-neutral-200")}>
                        <div className="flex items-center justify-between mb-10">
                            <div className="px-6 py-2 bg-blue-600 text-white text-[10px] font-black rounded-2xl uppercase tracking-[0.2em] shadow-lg shadow-blue-600/20">{exam.pin_sala}</div>
                            <button 
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDeleteExam(exam.pin_sala);
                                }}
                                className="p-3 rounded-2xl bg-red-500 text-white shadow-lg shadow-red-500/20 transition-all hover:scale-110 active:scale-95 cursor-pointer z-30"
                                title="Eliminar Sala"
                            >
                                <Trash2 className="w-5 h-5 pointer-events-none" />
                            </button>
                        </div>
                        <h4 className="text-xl font-black mb-2 uppercase tracking-tight">{exam.titulo}</h4>
                        <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest mb-10">Creado: {new Date(exam.created_at).toLocaleDateString()}</p>
                        
                        <div className="flex items-center justify-between">
                            <div className="flex -space-x-3">
                                {[1,2,3].map(i => <div key={i} className="w-10 h-10 rounded-2xl bg-neutral-200 dark:bg-neutral-800 border-4 border-white dark:border-[#111111]" />)}
                            </div>
                            <button 
                              onClick={() => {
                                setFilterPin(exam.pin_sala);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className={cn("px-6 py-2 rounded-2xl text-[10px] font-black uppercase transition-all", 
                                filterPin === exam.pin_sala ? "bg-blue-600 text-white shadow-lg" : "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20")}
                            >
                              {filterPin === exam.pin_sala ? "Gestionando..." : "Gestionar Sala"}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>

        <div className="space-y-8">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500">Alertas Recientes</h3>
            <div className={cn("rounded-[40px] border overflow-hidden flex flex-col h-[600px]", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-xl")}>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {logs.map(log => {
                        const critical = log.event_type?.includes('OBJETO') || log.event_type?.includes('sospechoso');
                        return (
                            <div key={log.id} className={cn("p-6 rounded-[28px] border-2 transition-all", critical ? "bg-red-500/10 border-red-500/20" : (darkMode ? "bg-white/5 border-white/5" : "bg-neutral-50 border-neutral-100"))}>
                                <div className="flex items-center justify-between mb-4">
                                    <span className={cn("text-[10px] font-black uppercase tracking-widest", critical ? "text-red-600" : "text-blue-600")}>{log.event_type?.replace('_', ' ')}</span>
                                    <span className="text-[9px] font-bold text-neutral-400 uppercase">{new Date(log.created_at).toLocaleTimeString()}</span>
                                </div>
                                <h5 className="text-xs font-black mb-1 uppercase">{log.nombre_completo}</h5>
                                <p className="text-[10px] text-neutral-500 font-medium leading-relaxed">{log.description}</p>
                            </div>
                        );
                    })}
                    {logs.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 italic py-20">
                            <Clock className="w-8 h-8 mb-2" />
                            <span className="text-xs font-black uppercase tracking-widest">Sin registros</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon, dark, color }) {
  const colors = {
    red: "from-red-600/20 to-transparent",
    yellow: "from-yellow-600/20 to-transparent",
    blue: "from-blue-600/20 to-transparent",
    purple: "from-purple-600/20 to-transparent"
  };
  return (
    <div className={cn("p-10 rounded-[48px] border shadow-xl relative overflow-hidden transition-all hover:scale-[1.05] hover:shadow-2xl", dark ? "bg-[#111111] border-white/10" : "bg-white border-neutral-100")}>
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-20", colors[color])} />
      <div className="relative z-10 flex items-center justify-between mb-8">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">{title}</span>
        <div className={cn("p-4 rounded-3xl", dark ? "bg-white/5" : "bg-neutral-50 shadow-inner")}>{icon}</div>
      </div>
      <div className="relative z-10 text-5xl font-black tracking-tighter">{value}</div>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, dark }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-5 px-8 py-5 rounded-[22px] transition-all font-black text-[13px] uppercase tracking-tighter", 
      active ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : (dark ? "text-neutral-500 hover:bg-white/5 hover:text-white" : "text-neutral-400 hover:bg-neutral-100 hover:text-black"))}>
      {icon}
      {label}
    </button>
  );
}
