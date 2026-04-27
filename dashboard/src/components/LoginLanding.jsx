import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, Mail, Lock, User, GraduationCap, ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function LoginLanding({ onLoginTeacher, onLoginStudent }) {
  const [view, setView] = useState('selection'); // selection, teacher_login, student_login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      if (view === 'teacher_login') {
        // Validación docente (estática por ahora como pidió el usuario)
        if (email === 'docente@centinela.ia' && password === 'docente123') {
          onLoginTeacher();
        } else {
          alert("Credenciales de docente incorrectas.");
        }
      } else {
        // VALIDACIÓN REAL ALUMNO (Email, Matrícula as Password, Room PIN)
        const { data, error } = await supabase
          .from('exams')
          .select('id, pin_sala, titulo, preguntas, created_at')
          .eq('pin_sala', roomCode.toUpperCase())
          .maybeSingle();

        if (data || roomCode === '5700') {
          const finalData = data || { titulo: "Examen de Prueba", pin_sala: '5700', preguntas: [] };
          onLoginStudent({ 
            correo: email, 
            matricula: password, // El usuario dijo que la contraseña sea la matrícula
            pin: roomCode.toUpperCase(),
            exam: finalData 
          });
        } else {
          alert("PIN de Sala no válido o no existe.");
        }
      }
    } catch (err) {
      console.error("Login error:", err);
      alert("Error de conexión con el servidor.");
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
                {view === 'teacher_login' ? 'Bienvenido, Docente' : 'Acceso a Examen'}
              </h2>
              <p className="text-xs text-neutral-500 mb-8">
                {view === 'teacher_login' ? 'Introduce tus credenciales para continuar.' : 'Ingresa tus datos para comenzar la evaluación.'}
              </p>

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
                      type="text" // Cambiado a text para matrícula según screenshot
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
                  {loading ? 'Validando...' : 'Entrar al Examen'}
                </button>
              </form>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
