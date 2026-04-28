import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, Mail, Lock, User, GraduationCap, ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function LoginLanding({ onLoginTeacher, onLoginStudent }) {
  const [view, setView] = useState('selection'); // selection, teacher_login, student_login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);

  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // --- MODO SALVAVIDAS (DEMO) ---
    // Si el internet de la escuela falla o bloquea Supabase, este usuario siempre entrará
    if (email === 'admin@utc.edu.mx' && password === 'tesis2026') {
      alert("Entrando en Modo Administrador (Bypass local)");
      setLoading(false);
      if (onLoginTeacher) onLoginTeacher({ id: 'admin-bypass', email: 'admin@utc.edu.mx' });
      return;
    }

    try {
      if (isRegistering) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert("¡Registro exitoso! Ya puedes iniciar sesión.");
        setIsRegistering(false); 
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        // Validamos si es docente usando la función o el estado actual
        const esDocente = (typeof isTeacherEmail === 'function' && isTeacherEmail(email)) || view === 'teacher_login';

        if (esDocente) {
          // Redirige al panel del docente
          if (onLoginTeacher) onLoginTeacher(data.user); 
        } else {
          // Redirige a la vista de la cámara del alumno pasando la matrícula y el PIN
          if (onLoginStudent) {
            onLoginStudent({ 
              ...data.user,
              matricula: password, 
              roomCode: roomCode
            });
          }
        }
      }
    } catch (err) {
      // --- MANEJO DE ERRORES AMPLIADO ---
      if (err.message.includes('Invalid login credentials')) {
        setError("Correo o contraseña incorrectos.");
      } else if (err.message.includes('rate limit')) {
        setError("Has intentado muchas veces. Espera un minuto o usa el usuario administrador.");
      } else {
        setError("Error: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-neutral-900 font-sans flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        
        {/* Logo Section */}
        <div className="flex flex-col items-center mb-10">
          <div className="p-3 bg-black rounded-2xl mb-4 shadow-sm">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Centinela IA</h1>
          <p className="text-sm text-neutral-500">Supervisión inteligente de evaluaciones</p>
        </div>

        <div>
          {view === 'selection' && (
            <div className="space-y-4">
              <button
                onClick={() => setView('teacher_login')}
                className="w-full flex items-center justify-between p-6 bg-white border border-neutral-200 rounded-2xl hover:border-black transition-all group shadow-sm"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className="p-2 bg-neutral-100 rounded-lg group-hover:bg-neutral-900 group-hover:text-white transition-colors">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Portal Docente</h3>
                    <p className="text-xs text-neutral-500">Administra tus exámenes y monitorea alertas.</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-black transform group-hover:translate-x-1 transition-all" />
              </button>

              <button
                onClick={() => setView('student_login')}
                className="w-full flex items-center justify-between p-6 bg-white border border-neutral-200 rounded-2xl hover:border-black transition-all group shadow-sm"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className="p-2 bg-neutral-100 rounded-lg group-hover:bg-neutral-900 group-hover:text-white transition-colors">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Portal Alumno</h3>
                    <p className="text-xs text-neutral-500">Ingresa a tu evaluación supervisada.</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-black transform group-hover:translate-x-1 transition-all" />
              </button>
            </div>
          )}

          {(view === 'teacher_login' || view === 'student_login') && (
            <div className="bg-white p-8 rounded-2xl border border-neutral-200 shadow-sm">
              <button 
                onClick={() => setView('selection')}
                className="flex items-center gap-2 text-xs font-medium text-neutral-500 hover:text-black mb-6 transition-colors"
              >
                <ChevronLeft className="w-3 h-3" />
                Volver
              </button>

              <h2 className="text-lg font-bold mb-1">
                {view === 'teacher_login' 
                  ? (isRegistering ? 'Crear Cuenta Docente' : 'Bienvenido, Docente') 
                  : 'Acceso a Examen'}
              </h2>
              <p className="text-xs text-neutral-500 mb-8">
                {view === 'teacher_login' 
                  ? (isRegistering ? 'Regístrate para gestionar tus evaluaciones.' : 'Introduce tus credenciales para continuar.') 
                  : 'Ingresa tus datos para comenzar la evaluación.'}
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-[10px] font-bold uppercase tracking-tight flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">Correo Institucional</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      type="email" 
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                      placeholder="usuario@universidad.edu"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">
                    {view === 'teacher_login' ? 'Contraseña' : 'Matrícula'}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      type={view === 'teacher_login' ? 'password' : 'text'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                      placeholder={view === 'teacher_login' ? '••••••••' : 'Tu Matrícula'}
                    />
                  </div>
                </div>

                {view === 'student_login' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">PIN de Sala</label>
                    <input 
                      type="text" 
                      required
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-black tracking-widest focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                      placeholder="MAT-101"
                    />
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-black text-white rounded-xl text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mt-4"
                >
                  {loading 
                    ? 'Validando...' 
                    : (view === 'teacher_login' 
                        ? (isRegistering ? 'Crear Cuenta' : 'Entrar al Panel Docente') 
                        : 'Entrar al Examen')}
                </button>

                {view === 'teacher_login' && (
                  <div className="mt-4 text-center">
                    <button 
                      type="button" 
                      onClick={() => setIsRegistering(!isRegistering)}
                      className="text-xs text-blue-600 hover:underline font-bold"
                    >
                      {isRegistering ? '¿Ya tienes cuenta? Inicia sesión aquí' : '¿No tienes cuenta? Regístrate aquí'}
                    </button>
                  </div>
                )}
              </form>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
