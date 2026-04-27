import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, Eye, Mic, AlertCircle, AlertTriangle,
  Settings, Users, BarChart3, Search, 
  Sun, Moon, Presentation, LogOut, PlusSquare
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
  const [view, setView] = useState(() => localStorage.getItem('centinela_view') || 'landing');
  const [teacherTab, setTeacherTab] = useState(() => localStorage.getItem('centinela_tab') || 'monitor');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('centinela_dark') === 'true');

  // Guardar estado automáticamente
  useEffect(() => {
    localStorage.setItem('centinela_view', view);
    localStorage.setItem('centinela_tab', teacherTab);
    localStorage.setItem('centinela_dark', darkMode);
  }, [view, teacherTab, darkMode]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  if (view === 'landing') {
    return (
      <LoginLanding 
        onLoginTeacher={() => setView('teacher_dashboard')} 
        onLoginStudent={() => setView('student_dashboard')} 
      />
    );
  }

  if (view === 'student_dashboard') {
    return <StudentPortal onLogout={() => setView('landing')} />;
  }

  return (
    <div className={cn("min-h-screen flex transition-colors duration-300", darkMode ? "bg-surf-dark text-white" : "bg-surf-light text-neutral-900")}>
      {/* Sidebar */}
      <aside className={cn("w-72 border-r flex flex-col transition-colors", darkMode ? "border-white/10 bg-[#050505]" : "border-neutral-200 bg-white")}>
        <div className="p-8 flex items-center gap-3">
          <div className="p-2 bg-black dark:bg-white rounded-xl shadow-lg">
            <ShieldAlert className="w-5 h-5 text-white dark:text-black" />
          </div>
          <h1 className="text-lg font-black tracking-tighter uppercase">Centinela IA</h1>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2">
          <SidebarItem active={teacherTab === 'monitor'} onClick={() => setTeacherTab('monitor')} icon={<BarChart3 className="w-4 h-4" />} label="Monitoreo" dark={darkMode} />
          <SidebarItem active={teacherTab === 'creator'} onClick={() => setTeacherTab('creator')} icon={<PlusSquare className="w-4 h-4" />} label="Crear Examen" dark={darkMode} />
          <SidebarItem icon={<Users className="w-4 h-4" />} label="Estudiantes" dark={darkMode} />
          <SidebarItem icon={<Settings className="w-4 h-4" />} label="Ajustes" dark={darkMode} />
        </nav>

        <div className="p-6 border-t dark:border-white/10">
          <button onClick={() => setView('landing')} className="w-full flex items-center gap-4 px-6 py-4 text-neutral-400 hover:text-red-500 transition-colors font-black text-xs uppercase tracking-widest">
            <LogOut className="w-4 h-4" /> Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className={cn("h-24 border-b flex items-center justify-between px-10 transition-colors", darkMode ? "border-white/10 bg-[#050505]/50 backdrop-blur-xl" : "border-neutral-200 bg-white/50 backdrop-blur-xl")}>
          <div className="relative w-96">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input type="text" placeholder="Buscar registros..." className={cn("w-full pl-12 pr-4 py-3 rounded-2xl text-sm transition-all focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white", darkMode ? "bg-white/5 border-white/10" : "bg-neutral-100 border-transparent")} />
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setDarkMode(!darkMode)} className={cn("p-3 rounded-2xl border transition-all hover:scale-105 active:scale-95", darkMode ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white shadow-sm")}>
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/20" />
          </div>
        </header>

        <div>
          {teacherTab === 'monitor' && <MonitorView darkMode={darkMode} />}
          {teacherTab === 'creator' && <MagicExamCreator darkMode={darkMode} />}
        </div>
      </main>
    </div>
  );
}

function MonitorView({ darkMode }) {
  const [logs, setLogs] = useState([]);

  const fetchLogs = async () => {
    try {
      const { data, error } = await supabase.from('camera_logs').select('*').order('timestamp', { ascending: false }).limit(100);
      if (!error) setLogs(data || []);
    } catch (e) {
      console.error("Error fetching logs:", e);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-10 space-y-8">
      <div className="grid grid-cols-4 gap-6">
        <KpiCard title="Alertas Críticas" value={logs.filter(l => l.risk_score >= 80).length} icon={<AlertCircle className="w-5 h-5 text-red-500" />} dark={darkMode} />
        <KpiCard title="Avisos (Amarillo)" value={logs.filter(l => l.risk_score > 40 && l.risk_score < 80).length} icon={<AlertTriangle className="w-5 h-5 text-yellow-500" />} dark={darkMode} />
        <KpiCard title="IA Visión" value={logs.filter(l => l.event_type?.includes('vision')).length} icon={<Eye className="w-5 h-5 text-blue-500" />} dark={darkMode} />
        <KpiCard title="Estado Sistema" value="ACTIVO" icon={<div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(234,179,8,0.5)]" />} dark={darkMode} />
      </div>

      <div className={cn("rounded-[32px] border shadow-2xl overflow-hidden", darkMode ? "border-white/10 bg-[#111111]" : "border-neutral-200 bg-white")}>
        <table className="w-full text-left">
          <thead className={cn("border-b text-[10px] uppercase tracking-widest font-black text-neutral-500", darkMode ? "border-white/10 bg-white/5" : "bg-neutral-50")}>
            <tr>
              <th className="px-8 py-5">Estudiante</th>
              <th className="px-8 py-5">Evento</th>
              <th className="px-8 py-5">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-white/5">
            {logs.map(log => {
              const isCritical = (log.risk_score || 0) >= 80;
              const isWarning = (log.risk_score || 0) > 40 && (log.risk_score || 0) < 80;
              
              return (
                <tr key={log.id} className="text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-white/5">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-2 h-2 rounded-full", isCritical ? "bg-red-500" : isWarning ? "bg-yellow-500" : "bg-emerald-500")} />
                      <span className="font-bold">{log.nombre_completo || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                      isCritical ? "bg-red-500/10 text-red-500 border border-red-500/20" : 
                      isWarning ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20" : 
                      "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                    )}>
                      {log.event_type?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-neutral-500 font-medium">{new Date(log.timestamp).toLocaleString()}</td>
                </tr>
              );
            })}
            {logs.length === 0 && (
              <tr>
                <td colSpan="3" className="px-8 py-20 text-center text-neutral-400 font-medium italic">
                  No hay alertas registradas recientemente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon, dark }) {
  return (
    <div className={cn("p-6 rounded-[24px] border shadow-sm transition-all", dark ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{title}</span>
        {icon}
      </div>
      <div className="text-3xl font-black tracking-tighter">{value}</div>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, dark }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all font-black text-sm uppercase tracking-tighter", 
      active ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "text-neutral-500 hover:bg-white/5" : "text-neutral-400 hover:bg-neutral-100"))}>
      {icon}
      {label}
    </button>
  );
}
