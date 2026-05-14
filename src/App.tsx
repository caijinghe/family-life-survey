import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Check, ArrowRight, ArrowLeft, Loader2, Play, AlertCircle, X } from 'lucide-react';
import emailjs from '@emailjs/browser';

emailjs.init('lEFA1_pOEYyDIl6ay');

const TOTAL_STEPS = 6;

const maxDurations: Record<number, number> = {
  1: 180, 2: 180, 3: 180, 4: 180, 5: 180
};

const voiceQuestions: Record<string, string> = {
  q1: 'Who do you currently live with? Please describe your household or living situation in your own words.',
  q2: 'What kinds of household chores or recurring responsibilities come up most often in your home? Which ones feel the most frustrating, tiring, or mentally draining to you, and why?',
  q3: 'How did this division of responsibilities develop in your household? Was it planned through discussion, or did it happen naturally? How do you usually divide tasks?',
  q4: 'Think about a recent household task that didn\'t get completed on time. How did you feel about it? What happened that caused the task to be delayed or left unfinished? How was the situation eventually handled?',
  q5: 'When you complete a lot of household responsibilities, what kind of response or support makes you feel seen or appreciated?'
};

export default function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [audioBlobs, setAudioBlobs] = useState<Record<number, Blob[]>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStep, setRecordingStep] = useState<number | null>(null);
  const [timer, setTimer] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactInfo, setContactInfo] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const progress = Math.round((currentStep / TOTAL_STEPS) * 100);

  useEffect(() => {
    if (isRecording) {
      timerIntervalRef.current = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isRecording]);

  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({});
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});
  const [realtimeTranscript, setRealtimeTranscript] = useState('');
  const realtimeTranscriptRef = useRef('');

  // Sync ref with state
  useEffect(() => {
    realtimeTranscriptRef.current = realtimeTranscript;
  }, [realtimeTranscript]);
  const [uploadingSteps, setUploadingSteps] = useState<Record<number, number>>({});
  const [respondentId] = useState(() => 'R-' + Date.now().toString(36).toUpperCase());

  const recognitionRef = useRef<any>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll realtime transcript to bottom - only scrolling the container, not the entire page
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [realtimeTranscript]);

  const startRecording = async (stepId: number) => {
    setError(null);
    setRealtimeTranscript('');
    realtimeTranscriptRef.current = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Initialize Web Speech API for real-time feedback
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US'; // Back to English as requested

        recognition.onresult = (event: any) => {
          let currentTranscript = '';
          for (let i = 0; i < event.results.length; ++i) {
            currentTranscript += event.results[i][0].transcript;
          }
          setRealtimeTranscript(currentTranscript);
        };

        recognition.onerror = (event: any) => {
          console.warn("Speech Recognition Error:", event.error);
        };

        recognition.start();
        recognitionRef.current = recognition;
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlobs(prev => ({ ...prev, [stepId]: [...(prev[stepId] || []), audioBlob] }));
        stream.getTracks().forEach(track => track.stop());

        // Immediately upload to server
        uploadStepAudio(stepId, audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingStep(stepId);
      setTimer(0);
    } catch (err: any) {
      console.error("Microphone access denied:", err);
      let msg = "录音授权失败。";
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        msg += "请点击浏览器地址栏左侧的“小锁”图标，确保已开启“麦克风”权限。";
      } else {
        msg += "可能当前环境不支持录音（请尝试在独立窗口中打开应用）。";
      }
      setError(msg);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingStep(null);
    }
  };

  const deleteRecording = (stepId: number, index: number) => {
    setAudioBlobs(prev => {
      const updated = [...(prev[stepId] || [])];
      updated.splice(index, 1);
      
      if (updated.length === 0) {
        const newState = { ...prev };
        delete newState[stepId];
        return newState;
      }
      return { ...prev, [stepId]: updated };
    });
  };

  const selectOption = (qId: string, val: any) => {
    setAnswers(prev => ({ ...prev, [qId]: val }));
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const uploadStepAudio = async (stepId: number, blob: Blob) => {
    setUploadingSteps(prev => ({ ...prev, [stepId]: (prev[stepId] || 0) + 1 }));
    try {
      const base64 = await blobToBase64(blob);
      
      // 1. Get transcription from server
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_base64: base64
        })
      });

      const data = await res.json();
      
      // If transcription failed due to quota or error, use the realtime transcript as fallback
      let transcript = data.transcript || "";
      const isError = transcript.includes('AI Busy') || transcript.includes('Error') || transcript.includes('pending') || !transcript;
      
      // CRITICAL: Robust fallback to local recognition result
      if (isError && realtimeTranscriptRef.current) {
        transcript = realtimeTranscriptRef.current;
        console.log("Using local transcript fallback: ", transcript);
      } else if (!transcript) {
        transcript = "[Transcription pending: No voice detected]";
      }

      
      setTranscripts(prev => {
        let existing = prev[stepId] || "";
        // Clean up previous error placeholders so they don't accumulate
        existing = existing.replace(/\[Transcription (pending|Error).*?\]/g, "").trim();
        const newText = existing.length > 0 ? existing + "\n\n" + transcript : transcript;
        return { ...prev, [stepId]: newText };
      });

      // 2. Mark as saved locally in memory
      setAudioUrls(prev => ({ ...prev, [stepId]: 'saved-locally' }));
      
    } catch (err: any) {
      console.error("Individual upload/save error:", err);
      // If the error message indicates a quota hit that the server didn't catch or a network error
      const errStr = String(err.message || "").toLowerCase();
      if (errStr.includes('quota') || errStr.includes('limit') || errStr.includes('429')) {
        // Do not set a hard error state if we have the transcript state (even if pending)
        console.warn("Recoverable AI Quota error");
      } else {
        setError("音频处理失败：" + (err.message || "未知错误"));
      }
    } finally {
      setUploadingSteps(prev => ({ ...prev, [stepId]: Math.max(0, (prev[stepId] || 1) - 1) }));
    }
  };

  const submitSurvey = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Collect all recorded transcripts to send via email
      const collectedData: Record<string, string> = {};
      Object.keys(transcripts).forEach(step => {
        collectedData[`Question_${step}`] = transcripts[Number(step)];
      });

      // Send complete survey data via EmailJS
      try {
        const emailPayload = {
          respondent_id: respondentId,
          submitted_at: new Date().toISOString(),
          follow_up_contact: contactInfo || 'not provided',
          transcripts: collectedData,
          has_voice: Object.keys(audioUrls).length > 0
        };

        await emailjs.send('service_e8pnpsn', 'template_hdq17t8', {
          respondent_id: respondentId,
          survey_data: JSON.stringify(emailPayload, null, 2)
        });
        console.log("Survey successfully sent via EmailJS!");
      } catch (emailJsErr) {
        console.warn("Notification email skipped or failed:", emailJsErr);
        setError('邮件发送失败，请检查网络。');
        setIsSubmitting(false);
        return;
      }

      setCurrentStep(7); // Thanks step
    } catch (err: any) {
      console.error("Submission error:", err);
      setError('提交过程中出现问题。您的回答已保存，但最终确认未完成。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="survey-container">
            <div className="mb-8">
              <h1 className="text-4xl md:text-5xl font-serif leading-tight mb-4 text-ink">
                Household Responsibility Research
              </h1>
              <p className="text-ink-light text-lg leading-relaxed">
                We are a team of researchers from SCAD conducting this study to better understand how families manage household responsibilities. Your insights will help us design more supportive tools for modern homes.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
              <div className="bg-white/60 p-5 rounded-2xl border border-border/50">
                <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mb-4">
                  <Play size={20} className="text-accent" />
                </div>
                <h3 className="font-medium mb-1 text-ink">5 Questions</h3>
                <p className="text-xs text-ink-light leading-relaxed">Short and simple, designed for a smooth flow.</p>
              </div>
              
              <div className="bg-white/60 p-5 rounded-2xl border border-border/50">
                <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mb-4">
                  <Mic size={20} className="text-accent" />
                </div>
                <h3 className="font-medium mb-1 text-ink">Voice Only</h3>
                <p className="text-xs text-ink-light leading-relaxed">Just speak naturally—no typing required.</p>
              </div>

              <div className="bg-white/60 p-5 rounded-2xl border border-border/50">
                <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mb-4">
                  <Check size={20} className="text-accent" />
                </div>
                <h3 className="font-medium mb-1 text-ink">Privacy First</h3>
                <p className="text-xs text-ink-light leading-relaxed">Only transcripts saved. Recordings deleted instantly.</p>
              </div>
            </div>

            <div className="bg-accent-light/20 p-6 rounded-2xl border border-accent/20 mb-10 overflow-hidden relative">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <AlertCircle size={80} className="text-accent" />
              </div>
              <h3 className="text-ink font-semibold mb-4 flex items-center gap-2">
                <AlertCircle size={18} className="text-accent" />
                Setup & Guidelines
              </h3>
              <ul className="space-y-4 relative z-10">
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-[11px] font-bold text-accent shrink-0 border border-accent/20 shadow-sm">1</div>
                  <p className="text-sm text-ink-light leading-snug">
                    Click <span className="font-semibold text-accent">"Allow"</span> when prompted for microphone access.
                  </p>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-[11px] font-bold text-accent shrink-0 border border-accent/20 shadow-sm">2</div>
                  <p className="text-sm text-ink-light leading-snug">
                    Wait for the <span className="italic">Identifying</span> status to complete before clicking <span className="font-medium">"Next"</span>.
                  </p>
                </li>
              </ul>
            </div>

            <button onClick={() => setCurrentStep(1)} className="btn-primary w-full md:w-auto flex justify-center">
              Ready to begin? <ArrowRight size={18} />
            </button>
          </motion.div>
        );

      case 1: case 2: case 3: case 4: case 5:
        const qText = voiceQuestions[`q${currentStep}`];
        return (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} key={currentStep}>
            <div className="text-[11px] font-medium tracking-widest text-accent uppercase mb-3">Question {currentStep} of 5</div>
            <h2 className="font-serif text-2xl md:text-3xl mb-3 leading-tight">{qText}</h2>
            <div className="text-sm text-ink-light leading-relaxed mb-8">
              {currentStep === 3 && (
                <div className="mt-2 text-[13px] italic bg-white/40 p-3 rounded-lg border border-border/50">
                  <p className="mb-2 font-medium non-italic text-ink">For example:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Each person naturally takes responsibility for certain tasks</li>
                    <li>Whoever notices the task first takes care of it</li>
                    <li>One person usually assigns or distributes tasks</li>
                  </ul>
                </div>
              )}
            </div>

            <div className="bg-warm-white border border-border rounded-2xl p-8 mb-6">
              <div className="text-center mb-6">
                <div className={`font-serif text-3xl mb-1 ${isRecording ? 'text-accent font-bold' : 'text-ink'}`}>
                  {formatTime(timer)}
                </div>
                {isRecording && (
                  <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center gap-2 mb-2"
                  >
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Continuous Listening Active</span>
                  </motion.div>
                )}
                <div className="text-xs text-ink-faint">
                  {isRecording ? "Speak naturally... we're listening" : 
                   uploadingSteps[currentStep] > 0 ? "AI is refining the transcript..." :
                   audioUrls[currentStep] ? "Voice saved ✓ (Tap mic again to add more)" : 
                   "Tap the mic to start"}
                </div>
              </div>

              {(isRecording || uploadingSteps[currentStep] > 0) && (realtimeTranscript || "").length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }} 
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-5 bg-white border border-accent/10 rounded-2xl text-left shadow-sm"
                >
                  <div className="flex items-center gap-2 mb-3">
                    {isRecording ? (
                      <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                    ) : (
                      <Loader2 className="animate-spin text-accent" size={12} />
                    )}
                    <p className="text-[10px] uppercase tracking-wider text-accent font-bold">
                      {isRecording ? 'Live Transcription' : 'Refining via AI...'}
                    </p>
                  </div>
                  <div ref={transcriptContainerRef} className={`max-h-40 overflow-y-auto scrollbar-hide transition-opacity ${!isRecording ? 'opacity-60' : ''}`}>
                    <p className="text-sm text-ink-light leading-relaxed whitespace-pre-wrap italic">
                      "{realtimeTranscript || 'Waiting for voice...'}"
                    </p>
                    <div ref={transcriptEndRef} />
                  </div>
                </motion.div>
              )}

              {uploadingSteps[currentStep] > 0 && (
                <div className="flex flex-col items-center gap-3 mb-4">
                  <Loader2 className="animate-spin text-accent" size={24} />
                  <p className="text-xs text-accent font-medium">Identifying voice details...</p>
                </div>
              )}

              {transcripts[currentStep] && (
                <div className={`mb-6 p-4 bg-white border rounded-xl text-xs text-left shadow-sm ${transcripts[currentStep].includes('Quota Exceeded') ? 'border-red-200 bg-red-50/30' : 'border-border'}`}>
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-bold text-accent uppercase tracking-wider text-[10px]">
                      {transcripts[currentStep].includes('Quota Exceeded') ? 'Voice Captured' : 'Saved Transcript'}
                    </span>
                    <span className="text-[10px] text-ink-faint">Click to edit</span>
                  </div>
                  {transcripts[currentStep].includes('Quota Exceeded') && (
                    <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg mb-3">
                      <p className="text-amber-800 font-medium">
                        Recording successful! AI is momentarily busy, but your voice is saved.
                      </p>
                    </div>
                  )}
                  <textarea 
                    value={transcripts[currentStep]}
                    onChange={(e) => setTranscripts(prev => ({ ...prev, [currentStep]: e.target.value }))}
                    className="w-full bg-transparent border-none focus:ring-0 p-0 text-ink leading-relaxed resize-none"
                    rows={Math.max(3, transcripts[currentStep].split('\n').length)}
                  />
                </div>
              )}

              {audioBlobs[currentStep] && audioBlobs[currentStep].length > 0 && (
                <div className="mb-6 p-4 bg-white border border-border rounded-xl shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-accent uppercase tracking-wider text-[10px]">Play Back Recording{audioBlobs[currentStep].length > 1 ? 's' : ''}</span>
                    <span className="text-[10px] text-success font-medium flex items-center gap-1">
                      <Check size={10} /> Saved
                    </span>
                  </div>
                  <div className="space-y-2">
                    {audioBlobs[currentStep].map((blob, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <audio controls src={URL.createObjectURL(blob)} className="w-full h-10" />
                        <button 
                          onClick={() => deleteRecording(currentStep, idx)} 
                          className="p-1.5 text-ink-faint hover:text-red-500 hover:bg-red-50 rounded-full transition-colors flex-shrink-0"
                          title="Delete recording"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recording Button - Moved to the bottom of this section */}
              <div className="flex flex-col items-center">
                <button 
                  onClick={() => isRecording ? stopRecording() : startRecording(currentStep)}
                  className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-800' : 'bg-accent hover:scale-105 active:scale-95 shadow-lg shadow-accent/20'} mx-auto`}
                >
                  <div className={`absolute -inset-3 border-2 border-recording rounded-full transition-opacity ${isRecording ? 'animate-pulse opacity-100' : 'opacity-0'}`} />
                  {isRecording ? (
                    <div className="w-6 h-6 bg-white rounded-sm" />
                  ) : (
                    <Mic size={32} className="text-white" />
                  )}
                </button>
                <div className="mt-10 flex items-center justify-center gap-1.5 h-6">
                  {isRecording ? (
                    [...Array(14)].map((_, i) => (
                      <div key={i} className="w-1 bg-accent rounded-full animate-wave" style={{ animationDelay: `${i * 0.1}s` }} />
                    ))
                  ) : (
                    <div className="h-0.5 w-24 bg-border/30 rounded-full" />
                  )}
                </div>
              </div>
              
              <div className="text-[10px] text-ink-faint mt-4 text-center">
                Limit: {maxDurations[currentStep] || 60}s per segment • You can record multiple times to add more thoughts
              </div>
            </div>

            <div className="flex flex-col items-center gap-4">
              {!audioBlobs[currentStep] && !isRecording && !uploadingSteps[currentStep] && (
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-xs text-accent font-medium bg-accent/5 px-3 py-1.5 rounded-full"
                >
                  Please record your response to continue
                </motion.p>
              )}
              
              {(() => {
                const cleanText = (transcripts[currentStep] || "").replace(/\[Transcription (pending|Error).*?\]/g, "").trim();
                const hasNoValidData = audioBlobs[currentStep] && cleanText.length === 0;
                
                return (
                  <div className="flex gap-3 w-full">
                    {currentStep > 0 && (
                      <button 
                        onClick={() => setCurrentStep(prev => prev - 1)} 
                        className="py-4 px-4 rounded-xl font-bold flex items-center justify-center transition-all active:scale-[0.98] bg-surface border border-border text-ink-faint hover:text-ink hover:border-ink-light w-1/4 shrink-0"
                        title="Go back to previous question"
                      >
                        <ArrowLeft size={18} />
                      </button>
                    )}
                    <button 
                      onClick={() => setCurrentStep(prev => prev + 1)} 
                      disabled={isRecording || uploadingSteps[currentStep] > 0 || !audioBlobs[currentStep] || hasNoValidData}
                      className={`btn-primary flex-1 justify-center ${(!audioBlobs[currentStep] && !isRecording) || hasNoValidData ? 'opacity-50 grayscale cursor-not-allowed' : ''}`}
                    >
                      {uploadingSteps[currentStep] > 0 ? (
                        <><Loader2 className="animate-spin" size={18} /> Processing Voice...</>
                      ) : !audioBlobs[currentStep] && !isRecording ? (
                        <>Waiting for recording... <ArrowRight size={18} className="opacity-30" /></>
                      ) : hasNoValidData ? (
                        <>AI Busy (No data), please retry <ArrowRight size={18} className="opacity-30" /></>
                      ) : (
                        <>{currentStep === 5 ? 'Finish & Continue' : 'Next Step'} <ArrowRight size={18} /></>
                      )}
                    </button>
                  </div>
                );
              })()}
            </div>
          </motion.div>
        );

      case 6:
        return (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} key={currentStep} className="survey-container">
            <div className="mb-8">
              <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mb-6">
                <Check size={24} className="text-success" />
              </div>
              <div className="text-[11px] font-medium tracking-widest text-accent uppercase mb-2">Survey Completed</div>
              <h2 className="font-serif text-3xl md:text-5xl mb-4 leading-tight text-ink tracking-tight">We'd love to stay in touch.</h2>
              <p className="text-ink-light text-lg leading-relaxed">
                Thank you for your valuable insights! Would you be open to a follow-up conversation about your family experiences?
              </p>
            </div>

            <div className="bg-white/60 p-6 rounded-2xl border border-border/50 mb-10 overflow-hidden relative shadow-sm">
              <div className="text-sm text-ink-light mb-4 leading-relaxed relative z-10 space-y-2">
                <p>If yes, please leave your email or phone number below.</p>
                <p>This is completely optional. It helps us go deeper in our research (approx. 15 min conversation).</p>
              </div>
              
              <div className="relative z-10">
                <input 
                  type="text" 
                  value={contactInfo}
                  onChange={(e) => setContactInfo(e.target.value)}
                  placeholder="your@email.com or phone number"
                  className="w-full p-4 bg-white/80 border border-border rounded-xl focus:border-accent outline-none text-sm transition-all focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex gap-3 w-full md:w-auto">
                <button 
                  onClick={() => setCurrentStep(prev => prev - 1)} 
                  className="py-4 px-4 rounded-xl font-bold flex items-center justify-center transition-all active:scale-[0.98] bg-surface border border-border text-ink-faint hover:text-ink hover:border-ink-light"
                  title="Go back to previous question"
                  disabled={isSubmitting}
                >
                  <ArrowLeft size={18} />
                </button>
                <button 
                  onClick={submitSurvey} 
                  className="btn-primary flex-1 md:w-auto justify-center px-10" 
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin" size={18} /> 
                      Submitting...
                    </>
                  ) : (
                    <>
                      {contactInfo ? 'Submit & Close' : 'Finish Survey'}
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
              
              {!contactInfo && !isSubmitting && (
                <button 
                  onClick={submitSurvey} 
                  className="text-xs text-ink-faint hover:text-ink-light cursor-pointer transition-colors border-b border-transparent hover:border-ink-faint"
                >
                  Skip & submit anonymously
                </button>
              )}
            </div>
            
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm leading-relaxed"
              >
                {error}
              </motion.div>
            )}
          </motion.div>
        );

      case 7:
        return (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-10">
            <div className="w-16 h-16 bg-accent-light rounded-full flex items-center justify-center mx-auto mb-6">
              <Check size={28} className="text-accent" />
            </div>
            <h2 className="font-serif text-3xl mb-4">Thank you so much.</h2>
            <div className="text-ink-light text-sm leading-relaxed max-w-md mx-auto space-y-2">
              <p>Your responses have been sent.</p>
              <p>You've helped us understand what really happens at home.</p>
              <p>That means a lot.</p>
            </div>
          </motion.div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-cream">
      <div className="w-full max-w-[640px]">
        {currentStep < 7 && (
          <div className="h-0.5 bg-border rounded-full mb-12 overflow-hidden">
            <motion.div 
              className="h-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        )}

        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>

      {isSubmitting && (
        <div className="fixed inset-0 bg-cream/90 flex flex-col items-center justify-center gap-4 z-50">
          <Loader2 className="animate-spin text-accent" size={40} />
          <div className="font-serif text-xl">Sending your responses…</div>
        </div>
      )}

    </div>
  );
}

