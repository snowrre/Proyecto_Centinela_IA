-- ==============================================================================
-- AUDITORÍA DE SEGURIDAD RLS: POLÍTICA ZERO TRUST
-- ==============================================================================

-- 1. Habilitar RLS en todas las tablas clave
ALTER TABLE public.alumnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_logs ENABLE ROW LEVEL SECURITY;

-- 2. Limpiar políticas anteriores (opcional, previene duplicados)
DROP POLICY IF EXISTS "Permitir SELECT anon" ON public.alumnos;
DROP POLICY IF EXISTS "Permitir INSERT anon" ON public.alumnos;
DROP POLICY IF EXISTS "Profesores todo alumnos" ON public.alumnos;
-- (Se asume que es la primera vez que se aplican políticas)

-- ==============================================================================
-- POLÍTICAS PARA: alumnos
-- ==============================================================================
-- Anon: Puede leer e insertar (necesario para el login y registro). NADA MÁS.
CREATE POLICY "Anon puede insertar alumno" ON public.alumnos FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon puede leer alumnos" ON public.alumnos FOR SELECT TO anon USING (true);
-- Auth (Profesores): Todo
CREATE POLICY "Auth tiene acceso total a alumnos" ON public.alumnos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==============================================================================
-- POLÍTICAS PARA: exams, questions, options
-- ==============================================================================
-- Anon: Solo lectura (SELECT). Necesitan leer el examen para poder contestarlo.
CREATE POLICY "Anon puede leer exams" ON public.exams FOR SELECT TO anon USING (true);
CREATE POLICY "Anon puede leer questions" ON public.questions FOR SELECT TO anon USING (true);
CREATE POLICY "Anon puede leer options" ON public.options FOR SELECT TO anon USING (true);
-- Auth (Profesores): Todo
CREATE POLICY "Auth total exams" ON public.exams FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth total questions" ON public.questions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth total options" ON public.options FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==============================================================================
-- POLÍTICAS PARA: exam_sessions, camera_logs
-- ==============================================================================
-- Anon: Solo INSERT (registran cuando entran a la sala y cuando cometen fraude).
CREATE POLICY "Anon inserta session" ON public.exam_sessions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon inserta camera_logs" ON public.camera_logs FOR INSERT TO anon WITH CHECK (true);
-- Auth (Profesores): Todo
CREATE POLICY "Auth total exam_sessions" ON public.exam_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth total camera_logs" ON public.camera_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==============================================================================
-- POLÍTICAS PARA: exam_submissions
-- ==============================================================================
-- Anon: **SOLO INSERTAR**. No pueden leer (SELECT), ni modificar, ni borrar.
CREATE POLICY "Anon inserta entrega" ON public.exam_submissions FOR INSERT TO anon WITH CHECK (true);
-- Auth (Profesores): Todo (calificar, revisar, borrar).
CREATE POLICY "Auth total exam_submissions" ON public.exam_submissions FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ==============================================================================
-- FUNCIÓN RPC: EL PUENTE SEGURO PARA EL CANDADO ANTI-INTENTOS
-- ==============================================================================
-- Como los alumnos ya no pueden hacer SELECT en exam_submissions, el candado del
-- frontend fallaría. Para solucionarlo, creamos esta función con SECURITY DEFINER.
-- Esto hace que la función se ejecute con privilegios de "administrador" (bypass RLS),
-- devolviendo SOLO un booleano (true/false) sin exponer NINGÚN dato de la tabla.
CREATE OR REPLACE FUNCTION verificar_entrega_previa(p_exam_pin TEXT, p_matricula TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
AS $$
DECLARE
    entrega_existe BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.exam_submissions
        WHERE exam_pin = p_exam_pin 
          AND student_name = p_matricula
    ) INTO entrega_existe;
    
    RETURN entrega_existe;
END;
$$ LANGUAGE plpgsql;
