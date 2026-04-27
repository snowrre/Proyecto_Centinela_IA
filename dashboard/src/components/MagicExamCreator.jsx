import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, CheckCircle2, ArrowRight, FileText, Check, Trash2, ChevronLeft, Wand2, Type, ListChecks, Layout, Link as LinkIcon, FileCode2 } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function MagicExamCreator({ onComplete, darkMode }) {
  const [step, setStep] = useState(0);
  const [examTitle, setExamTitle] = useState('Nuevo Examen Centinela');
  const [pin, setPin] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef(null);
  const [questions, setQuestions] = useState([]);
  const [importMode, setImportMode] = useState(null); // 'ai', 'manual', 'link'
  const [externalLink, setExternalLink] = useState('');

  useEffect(() => {
    if (questions.length > 0) {
      localStorage.setItem('draft_exam', JSON.stringify({ title: examTitle, questions }));
    }
  }, [questions, examTitle]);

  const handleUpload = async (file) => {
    setStep(2);
    setOcrProgress(0);
    setErrorMessage('');
    setOcrStatus('Iniciando Motores de Visión Artificial (Centinela V3)...');

    try {
      let imagesToProcess = [];
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 }); 
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          imagesToProcess.push(canvas.toDataURL('image/png'));
        }
      } else {
        imagesToProcess.push(file);
      }

      const worker = await createWorker('spa', 1, {
        logger: m => { if (m.status === 'recognizing text') setOcrProgress(Math.floor(m.progress * 100)); }
      });
      
      let fullText = "";
      for (let j = 0; j < imagesToProcess.length; j++) {
        const { data: { text } } = await worker.recognize(imagesToProcess[j]);
        fullText += "\n" + text;
      }

      await worker.terminate();
      const extractedQuestions = parseQuestionsFromText(fullText);
      if (extractedQuestions.length > 0) setQuestions(extractedQuestions);
      else setQuestions([{ id: "manual-0", type: 'open', text: fullText.substring(0, 1000), options: [], correctOption: null }]);
      
      setStep(3);
    } catch (error) {
      setErrorMessage(`Error: ${error.message}`);
      setStep(1);
    }
  };

  const parseQuestionsFromText = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const qs = [];
    let currentQ = null;
    lines.forEach(line => {
      const isQuestionStart = /^\d+[.)\-\s]/.test(line) || line.startsWith('¿');
      if (isQuestionStart) {
        if (currentQ) qs.push(currentQ);
        currentQ = { id: Math.random().toString(36).substr(2, 9), type: 'multiple', text: line.replace(/^\d+[.)\-\s]+/, ''), options: [], correctOption: null };
      } else if (currentQ) {
        const optionMatch = line.match(/^([a-eA-E])[.)\-\s]+(.*)/);
        if (optionMatch) {
          const optId = optionMatch[1].toLowerCase();
          currentQ.options.push({ id: optId, text: optionMatch[2].trim() });
          if (!currentQ.correctOption) currentQ.correctOption = optId;
        } else {
          currentQ.text += " " + line;
        }
      }
    });
    if (currentQ) qs.push(currentQ);
    return qs.map(q => q.options.length === 0 ? { ...q, type: 'open' } : q);
  };

  const handleCreateRoom = async () => {
    const generatedPin = "#UTC-" + Math.floor(1000 + Math.random() * 9000);
    setPin(generatedPin);
    const newExam = { pin: generatedPin, title: examTitle, questions };
    
    try {
        await supabase.from('exams').insert([newExam]);
    } catch (err) {
        console.error("Error saving to Supabase:", err);
    }

    const existing = JSON.parse(localStorage.getItem('active_exams') || '[]');
    localStorage.setItem('active_exams', JSON.stringify([newExam, ...existing]));
    setStep(4);
  };

  const addManualQuestion = (type) => {
    const newQ = { id: Date.now(), type, text: '', options: type === 'multiple' ? [{id:'a',text:''},{id:'b',text:''},{id:'c',text:''},{id:'d',text:''}] : [], correctOption: type === 'multiple' ? 'a' : null };
    setQuestions([...questions, newQ]);
  };

  if (step === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6">
        <div className="max-w-5xl w-full">
           <h2 className={cn("text-3xl font-black text-center mb-2", darkMode ? "text-white" : "text-black")}>Motor de Exámenes V3</h2>
           <p className="text-sm text-neutral-500 mb-12 text-center">IA de lectura real (PDF/OCR). Sin límites.</p>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <ModeButton onClick={() => { setImportMode('ai'); setStep(1); }} icon={<Wand2 className="w-6 h-6" />} title="Lectura IA" desc="PDF o Imágenes" color="blue" dark={darkMode} />
              <ModeButton onClick={() => { setImportMode('manual'); setQuestions([]); addManualQuestion('multiple'); setStep(3); }} icon={<Layout className="w-6 h-6" />} title="Manual" desc="Escribir preguntas" color="purple" dark={darkMode} />
              <ModeButton onClick={() => { setImportMode('link'); setStep(1); }} icon={<LinkIcon className="w-6 h-6" />} title="Google Forms" desc="Importar link" color="emerald" dark={darkMode} />
              <ModeButton onClick={() => { setImportMode('link'); setStep(1); }} icon={<FileCode2 className="w-6 h-6" />} title="MS Forms" desc="Importar link" color="cyan" dark={darkMode} />
           </div>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("max-w-xl w-full p-10 rounded-[32px] border shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
          <button onClick={() => setStep(0)} className="text-xs font-bold text-neutral-400 hover:text-blue-500 mb-8 flex items-center gap-2"><ChevronLeft className="w-4 h-4" /> Volver</button>
          
          <div className="mb-8">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-2 block">Título del Examen</label>
            <input type="text" value={examTitle} onChange={(e) => setExamTitle(e.target.value)} className={cn("w-full bg-transparent border-b-2 py-3 font-black text-2xl focus:outline-none transition-colors", darkMode ? "border-white/5 text-white focus:border-blue-500" : "border-neutral-100 text-black focus:border-blue-500")} />
          </div>

          {importMode === 'ai' ? (
            <>
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0])} className="hidden" accept="image/*,.pdf" />
              <button onClick={() => fileInputRef.current.click()} className={cn("w-full flex flex-col items-center justify-center h-56 border-2 border-dashed rounded-[24px] transition-all group", darkMode ? "border-neutral-800 bg-black/20 hover:border-blue-500" : "border-neutral-200 bg-neutral-50 hover:border-blue-400")}>
                <Upload className="w-10 h-10 text-neutral-400 group-hover:text-blue-500 mb-4 transition-transform group-hover:-translate-y-1" />
                <span className={cn("text-sm font-black", darkMode ? "text-white" : "text-black")}>Seleccionar PDF o Imagen</span>
              </button>
            </>
          ) : (
            <div className="space-y-6">
              <div className="p-6 bg-blue-500/5 rounded-2xl border border-blue-500/20">
                <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3 block">Enlace del Formulario</label>
                <div className="flex gap-2">
                  <input 
                    type="url" 
                    placeholder="https://forms.gle/..." 
                    value={externalLink}
                    onChange={(e) => setExternalLink(e.target.value)}
                    className={cn("flex-1 bg-white dark:bg-black border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500", darkMode ? "text-white" : "text-black")}
                  />
                </div>
              </div>
              <button 
                onClick={() => { setQuestions([{ id: Date.now(), type: 'open', text: `Examen importado desde: ${externalLink}`, options: [], correctOption: null }]); setStep(3); }}
                disabled={!externalLink}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg disabled:opacity-50 hover:scale-[1.02] transition-all"
              >
                IMPORTAR Y CONFIGURAR
              </button>
            </div>
          )}
          
          {errorMessage && <div className="mt-6 p-4 rounded-xl bg-red-50 text-red-600 text-xs font-bold">{errorMessage}</div>}
        </motion.div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] text-center">
        <div className="relative mb-8">
            <div className={cn("w-24 h-24 rounded-full border-4 animate-spin", darkMode ? "border-white/5 border-t-blue-500" : "border-neutral-100 border-t-blue-500")} />
            <div className="absolute inset-0 flex items-center justify-center text-xl font-black text-blue-500">{ocrProgress}%</div>
        </div>
        <h2 className={cn("text-xl font-black mb-2", darkMode ? "text-white" : "text-black")}>Procesando Documento</h2>
        <p className="text-xs text-neutral-500 animate-pulse">{ocrStatus}</p>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className={cn("h-full flex flex-col", darkMode ? "bg-black" : "bg-neutral-50")}>
        <div className={cn("flex items-center justify-between px-8 py-5 border-b sticky top-0 z-20", darkMode ? "border-white/10 bg-[#111111]" : "border-neutral-200 bg-white shadow-sm")}>
          <div className="flex items-center gap-4">
             <button onClick={() => setStep(0)} className={cn("p-2 rounded-xl transition-colors", darkMode ? "text-white hover:bg-white/10" : "text-black hover:bg-neutral-100")}><ChevronLeft className="w-6 h-6" /></button>
             <input type="text" value={examTitle} onChange={(e) => setExamTitle(e.target.value)} className={cn("bg-transparent border-none p-0 font-black text-xl focus:ring-0", darkMode ? "text-white" : "text-black")} />
          </div>
          <button onClick={handleCreateRoom} className="px-8 py-3 bg-blue-600 text-white text-sm font-black rounded-[18px] hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-blue-500/20">Publicar Examen <ArrowRight className="inline ml-2 w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-10">
          <div className="max-w-4xl mx-auto space-y-8 pb-32">
            {questions.map((q, index) => (
              <motion.div key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("p-10 rounded-[32px] border relative transition-all group", darkMode ? "bg-[#111111] border-white/10 hover:border-blue-500/30" : "bg-white border-neutral-200 hover:shadow-xl")}>
                <div className="absolute top-6 right-6 flex items-center gap-2">
                    <button onClick={() => { const n = [...questions]; n[index].type = n[index].type === 'multiple' ? 'open' : 'multiple'; setQuestions(n); }} className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors", darkMode ? "bg-white/5 text-neutral-400 hover:bg-blue-500 hover:text-white" : "bg-neutral-100 text-neutral-600 hover:bg-blue-600 hover:text-white")}>
                        {q.type === 'multiple' ? 'Opción Múltiple' : 'Abierta'}
                    </button>
                    <button onClick={() => setQuestions(questions.filter(item => item.id !== q.id))} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors"><Trash2 className="w-5 h-5" /></button>
                </div>

                <div className="flex items-start gap-6 mb-8">
                  <span className={cn("flex items-center justify-center w-10 h-10 rounded-2xl text-xs font-black shrink-0", darkMode ? "bg-neutral-800 text-neutral-400" : "bg-neutral-100 text-neutral-500")}>{index + 1}</span>
                  <textarea value={q.text} onChange={(e) => { const n = [...questions]; n[index].text = e.target.value; setQuestions(n); }} className={cn("w-full text-lg font-black bg-transparent border-none p-0 focus:ring-0 resize-none leading-relaxed", darkMode ? "text-white" : "text-neutral-900")} rows={2} placeholder="Escribe la pregunta..." />
                </div>

                {q.type === 'multiple' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-16">
                    {['a','b','c','d','e'].map((id) => {
                      const opt = q.options.find(o => o.id === id);
                      const isSelected = q.correctOption === id;
                      return (
                        <div key={id} className={cn("flex items-center gap-4 px-5 py-4 rounded-[20px] border transition-all cursor-pointer", isSelected ? "border-green-500 bg-green-500/10 ring-1 ring-green-500" : (darkMode ? "border-white/5 hover:border-neutral-500" : "border-neutral-100 hover:border-neutral-300"))}>
                          <button onClick={() => { const n = [...questions]; n[index].correctOption = id; setQuestions(n); }} className={cn("w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all", isSelected ? "bg-green-500 border-green-500" : (darkMode ? "border-neutral-600" : "border-neutral-300"))}>
                            {isSelected && <Check className="w-3 h-3 text-white font-bold" />}
                          </button>
                          <span className={cn("text-xs font-black uppercase w-4", darkMode ? "text-neutral-500" : "text-neutral-400")}>{id}</span>
                          <input type="text" value={opt?.text || ''} onChange={(e) => { 
                                const n = [...questions]; 
                                const oi = n[index].options.findIndex(o => o.id === id);
                                if (oi >= 0) n[index].options[oi].text = e.target.value;
                                else n[index].options.push({ id, text: e.target.value });
                                setQuestions(n);
                            }} className={cn("flex-1 text-sm font-bold bg-transparent border-none p-0 focus:ring-0", darkMode ? "text-neutral-200" : "text-neutral-700")} placeholder={`Opción ${id.toUpperCase()}`} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            ))}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button onClick={() => addManualQuestion('multiple')} className={cn("py-10 border-2 border-dashed rounded-[32px] flex flex-col items-center justify-center gap-3 transition-all group", darkMode ? "border-neutral-800 bg-white/5 hover:border-blue-500" : "border-neutral-200 bg-white hover:border-blue-500 hover:shadow-lg")}>
                    <ListChecks className="w-8 h-8 text-neutral-400 group-hover:text-blue-500" />
                    <span className={cn("text-xs font-black uppercase tracking-widest", darkMode ? "text-neutral-500 group-hover:text-white" : "text-neutral-400 group-hover:text-black")}>Añadir Opción Múltiple</span>
                </button>
                <button onClick={() => addManualQuestion('open')} className={cn("py-10 border-2 border-dashed rounded-[32px] flex flex-col items-center justify-center gap-3 transition-all group", darkMode ? "border-neutral-800 bg-white/5 hover:border-purple-500" : "border-neutral-200 bg-white hover:border-purple-500 hover:shadow-lg")}>
                    <Type className="w-8 h-8 text-neutral-400 group-hover:text-purple-500" />
                    <span className={cn("text-xs font-black uppercase tracking-widest", darkMode ? "text-neutral-500 group-hover:text-white" : "text-neutral-400 group-hover:text-black")}>Añadir Pregunta Abierta</span>
                </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={cn("max-w-md w-full p-12 rounded-[48px] border shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
          <div className="mx-auto w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-8"><CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" /></div>
          <h2 className={cn("text-2xl font-black mb-3", darkMode ? "text-white" : "text-black")}>Examen Publicado</h2>
          <div className="py-8 px-6 rounded-3xl mb-12 border-2 border-blue-50 bg-blue-50/50 dark:bg-blue-900/10">
             <span className="text-5xl font-mono font-black tracking-[0.2em] text-blue-600 uppercase">{pin}</span>
          </div>
          <button onClick={onComplete} className="w-full py-5 bg-black dark:bg-white dark:text-black text-white rounded-[24px] text-base font-black shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all">Ir al Monitoreo</button>
        </motion.div>
      </div>
    );
  }

  return null;
}

function ModeButton({ onClick, icon, title, desc, color, dark }) {
  const colors = { blue: "text-blue-600 bg-blue-50 dark:bg-blue-900/20", purple: "text-purple-600 bg-purple-50 dark:bg-purple-900/20", emerald: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20", cyan: "text-cyan-600 bg-cyan-50 dark:bg-cyan-900/20" };
  return (
    <button onClick={onClick} className={cn("p-10 rounded-[40px] border text-left transition-all hover:border-black group relative overflow-hidden", dark ? "bg-[#111111] border-white/10 hover:border-white" : "bg-white border-neutral-100 hover:shadow-xl")}>
      <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mb-8 shadow-md", colors[color])}>{icon}</div>
      <h3 className={cn("font-black text-lg mb-2", dark ? "text-white" : "text-black")}>{title}</h3>
      <p className="text-xs text-neutral-500 font-medium">{desc}</p>
    </button>
  );
}
