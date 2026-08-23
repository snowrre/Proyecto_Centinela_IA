import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, AlertCircle, AlertTriangle,
  Users, BarChart3, Search, Settings,
  Sun, Moon, Presentation, LogOut, PlusSquare, Trash2,
  Activity, Video, Clock, ChevronRight, Mic,
  MonitorSmartphone, Laptop
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './lib/supabase';
import LoginLanding from './components/LoginLanding';
import MarketingLanding from './components/MarketingLanding';
import MagicExamCreator from './components/MagicExamCreator';
import StudentPortal from './components/StudentPortal';
import AdminDashboard from './components/AdminDashboard';
import BiometricAuth from './components/BiometricAuth';
import EnrolamientoFacial from './components/EnrolamientoFacial';
import ValidacionINE from './components/ValidacionINE';
import VerificacionRostroAWS from './components/VerificacionRostroAWS';
import TerminosYPrivacidad from './components/TerminosYPrivacidad';
import ProcesarPago from './components/ProcesarPago';
import RegistroCampus from './components/RegistroCampus';
import RegistroAlumno from './components/RegistroAlumno';
import { useBiometric } from './context/BiometricContext';
import { Toaster } from 'react-hot-toast';
import { useDeviceRestriction } from './hooks/useDeviceRestriction';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [view, setView] = useState(() => {
    if (window.location.pathname === '/exito' || window.location.pathname === '/registro-campus') {
      return 'exito';
    }
    // Si venimos de Stripe (después del pago), mostramos el componente de procesamiento
    if (new URLSearchParams(window.location.search).get('session_id')) {
      return 'procesar_pago';
    }

    try {
      if (localStorage.getItem('centinela_teacher') === 'true') {
        return 'teacher_dashboard';
      }
      if (localStorage.getItem('centinela_session')) {
        return 'student_portal';
      }
    } catch (e) {
      // Ignorar errores de localStorage
    }

    return 'marketing';
  });
  const [teacherTab, setTeacherTab] = useState(() => localStorage.getItem('centinela_tab') || 'monitor');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('centinela_dark') === 'true');

  // ── Restricción de dispositivo móvil ─────────────────────────────────────
  // Se evalúa UNA sola vez al montar. isChecking evita un flash del contenido
  // mientras la detección corre (es síncrona, pero React batchea el primer render).
  const { isMobile, isChecking } = useDeviceRestriction();

  // Contexto biométrico — para limpiar el rostroMaestro en logout
  const { clearBiometric } = useBiometric();

  useEffect(() => {
    localStorage.setItem('centinela_tab', teacherTab);
    localStorage.setItem('centinela_dark', darkMode);
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [teacherTab, darkMode]);

  const [studentData, setStudentData] = useState(() => {
    const session = localStorage.getItem('centinela_session');
    try { return session ? JSON.parse(session) : null; } catch(e) { return null; }
  });
  // Guarda el File de la INE para passarlo a AWS Rekognition en el siguiente paso
  const [fotoIneFile, setFotoIneFile] = useState(null);

  const handleLogout = () => {
    setView('landing');
    setStudentData(null);
    clearBiometric(); // Limpiar descriptor facial en memoria al cerrar sesión
    // Ghost-Session Fix: borrar la sesión del localStorage para que el ex-alumno
    // no quede "fantasma" disparando alertas desde el Login si vuelve a la app.
    localStorage.removeItem('centinela_session');
    localStorage.removeItem('centinela_teacher');
  };

  // ── PANTALLA DE BLOQUEO: Dispositivo no permitido ───────────────────────
  // Se muestra antes de cualquier otra vista para que el alumno nunca vea
  // ni un frame del contenido del examen desde su teléfono.
  if (isChecking) {
    // Pantalla en blanco mínima mientras se detecta el dispositivo.
    // Dura <1ms en la práctica (es código síncrono), pero evita el flash.
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />
    );
  }

  if (isMobile) {
    return <MobileBlockScreen />;
  }

  if (view === 'exito') {
    return <RegistroCampus />;
  }

  if (view === 'marketing') {
    return <MarketingLanding onGoToLogin={() => setView('landing')} />;
  }

  if (view === 'procesar_pago') {
    const pendingClientId = localStorage.getItem('centinela_pending_client_id');
    return (
      <ProcesarPago 
        clientId={pendingClientId} 
        onVerificationSuccess={(datos) => {
          // Limpiar estado temporal y limpiar URL sin recargar
          localStorage.removeItem('centinela_pending_client_id');
          window.history.replaceState({}, document.title, window.location.pathname.split('?')[0]);
          // Mandamos al usuario al login (o directamente al dashboard si estuviera auto-logueado)
          setView('landing');
        }} 
      />
    );
  }

  if (view === 'landing') {
    return (
      <LoginLanding 
        onLoginTeacher={() => {
          localStorage.setItem('centinela_teacher', 'true');
          setView('teacher_dashboard');
        }}
        // Botón "¿No tienes cuenta?" redirige al flujo KYC completo
        onGoToRegister={() => setView('registro_alumno')}
        onLoginStudent={async (data) => {
          setStudentData(data);

          // Guardar sesión en localStorage para persistencia
          const sessionData = {
            ...data,
            timestamp: new Date().toISOString()
          };
          localStorage.setItem('centinela_session', JSON.stringify(sessionData));

          // 🚦 PRIMER PASO SIEMPRE: mostrar aviso de privacidad y términos
          // El semáforo de enrolamiento se activa solo DESPUÉS de aceptar.
          setView('terminos');

          // Registrar la conexión en Supabase
          try {
            await supabase.from('camera_logs').insert([{
              pin_sala: data.roomCode || data.pin,
              event_type: 'CONEXIÓN_ACTIVA',
              description: 'El alumno ha ingresado a la sala y está activo.',
              matricula: data.matricula,
              nombre_completo: data.matricula,
              created_at: new Date().toISOString()
            }]);
          } catch(err) {
            console.error('Error registrando conexión:', err);
          }
        }} 
      />
    );
  }

  // ── 🆕 REGISTRO KYC COMPLETO (nuevo alumno) ───────────────────────────────
  if (view === 'registro_alumno') {
    return (
      <RegistroAlumno
        darkMode={darkMode}
        onExito={(datos) => {
          // Cuenta creada con éxito ✓ — volvemos al login para que entre con su matrícula
          import('react-hot-toast').then(({ default: toast }) =>
            toast.success(`¡Bienvenido, ${datos.nombre}! Ya puedes iniciar sesión con tu matrícula.`)
          );
          setView('landing');
        }}
      />
    );
  }

  // ── ⚖️ AVISO DE PRIVACIDAD Y TÉRMINOS (aparece siempre antes de la cámara) ──
  if (view === 'terminos') {
    return (
      <TerminosYPrivacidad
        darkMode={darkMode}
        studentName={studentData?.nombre_completo || studentData?.matricula}
        onAccept={() => {
          // Términos aceptados ✔
          const kycListo = studentData?.kyc_completado === true;
          const biometriaLista = studentData?.biometria_registrada === true;

          if (kycListo && biometriaLista) {
            // Ya tiene todo: va directo al examen con cámara en vivo
            setView('biometric_auth');
          } else if (kycListo && !biometriaLista) {
            // Pasó el INE pero le falta enrolar su rostro
            setView('enrolamiento_facial');
          } else {
            // Primera vez: empieza desde validar el INE
            setView('validacion_ine');
          }
        }}
        onReject={() => {
          // Rechazó los términos — volver al login y limpiar la sesión
          setStudentData(null);
          localStorage.removeItem('centinela_session');
          setView('landing');
        }}
      />
    );
  }

  // ── 🛂 PASO 1: Validación OCR de INE ──────────────────────────────────────
  if (view === 'validacion_ine') {
    return (
      <ValidacionINE
        idAlumno={studentData?.id}
        darkMode={darkMode}
        onSuccess={({ nombre, archivoIne }) => {
          // INE leída ✓ — guardamos el File y avanzamos a la comparación facial
          setFotoIneFile(archivoIne);
          setView('verificacion_rostro_aws');
        }}
      />
    );
  }

  // ── 🤖 PASO 2: Face Match con AWS Rekognition ─────────────────────────────
  if (view === 'verificacion_rostro_aws') {
    return (
      <VerificacionRostroAWS
        fotoIne={fotoIneFile}
        darkMode={darkMode}
        onExito={() => {
          // Face match exitoso ✓ — ahora enrolamos la huella biométrica
          setFotoIneFile(null); // Liberar memoria
          setView('enrolamiento_facial');
        }}
      />
    );
  }

  // ── 🔴 SEMÁFORO: Enrolamiento Facial (primer uso) ─────────────────────────
  // Se muestra SOLO si el alumno tiene biometria_registrada === false.
  // Una vez que guarda su huella en Supabase, actualiza el estado local
  // y lo redirige automáticamente a la prueba de vida biométrica.
  if (view === 'enrolamiento_facial') {
    return (
      <EnrolamientoFacial
        correoInstitucional={studentData?.correo}
        matricula={studentData?.matricula}
        darkMode={darkMode}
        onSuccess={() => {
          // Huella guardada ✓ — actualizamos estado local para que el semáforo
          // se ponga en verde y mandamos al flujo normal de prueba de vida.
          setStudentData(prev => ({ ...prev, biometria_registrada: true }));
          setView('biometric_auth');
        }}
        onError={(motivo) => {
          console.error('[App] Error en EnrolamientoFacial:', motivo);
        }}
      />
    );
  }

  // ── 🟢 VISTA: Prueba de Vida Biométrica (alumno ya enrolado) ───────────────
  if (view === 'biometric_auth') {
    return (
      <BiometricAuth
        darkMode={darkMode}
        studentInfo={studentData}
        onSuccess={() => {
          // Prueba de vida superada → continuar al portal del examen
          setView('student_dashboard');
        }}
        onError={(err) => {
          console.error('[App] Error en BiometricAuth:', err);
          // En caso de error irrecuperable, volver al login
          // (el componente ya muestra el mensaje de error con opción de recargar)
        }}
      />
    );
  }

  if (view === 'student_dashboard') {
    return <StudentPortal onExit={handleLogout} darkMode={darkMode} studentData={studentData} />;
  }

  return (
    <div className={cn("min-h-screen flex transition-colors duration-300", darkMode ? "bg-surf-dark text-white" : "bg-[#f8f9fa] text-neutral-900")}>
      <Toaster 
        position="top-center"
        toastOptions={{
          className: '!rounded-2xl !shadow-lg !font-bold text-sm tracking-tight',
          style: {
            background: darkMode ? '#111' : '#fff',
            color: darkMode ? '#fff' : '#000',
            border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.05)',
            padding: '16px 24px',
          }
        }}
      />
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
          {/* <SidebarItem icon={<Users className="w-4 h-4" />} label="Estudiantes" dark={darkMode} /> */}
          {/* <SidebarItem icon={<Settings className="w-4 h-4" />} label="Ajustes" dark={darkMode} /> */}
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
          {teacherTab === 'monitor' && <AdminDashboard darkMode={darkMode} />}
          {teacherTab === 'creator' && <MagicExamCreator darkMode={darkMode} onComplete={() => setTeacherTab('monitor')} />}
        </div>
      </main>
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

// ── PANTALLA DE BLOQUEO PARA DISPOSITIVOS MÓVILES ────────────────────────────
// Componente independiente para que App() no incluya su JSX en el bundle crítico.
function MobileBlockScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #0f0f1a 50%, #0a0a0a 100%)',
        padding: '24px',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Glow de fondo decorativo */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(239,68,68,0.08) 0%, transparent 70%)',
      }} />

      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: '28px',
        padding: '48px 36px',
        textAlign: 'center',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 0 60px rgba(239,68,68,0.08), 0 32px 64px rgba(0,0,0,0.5)',
        position: 'relative',
      }}>

        {/* Ícono principal */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '80px',
          height: '80px',
          borderRadius: '24px',
          background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.05))',
          border: '1px solid rgba(239,68,68,0.3)',
          marginBottom: '28px',
          boxShadow: '0 0 40px rgba(239,68,68,0.15)',
        }}>
          <MonitorSmartphone size={38} color="#f87171" strokeWidth={1.5} />
        </div>

        {/* Badge de estado */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '100px',
          padding: '6px 16px',
          marginBottom: '20px',
        }}>
          <div style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: '#ef4444',
            boxShadow: '0 0 8px #ef4444',
            animation: 'pulse 2s infinite',
          }} />
          <span style={{ color: '#f87171', fontSize: '11px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Acceso Denegado
          </span>
        </div>

        {/* Título */}
        <h1 style={{
          color: '#ffffff',
          fontSize: '22px',
          fontWeight: 900,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          marginBottom: '12px',
        }}>
          Dispositivo no compatible
        </h1>

        {/* Mensaje principal */}
        <p style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: '14px',
          lineHeight: 1.6,
          marginBottom: '32px',
        }}>
          El sistema de supervisión biométrica <strong style={{ color: 'rgba(255,255,255,0.75)' }}>Centinela IA</strong> requiere acceso desde una computadora de escritorio o laptop con cámara web.
        </p>

        {/* Separador */}
        <div style={{
          height: '1px',
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent)',
          marginBottom: '28px',
        }} />

        {/* Requisito visual */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '16px 20px',
          textAlign: 'left',
        }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0,
            background: 'rgba(59,130,246,0.15)',
            border: '1px solid rgba(59,130,246,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Laptop size={22} color="#60a5fa" strokeWidth={1.5} />
          </div>
          <div>
            <p style={{ color: '#ffffff', fontSize: '13px', fontWeight: 700, marginBottom: '2px' }}>
              Usa tu computadora
            </p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', lineHeight: 1.4 }}>
              Abre esta misma URL en Chrome o Firefox desde tu laptop o PC de escritorio.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p style={{
          color: 'rgba(255,255,255,0.2)',
          fontSize: '11px',
          marginTop: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}>
          <ShieldAlert size={12} />
          Procesamiento biométrico local · Sin almacenamiento de imágenes
        </p>
      </div>

      {/* Keyframe para el punto pulsante — inyectado inline */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}



