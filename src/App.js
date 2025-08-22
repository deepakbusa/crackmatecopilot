import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import html2canvas from 'html2canvas';
import './App.css';
import Mammoth from 'mammoth';
import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CircularProgress from '@mui/material/CircularProgress';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import { auth, provider, getDatabase } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { ref as dbRef, onValue, set, update, get, runTransaction } from 'firebase/database';
import { Gift, Flame, Gem } from 'lucide-react';

const AZURE_DOC_INTELLIGENCE_KEY = process.env.REACT_APP_AZURE_DOC_INTELLIGENCE_KEY;
const AZURE_DOC_INTELLIGENCE_ENDPOINT = process.env.REACT_APP_AZURE_DOC_INTELLIGENCE_ENDPOINT;

const VisuallyHiddenInput = styled('input')({
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: 1,
  overflow: 'hidden',
  position: 'absolute',
  bottom: 0,
  left: 0, 
  whiteSpace: 'nowrap',
  width: 1,
});

const QUESTION_WORDS = [
  'what', 'how', 'why', 'when', 'where', 'who', 'which', 'whom', 'whose', 'is', 'are', 'can', 'could', 'would', 'should', 'do', 'does', 'did', 'will', 'shall', 'may', 'might', 'have', 'has', 'had', 'am', 'was', 'were', 'did', 'does', 'do'
];

const App = () => {
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('Java');
  const [isSettingsHovered, setIsSettingsHovered] = useState(false);
  const [glassOpacity, setGlassOpacity] = useState(0.6);
  const [isVisible, setIsVisible] = useState(true); // New state to track visibility
  const settingsRef = useRef(null);
  const recognizerRef = useRef(null);
  const audioStreamRef = useRef(null);
  const [screenshotQueue, setScreenshotQueue] = useState([]);
  const [resumeUploaded, setResumeUploaded] = useState(false);
  const [resumeContext, setResumeContext] = useState(null); // Store resume context/summary
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isSolvingScreenshots, setIsSolvingScreenshots] = useState(false);
  const [isShortcutsHovered, setIsShortcutsHovered] = useState(false);
  const shortcutsRef = useRef(null);
  const [requestToken, setRequestToken] = useState(0); // Token to track latest request
  const latestRequestToken = useRef(0);
  const [lastPrompt, setLastPrompt] = useState(null);
  const [lastImageData, setLastImageData] = useState(null);
  const [lastLanguage, setLastLanguage] = useState(null);
  const [showRetry, setShowRetry] = useState(false);
  const isListeningRef = useRef(false); // Ref to track listening state
  const selectedLanguageRef = useRef(selectedLanguage);
  const screenshotQueueRef = useRef(screenshotQueue);
  const isThinkingRef = useRef(isThinking);
  const isSolvingScreenshotsRef = useRef(isSolvingScreenshots);
  const solvingScreenshotsInProgressRef = useRef(false);
  const lastToggleTimeRef = useRef(0); // Ref to track last toggle time for debouncing
  const resumeContextRef = useRef(resumeContext);
  const [testUsed, setTestUsed] = useState(false);
  // Usage limit constants
  const FREE_LIMITS = {
    mic: 3,
    screenshots: 3,
    upload: 3,
  };
  // Usage state refs
  const micShortcutCountRef = useRef(0);
  const solveScreenshotsShortcutCountRef = useRef(0);
  const uploadResumeCountRef = useRef(0);
  const lastResetRef = useRef(0);
  // Replace isLoggedIn state with user state
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState('Free Plan');
  const PLAN_ICONS = {
    'Free Plan': Gift,
    'Monthly': Flame,
    'Yearly': Gem,
  };

  // Track usage (in-memory, reset on reload; for persistent, use RTDB/Firestore)
  const [usageToday, setUsageToday] = useState(0);

  const [usageLoading, setUsageLoading] = useState(false);

  // Add after useState for isListening:
  const setListening = (val) => {
    setIsListening(() => {
      isListeningRef.current = val;
      return val;
    });
  };

  useEffect(() => {
    console.log('App mounted');
    return () => {
      console.log('App unmounted');
    };
  }, []);

  // Listen for auth state changes (for redirect flow)
  // useEffect(() => {
  //   const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
  //     if (firebaseUser) {
  //       setUser({
  //         name: firebaseUser.displayName,
  //         email: firebaseUser.email,
  //         photo: firebaseUser.photoURL,
  //         uid: firebaseUser.uid, // Add uid for Firestore
  //       });
  //     } else {
  //       setUser(null);
  //     }
  //   });
  //   return () => unsubscribe();
  // }, []);

  // Email sanitization for RTDB key
  // Removed email sanitization and usage tracking

  // Listen to user plan changes in RTDB after login (real-time updates, using sanitized email as key)
  // Removed plan/user RTDB listener

  const API_KEY = process.env.REACT_APP_API_KEY;
  const API_URL = process.env.REACT_APP_API_URL;
  const DEPLOYMENT_ID = process.env.REACT_APP_DEPLOYMENT_ID;

  const ASSEMBLYAI_API_KEY = process.env.REACT_APP_SPEECH_KEY; // Use env var for AssemblyAI
  const mediaRecorderRef = useRef(null);
  let audioChunks = [];

  const moveWindow = (direction) => {
    const step = 20;
    if (window.electron && window.electron.moveWindow) {
      window.electron.moveWindow(direction, step);
    }
  };

  // Add a ref to store the handler
  const shortcutHandlerRef = useRef(null);

  useEffect(() => {
    // Always remove any previous handler
    if (window.electron && window.electron.removeShortcutListener && shortcutHandlerRef.current) {
      window.electron.removeShortcutListener(shortcutHandlerRef.current);
    }
    let handler = (data) => {
      // if (!user && ['takeScreenshot', 'solveScreenshots', 'toggleMic'].includes(data.action)) {
      //   setAiResponse('Please login to use this feature.');
      //   return;
      // }
      if (user && ['takeScreenshot', 'solveScreenshots', 'toggleMic'].includes(data.action)) {
        setAiResponse('');
      }
      switch (data.action) {
        case 'moveWindow':
          moveWindow(data.direction);
          break;
        case 'takeScreenshot':
          takeScreenshot(selectedLanguageRef.current);
          break;
        case 'startOver':
          startOver();
          break;
        case 'solveScreenshots':
          if (plan === 'Free Plan' && solveScreenshotsShortcutCountRef.current >= FREE_LIMITS.screenshots) {
            setAiResponse(limitMessage);
            return;
          }
          if (plan === 'Free Plan') {
            solveScreenshotsShortcutCountRef.current += 1;
          }
          if (screenshotQueueRef.current.length === 0) {
            setAiResponse('No screenshots found.');
          } else if (solvingScreenshotsInProgressRef.current) {
          } else {
            setIsSolvingScreenshots(true);
            setTimeout(() => {
              solveScreenshots().finally(() => {
                setIsSolvingScreenshots(false);
              });
            }, 50);
          }
          break;
        case 'toggleMic': {
          const now = Date.now();
          if (now - lastToggleTimeRef.current < 500) {
            break;
          }
          lastToggleTimeRef.current = now;

          if (!isThinkingRef.current && !isSolvingScreenshotsRef.current) {
            if (isListeningRef.current) {
              stopRecognition();
            } else {
              startRecognition();
            }
          }
          break;
        }
        default:
          break;
      }
    };
    shortcutHandlerRef.current = handler;
    if (window.electron && window.electron.onShortcut) {
      window.electron.onShortcut(handler);
    }
    return () => {
      if (window.electron && window.electron.removeShortcutListener && handler) {
        window.electron.removeShortcutListener(handler);
      }
    };
  }, [user, plan]);

  // Also clear the message when the user logs in
  useEffect(() => {
    if (user) setAiResponse('');
  }, [user]);

  // Add a useEffect to always stop mic and reset listening when user logs out
  // useEffect(() => {
  //   if (!user) {
  //     setListening(false);
  //     stopRecognition();
  //   }
  // }, [user]);

  const cleanupRecognition = () => {
    try {
      if (recognizerRef.current) {
        try {
          recognizerRef.current.close();
        } catch (error) {
        } finally {
          recognizerRef.current = null;
        }
      }
      if (audioStreamRef.current) {
        try {
          audioStreamRef.current.getTracks().forEach(track => {
            if (track && typeof track.stop === 'function') {
              track.stop();
            }
          });
        } catch (error) {
        } finally {
          audioStreamRef.current = null;
        }
      }
      setListening(false);
      if (mediaRecorderRef.current) {
        try {
          if (mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        } catch (error) {}
        mediaRecorderRef.current = null;
      }
    } catch (error) {
      recognizerRef.current = null;
      audioStreamRef.current = null;
      mediaRecorderRef.current = null;
      setListening(false);
    }
  };

  useEffect(() => {
    return cleanupRecognition;
  }, []);

  // Update ref when isListening state changes
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Update other refs when their states change
  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  useEffect(() => {
    screenshotQueueRef.current = screenshotQueue;
  }, [screenshotQueue]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    isSolvingScreenshotsRef.current = isSolvingScreenshots;
  }, [isSolvingScreenshots]);

  useEffect(() => {
    resumeContextRef.current = resumeContext;
  }, [resumeContext]);

  useEffect(() => {
    const appContainer = document.querySelector('.App');
    if (appContainer) {
      appContainer.style.background = `linear-gradient(135deg, rgba(50, 50, 55, ${glassOpacity}), rgba(70, 70, 75, ${glassOpacity}))`;
    }
  }, [glassOpacity]);

  useEffect(() => {
    if (isSettingsHovered && settingsRef.current) {
      const settingsHeight = settingsRef.current.scrollHeight;
      const appHeight = document.querySelector('.App').scrollHeight;
      const totalHeight = 20;
      if (window.electron && window.electron.setSize) {
        window.electron.setSize(600, Math.max(150, totalHeight));
      }
    }
  }, [isSettingsHovered]);

  useEffect(() => {
    let panelHeight = 0;
    if (isSettingsHovered && settingsRef.current) {
      panelHeight = settingsRef.current.scrollHeight;
    } else if (isShortcutsHovered && shortcutsRef.current) {
      panelHeight = shortcutsRef.current.scrollHeight;
    }
    
    // Get the actual content area height
    const contentArea = document.querySelector('.content-area');
    const contentHeight = contentArea ? contentArea.scrollHeight : 0;
    
    // Calculate total height including content area
    const appHeight = document.querySelector('.App').scrollHeight;
    let totalHeight = appHeight + (panelHeight ? panelHeight : 0) + 20;
    
    // If there's content in the content area, use that for dynamic sizing
    if (contentHeight > 0) {
      totalHeight = Math.max(totalHeight, contentHeight + 120); // 120px for header and padding
    }

    // Cap the window height at the available screen height
    let maxHeight = window.screen && window.screen.availHeight ? window.screen.availHeight : 800;
    totalHeight = Math.min(totalHeight, maxHeight);
    
    if (window.electron && window.electron.setSize) {
      window.electron.setSize(600, Math.max(150, totalHeight));
    }
  }, [transcript, aiResponse, isSettingsHovered, isShortcutsHovered, isThinking, isSolvingScreenshots, screenshotQueue.length]);

  // Helper: check if a string is a question
  const isQuestion = (text) => {
    if (!text) return false;
    const lower = text.trim().toLowerCase();
    if (lower.includes('?')) return true;
    return QUESTION_WORDS.some(word => lower.startsWith(word + ' '));
  };

  // Use AssemblyAI for speech-to-text
  const startRecognition = async () => {
  // email constraint fully removed
    if (planRef.current === 'Free Plan' && micShortcutCountRef.current >= FREE_LIMITS.mic) {
  // plan constraint removed
    }
    if (isListening || (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive')) {
      // Already running, do not start another
      return;
    }
    // Always increment usage for all users
  // usage tracking removed
    // micShortcutCountRef.current += 1;
    setListening(true);
    setTranscript('');
    setAiResponse('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new window.MediaRecorder(stream);
      audioChunks = [];
      mediaRecorderRef.current.ondataavailable = event => {
        audioChunks.push(event.data);
      };
      mediaRecorderRef.current.onstop = async () => {
        try {
          if (!audioChunks.length) {
            setListening(false);
            cleanupRecognition();
            mediaRecorderRef.current = null;
            return;
          }
          const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
          // 1. Upload audio to AssemblyAI
          const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: { 'authorization': ASSEMBLYAI_API_KEY },
            body: audioBlob
          });
          const uploadData = await uploadRes.json();
          const audio_url = uploadData.upload_url;
          // 2. Request transcription
          const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
            method: 'POST',
            headers: {
              'authorization': ASSEMBLYAI_API_KEY,
              'content-type': 'application/json'
            },
            body: JSON.stringify({ audio_url })
          });
          const transcriptData = await transcriptRes.json();
          const transcriptId = transcriptData.id;
          // 3. Poll for result
          let transcriptText = '';
          while (true) {
            // No user/email constraint
            const pollingRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
              headers: { 'authorization': ASSEMBLYAI_API_KEY }
            });
            const pollingData = await pollingRes.json();
            if (pollingData.status === 'completed') {
              transcriptText = pollingData.text;
              break;
            } else if (pollingData.status === 'failed') {
              transcriptText = '';
              break;
            }
            await new Promise(res => setTimeout(res, 2000));
          }
          setTranscript(transcriptText);
          setListening(false);
          cleanupRecognition();
          mediaRecorderRef.current = null;
          if (transcriptText) {
            await sendToOpenAI(transcriptText, null, selectedLanguage);
          }
        } catch (err) {
          setListening(false);
          cleanupRecognition();
          mediaRecorderRef.current = null;
        }
      };
      mediaRecorderRef.current.onerror = (e) => {
        setListening(false);
        cleanupRecognition();
        mediaRecorderRef.current = null;
      };
      mediaRecorderRef.current.onstart = () => {};
      mediaRecorderRef.current.onpause = () => {};
      mediaRecorderRef.current.onresume = () => {};
      mediaRecorderRef.current.onstop = mediaRecorderRef.current.onstop; // Ensure onstop is set
      mediaRecorderRef.current.start();
    } catch (err) {
      setListening(false);
      cleanupRecognition();
      mediaRecorderRef.current = null;
    }
  };

  const stopRecognition = async (isLogout = false) => {
    setListening(false);
    // No increment here, only in startRecognition
  // No user/email constraint
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          setListening(false);
          cleanupRecognition();
          mediaRecorderRef.current = null;
        }
      }, 2000);
    } else {
      setListening(false);
      cleanupRecognition();
      mediaRecorderRef.current = null;
    }
  };

  const handleResumeUpload = async (event) => {
  // email constraint fully removed
    if (planRef.current === 'Free Plan') {
  // plan constraint removed

    }
  // usage tracking removed
    const file = event.target.files[0];
    if (!file) return;
    setIsUploadingResume(true);
    let extractedText = '';
    try {
      if (file.type === 'application/pdf') {
        // Check if Azure Document Intelligence credentials are available
        if (!AZURE_DOC_INTELLIGENCE_KEY || !AZURE_DOC_INTELLIGENCE_ENDPOINT) {
          // For testing, just use a placeholder text
          extractedText = `This is a test resume for ${file.name}. \n\nSkills: JavaScript, React, Node.js, Python, Java\nExperience: 3 years as Full Stack Developer\nEducation: Bachelor's in Computer Science\nProjects: E-commerce platform, Mobile app development\n\nThis is a placeholder resume content for testing purposes.`;
        } else {
          // Use Azure Document Intelligence for PDF parsing
          const url = `${AZURE_DOC_INTELLIGENCE_ENDPOINT}formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;
          const pdfArrayBuffer = await file.arrayBuffer();
          const response = await axios.post(url, pdfArrayBuffer, {
            headers: {
              'Content-Type': 'application/pdf',
              'Ocp-Apim-Subscription-Key': AZURE_DOC_INTELLIGENCE_KEY,
            },
            maxBodyLength: Infinity,
          });
          // Poll the operation-location for result
          const operationLocation = response.headers['operation-location'];
          let pollResult = null;
          for (let i = 0; i < 20; i++) { // Poll up to 20 times (about 20 seconds)
            await new Promise(res => setTimeout(res, 1000));
            const pollResponse = await axios.get(operationLocation, {
              headers: {
                'Ocp-Apim-Subscription-Key': AZURE_DOC_INTELLIGENCE_KEY,
              },
            });
            if (pollResponse.data.status === 'succeeded') {
              pollResult = pollResponse.data;
              break;
            } else if (pollResponse.data.status === 'failed') {
              throw new Error('Azure Document Intelligence failed to analyze the document.');
            }
          }
          if (!pollResult) throw new Error('Timed out waiting for Azure Document Intelligence.');
          // Extract text from the result
          extractedText = pollResult.analyzeResult.content || '';
        }
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.name.endsWith('.docx')
      ) {
        // DOCX parsing
        const arrayBuffer = await file.arrayBuffer();
        const result = await Mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else {
        setAiResponse('Unsupported file type. Please upload a PDF or DOCX resume.');
        setIsUploadingResume(false);
        return;
      }
      // Send extracted text to OpenAI for context
      const contextPrompt = `Please analyze this resume and extract key complete information about my general details, background, skills, experience, and projects. Format it clearly for future interview questions.\n\nRESUME CONTENT:\n${extractedText}\n\nPlease provide a structured summary of my background that can be used for answering interview questions. Focus on:\n- My technical skills and programming languages\n- Work experience and projects\n- Education and certifications\n- Key achievements and responsibilities\n\nFormat this as a clear, structured summary that I can reference during interviews.`;
      await sendToOpenAI(contextPrompt);
      setResumeContext(extractedText);
      resumeContextRef.current = extractedText; // Set ref directly as well
      setResumeUploaded(true);
      setTestUsed(false); // Reset test-used state on new upload
      setAiResponse('Resume uploaded and analyzed successfully! You can now ask interview questions and I will answer based on your actual background and experience.');
    } catch (error) {
      setAiResponse('Failed to parse or analyze resume. Please try again.');
    }
    setIsUploadingResume(false);
  };

  const sendToOpenAI = async (prompt, imageData = null, language = null, token = null, retryCount = 0) => {
    if (!API_KEY || !API_URL || !DEPLOYMENT_ID) {
      setAiResponse('OpenAI API configuration is missing. Please check environment variables.');
      setIsThinking(false);
      return;
    }

    setLastPrompt(prompt);
    setLastImageData(imageData);
    setLastLanguage(language);
    setShowRetry(false);

    // Use the passed language parameter, or fallback to the current selectedLanguage from ref
    const targetLanguage = language || selectedLanguageRef.current;
    
    setIsThinking(true);

    const thisToken = token !== null ? token : latestRequestToken.current;

    try {
      const messages = [];
      
      // Set up system message based on whether resume is uploaded
      if (resumeContextRef.current) {
        const systemMessage = `You are an interview assistant with access to the user's resume. You must answer all questions based on the user's actual background and experience from their resume. 

RESUME CONTEXT:
${resumeContextRef.current}

IMPORTANT INSTRUCTIONS:
1. Always answer questions from the user's perspective using their actual experience if needed from the resume
2. If a question asks about something not in the resume, answer it very short and give answer"
3. Keep answers concise, very short and interview-ready
4. Use specific examples from the resume when possible
5. If it's a coding question or asking defination, provide the defination and solution in ${targetLanguage} dont use resume content here.
6. Be honest about limitations based on the resume content
7. NEVER introduce yourself as an AI assistant - always answer as the person from the resume`;
        
        messages.push({
          role: 'system',
          content: systemMessage,
        });
      } else {
        messages.push({
          role: 'system',
          content: `You are a coding/aptitude assistant that provides solutions in ${targetLanguage}.`,
        });
      }

      let userPrompt = prompt;
      
      // For non-screenshot questions, enhance the prompt with resume context if available
      if (!imageData && resumeContextRef.current) {
        userPrompt = `Question: ${prompt}\n\nPlease answer this question based on my resume background and experience.`;
      }
      
      if (imageData) {
        userPrompt = `You are an expert coding and aptitude interview assistant. Analyze the image(s) for either a coding problem or an aptitude/option-based question.\n\nIf it is a coding problem and a correct solution/code is present in the image, respond with three sections:\n\n**Comparison:**\n- Compare the provided solution with an optimized solution. If the provided solution is wrong, correct it and provide the updated solution.\n\n**Optimized Solution:**\n- The best/optimized solution in ${targetLanguage}, perfectly formatted, with comments allowed, very small font, and syntax highlighting.\n\n**Complexity:**\n- Time Complexity: O(n)\n- Space Complexity: O(1)\n\nIf no solution is present and basic structure of code is there , respond with three sections:\n\n**Approach:**\n- Three concise bullet points describing the approach, in a way that I can read directly to an interviewer.\n\n**Solution:**\n- The complete solution which is filled in basic structure of code and dont change function names just fill code in it in ${targetLanguage}, perfectly formatted, with comments allowed with every line, very small font, and syntax highlighting.\n\n**Complexity:**\n- Time Complexity: O(n)\n- Space Complexity: O(1)\n\n.
        If it is an **aptitude or option-based question**, follow this format strictly:

- Carefully observe all parts of the screenshot (question, diagram, data).
- Think step-by-step, and ensure complete accuracy before answering.

Then respond in **exactly two sections**, using the following structure:

**Answer:**
- State the correct answer option (e.g., Option C or Option A) and give answer, clearly and confidently.

**Short Explanation:**
- Provide a **step-by-step explanation** of how the answer was derived.
- Use concise logic, calculations, or elimination to explain the reasoning.
- Ensure the explanation is understandable by a non-expert reader (like an interview candidate).
- Avoid markdown, bold, or unnecessary symbols—this should be clean, plain text, ready to read aloud or copy-paste into a UI.

---

Do NOT introduce yourself. Do NOT provide any headers or summaries beyond what's described. Only output the sections as specified. Think carefully and prioritize clarity and correctness in all answers.
`;
      }

      if (imageData) {
        // Handle both single image and array of images
        const images = Array.isArray(imageData) ? imageData : [imageData];
        const content = [
          { type: 'text', text: userPrompt },
          ...images.map(img => ({ type: 'image_url', image_url: { url: img } }))
        ];
        
        messages.push({
          role: 'user',
          content: content,
        });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }

      const response = await axios.post(
        `${API_URL}openai/deployments/${DEPLOYMENT_ID}/chat/completions?api-version=2024-02-15-preview`,
        {
          messages: messages,
          temperature: 0.3,
          max_tokens: 1500,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': API_KEY,
          },
          timeout: 30000,
        }
      );

      if (thisToken === latestRequestToken.current) {
        if (response && response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
          const cleanResponse = response.data.choices[0].message.content
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/```/g, '')
            .replace(/`/g, '')
            .trim();
          setAiResponse(cleanResponse);
          setShowRetry(false);
        } else {
          setAiResponse('Received an unexpected response format from the API.');
        }
      }
    } catch (error) {
      
      if (thisToken === latestRequestToken.current) {
        if (error && error.response) {
          setAiResponse(`API Error: ${error.response.status} - ${error.response.data?.error?.message || 'Unknown error'}`);
        } else if (error && error.request) {
          if (retryCount < 2) {
            // Retry after a short delay
            setTimeout(() => {
              sendToOpenAI(prompt, imageData, language, token, retryCount + 1);
            }, 1200);
            return;
          } else {
            setAiResponse('Network error: Unable to reach the API after several attempts. Please check your internet connection, API key, and endpoint.');
            setShowRetry(true);
          }
        } else {
          setAiResponse(`Error: ${error?.message || 'Unknown error occurred'}`);
        }
      }
    } finally {
      if (thisToken === latestRequestToken.current) {
        setIsThinking(false);
      }
    }
  };

  const handleRetry = () => {
    setAiResponse('');
    setShowRetry(false);
    sendToOpenAI(lastPrompt, lastImageData, lastLanguage);
  };

  const takeScreenshot = async (language) => {
    try {
      let dataUrl;
      if (!window.electron || !window.electron.captureScreen) {
        const element = document.body;
        const canvas = await html2canvas(element);
        dataUrl = canvas.toDataURL('image/png');
      } else {
        dataUrl = await window.electron.captureScreen();
      }
      setScreenshotQueue((prev) => {
        // Store both image data and language
        const screenshotData = { image: dataUrl, language: language };
        const newQueue = prev.some(item => item.image === dataUrl) ? prev : [...prev, screenshotData];
        return newQueue;
      });
    } catch (error) {
      setAiResponse(`Failed to capture screenshot: ${error.message}`);
    }
  };

  const solveScreenshots = async () => {
  // email constraint fully removed
    if (planRef.current === 'Free Plan') {
  // plan constraint removed

    }
          // usage tracking removed
    if (solvingScreenshotsInProgressRef.current) {
      return;
    }
    solvingScreenshotsInProgressRef.current = true;
    if (screenshotQueueRef.current.length === 0) {
      setAiResponse('No screenshots found.');
      solvingScreenshotsInProgressRef.current = false;
      return;
    }
    setIsThinking(true);
    setAiResponse('');
    const newToken = requestToken + 1;
    setRequestToken(newToken);
    latestRequestToken.current = newToken;
    try {
      // Use the ref to get the current screenshots
      const allScreenshots = [...screenshotQueueRef.current];
      // Extract image data and determine the language to use
      const imageData = allScreenshots.map(item => item.image);
      // Use the language from the first screenshot, or fallback to selectedLanguage
      const languageToUse = allScreenshots[0]?.language || selectedLanguage;
      // Always require step-by-step explanation and answer for all screenshot questions
      let prompt = '';
      if (allScreenshots.length > 1) {
        prompt = `There are ${allScreenshots.length} screenshots that are all part of the same question/problem. Please analyze all images together and provide a comprehensive solution. Carefully observe every part of each screenshot. For every question, always provide a detailed step-by-step explanation under the 'short explanation' section, and only give the final answer after your reasoning. Think deeply and ensure the answer is accurate and correct. Do not rush; correctness and thoroughness are most important.`;
      } else {
        prompt = `Carefully observe every part of the screenshot. For every question, always provide a detailed step-by-step explanation under the 'short explanation' section, and only give the final answer after your reasoning. Think deeply and ensure the answer is accurate and correct. Do not rush; correctness and thoroughness are most important.`;
      }
      await sendToOpenAI(prompt, imageData, languageToUse, newToken);
      setScreenshotQueue([]);
    } catch (error) {
      if (newToken === latestRequestToken.current) {
        setAiResponse(`Failed to solve screenshots: ${error.message || 'Unknown error'}`);
      }
    }
    if (newToken === latestRequestToken.current) {
      setIsThinking(false);
    }
    solvingScreenshotsInProgressRef.current = false;
  };

  const startOver = () => {
    setTranscript('');
    setAiResponse('');
    setIsThinking(false);
    setScreenshotQueue([]);
    //tResumeContext(null);
    //sumeContextRef.current = null; // Clear ref as well
    //tResumeUploaded(false);
    // Invalidate all previous requests
    const newToken = requestToken + 1;
    setRequestToken(newToken);
    latestRequestToken.current = newToken;
    if (isListening) {
      stopRecognition();
    }
  };

  // Helper to parse and render screenshot AI responses attractively
  function renderScreenshotResponse(aiResponse) {
    if (!aiResponse) return null;
    // Split into sections by headings (case-insensitive)
    const sections = {};
    let current = null;
    let buffer = [];
    const lines = aiResponse.split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (/^(comparison|approach|solution|optimized solution|complexity|answer|short explanation)[:：]?/i.test(trimmed)) {
        if (current && buffer.length) {
          sections[current] = buffer.join('\n').trim();
        }
        const heading = trimmed.match(/^(comparison|approach|solution|optimized solution|complexity|answer|short explanation)/i)[0].toLowerCase();
        current = heading;
        buffer = [trimmed.replace(/^(comparison|approach|solution|optimized solution|complexity|answer|short explanation)[:：]?/i, '').trim()];
      } else {
        buffer.push(line);
      }
    });
    if (current && buffer.length) {
      sections[current] = buffer.join('\n').trim();
    }

    // Render sections in order
    const order = [
      'comparison',
      'approach',
      'solution',
      'optimized solution',
      'complexity',
      'short explanation',
      'answer'
    ];
    return (
      <div className="screenshot-response-box">
        {order.map(key => {
          if (key === 'comparison' && sections[key]) {
            // Render comparison as bullets
            const points = sections[key].split(/^-|\n-?|\n\d+\.|\n•|\n|;|\u2022/).filter(Boolean);
            return (
              <div key={key} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 4, letterSpacing: 0.2 }}>
                  Comparison
                </div>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  {points.map((point, idx) => (
                    <li key={idx} style={{ color: '#f8fafd', fontSize: 15, marginBottom: 4, listStyleType: 'disc' }}>{point.trim()}</li>
                  ))}
                </ul>
              </div>
            );
          }
          // If comparison is present, skip approach
          if (key === 'approach' && sections['comparison']) return null;
          if (key === 'approach') {
            return (
              <div key={key} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 4, letterSpacing: 0.2 }}>
                  Approach
                </div>
                {sections[key] ? (
                  <ul style={{ paddingLeft: 20, margin: 0 }}>
                    {sections[key].split(/^-|\n-?|\n\d+\.|\n•|\n/).filter(Boolean).map((point, idx) => (
                      <li key={idx} style={{ color: '#f8fafd', fontSize: 15, marginBottom: 4, listStyleType: 'disc' }}>{point.trim()}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ color: '#f8fafd', fontSize: 15, fontStyle: 'italic' }}>No approach provided by AI Or Limit Completed.</div>
                )}
              </div>
            );
          }
          if (key === 'complexity' && sections[key]) {
            // Improved complexity parsing
            const complexityText = sections[key];
            
            // Try to find time complexity
            let timeComplexity = null;
            let spaceComplexity = null;
            
            // Look for explicit "Time Complexity" or "Time:" patterns - include the full label
            const timeMatch = complexityText.match(/((?:time\s*complexity|time)\s*[:：]\s*[^\n\r;]+)/i);
            if (timeMatch) {
              timeComplexity = timeMatch[1].trim();
            }
            
            // Look for explicit "Space Complexity" or "Space:" patterns - include the full label
            const spaceMatch = complexityText.match(/((?:space\s*complexity|space)\s*[:：]\s*[^\n\r;]+)/i);
            if (spaceMatch) {
              spaceComplexity = spaceMatch[1].trim();
            }
            
            // If explicit patterns not found, try to split by common separators
            if (!timeComplexity || !spaceComplexity) {
              const parts = complexityText.split(/[;\n\r]/).filter(part => part.trim());
              
              // Find parts containing time-related keywords
              const timePart = parts.find(part => 
                /time|o\(|big\s*o/i.test(part) && !/space/i.test(part)
              );
              if (timePart && !timeComplexity) {
                timeComplexity = timePart.trim();
              }
              
              // Find parts containing space-related keywords
              const spacePart = parts.find(part => 
                /space|memory/i.test(part) && !/time/i.test(part)
              );
              if (spacePart && !spaceComplexity) {
                spaceComplexity = spacePart.trim();
              }
            }
            
            // Fallback: if still not found, show the full text
            if (!timeComplexity && !spaceComplexity) {
              return (
                <div key={key} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 4, letterSpacing: 0.2 }}>
                    Complexity
                  </div>
                  <div style={{ fontSize: 15, color: '#f8fafd' }}>{complexityText}</div>
                </div>
              );
            }
            
            return (
              <div key={key} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 4, letterSpacing: 0.2 }}>
                  Complexity
                </div>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  <li style={{ color: '#f8fafd', fontSize: 15, marginBottom: 4, listStyleType: 'disc' }}>
                    {timeComplexity || 'Time complexity not provided.'}
                  </li>
                  <li style={{ color: '#f8fafd', fontSize: 15, marginBottom: 4, listStyleType: 'disc' }}>
                    {spaceComplexity || 'Space complexity not provided.'}
                  </li>
                </ul>
              </div>
            );
          }
          if ((key === 'solution' || key === 'optimized solution') && sections[key]) {
            return (
              <div key={key} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 4, letterSpacing: 0.2 }}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </div>
                <pre className="solution-block" style={{
                  background: '#23272e',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '14px 18px',
                  fontSize: 13,
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  margin: 0,
                  border: '1px solid #444',
                  fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  width: '100%',
                  minWidth: 0,
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  whiteSpace: 'pre',
                  wordBreak: 'break-word',
                  boxShadow: '0 2px 12px 0 rgba(25, 118, 210, 0.10)',
                  scrollbarColor: '#1976d2 #23272e',
                  scrollbarWidth: 'thin',
                }}>
                  <code className="code-highlight">{sections[key]}</code>
                </pre>
              </div>
            );
          }
          // Default rendering for other sections
          if (key === 'short explanation' && sections[key]) {
            return (
              <div key={key} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 4, letterSpacing: 0.2 }}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </div>
                <pre style={{ fontSize: 15, color: '#f8fafd', background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '8px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', margin: 0 }}>{sections[key]}</pre>
              </div>
            );
          }
          return sections[key] ? (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 4, letterSpacing: 0.2 }}>
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </div>
              <div style={{ fontSize: 15, color: '#f8fafd', background: key === 'answer' ? 'rgba(255,255,255,0.08)' : 'none', borderRadius: 4, padding: key === 'answer' ? '6px 10px' : 0, fontWeight: key === 'answer' ? 600 : 400 }}>{sections[key]}</div>
            </div>
          ) : null;
        })}
      </div>
    );
  }

  // Replace handleLogin and handleLogout logic
  const handleLogin = () => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    const redirectUri = "http://localhost:3005/auth-callback";
    const scope = "profile email";
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    if (window.electron && window.electron.openExternal) {
      window.electron.openExternal(url);
    }
    // No fallback to window.open
  };
  const handleLogout = async () => {
    setListening(false);
    await stopRecognition(true);
    await signOut(auth);
    setUser(null);
  };

  useEffect(() => {
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.on('google-auth-token', (event, token) => {
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(profile => {
            setUser({
              name: profile.name,
              email: profile.email,
              photo: profile.picture,
              uid: profile.sub, // Google sub is unique user ID
              displayName: profile.name,
              photoURL: profile.picture,
            });
          });
      });
    }
  }, []);

  // If handleSliderChange is used in JSX, define it:
  function handleSliderChange(event) {
    setGlassOpacity(parseFloat(event.target.value));
  }

  // Add at the top, after other useRefs:
  const USAGE_RESET_KEY = 'crackmate_free_usage_reset';
  const USAGE_COUNTS_KEY = 'crackmate_free_usage_counts';

  // Helper: get usage ref for current user
  // Removed usage ref helper

  // Helper: reset usage in RTDB
  // Removed usage reset helper

  // On login, fetch or initialize usage data
  // Removed usage tracking effect

  // Helper: increment usage in RTDB
  // Removed usage increment helper

  // Helper for the new limit message
  const limitMessage = (
    <span>
      Free limit completed. Buy a plan to get unlimited usage on our website{' '}
      <span
        style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer' }}
        onClick={() => window.electron && window.electron.openExternal && window.electron.openExternal('https://copilot.crackmateai.in/')}
      >
        here
      </span>. Or Wait For 24 Hours.
    </span>
  );

  // Add a userRef to always get the latest user value
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // Add a planRef to always get the latest plan value
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; }, [plan]);

  // In the useEffect that runs on user change, clear resume context and uploaded state on logout
  useEffect(() => {
    if (!userRef.current) {
      setResumeContext(null);
      resumeContextRef.current = null;
      setResumeUploaded(false);
    }
  }, [user]);

  return (
    <div className="App">
      <div className="app-title-section" style={{ width: '100%', display: 'flex', alignItems: 'center', marginBottom: 6, marginTop: 2 }}>
        <img src={`${process.env.PUBLIC_URL}/assets/Logo.png`} alt="Logo" style={{ height: 32, width: 32, marginRight: 10 }} />
        <span style={{
          fontFamily: 'Poppins, Inter, Segoe UI, Arial, sans-serif',
          fontWeight: 900,
          fontSize: 20,
          letterSpacing: 0.6,
          display: 'inline-block',
          textShadow: '0 1px 6px rgba(25, 118, 210, 0.10)',
          marginLeft: -3,
          marginTop: -2
        }}>
          <span style={{ color: '#A8AFB5' }}>Crack</span>
          <span style={{ color: '#A8AFB5' }}>Mate</span>
          <span style={{ color: '#A8AFB5', marginLeft: 8 }}>Copilot</span>
        </span>
      </div>
      <div className="top-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            variant={'outlined'}
            color="primary"
            size="small"
            onClick={isListening ? () => { stopRecognition(); } : () => { startRecognition(); }}
            disabled={isThinking || isSolvingScreenshots}
            sx={{
              minWidth: 90,
              height: 32,
              fontWeight: 600,
              fontSize: 14,
              borderRadius: 2,
              boxShadow: 0,
              textTransform: 'none',
              letterSpacing: 0.2,
              background: '#A8AFB5',
              color: '#110F40',
              border: '1px solid #110F40',
              opacity: !userRef.current || isThinking || isSolvingScreenshots || (planRef.current === 'Free Plan' && micShortcutCountRef.current >= FREE_LIMITS.mic) ? 0.7 : 1,
              cursor: !userRef.current || isThinking || isSolvingScreenshots || (planRef.current === 'Free Plan' && micShortcutCountRef.current >= FREE_LIMITS.mic) ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s',
            }}
          >
            {isSolvingScreenshots ? 'Wait...' : isListening ? 'Stop' : 'Start Mic'}
          </Button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', flex: 1 }}>
          {/* Upload Resume Button (only show if not uploaded) */}
            {!resumeUploaded && (
              <Button
                component="label"
                variant="contained"
                color="primary"
                size="small"
                startIcon={<CloudUploadIcon />}
                sx={{
                  minWidth: 110,
                  height: 32,
                  fontWeight: 600,
                  fontSize: 14,
                  borderRadius: 2,
                  boxShadow: 0,
                  textTransform: 'none',
                  letterSpacing: 0.2,
                  background: '#A8AFB5',
                  color: '#110F40',
                  border: '1px solid #110F40',
                  opacity: 1,
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                }}
              >
                Upload Resume
                <VisuallyHiddenInput
                  type="file"
                  accept=".pdf"
                  onChange={handleResumeUpload}
                />
              </Button>
            )}
          {isUploadingResume && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CircularProgress size={18} color="primary" />
              <span style={{ color: '#1976d2', fontWeight: 500, fontSize: 14 }}>Uploading...</span>
            </div>
          )}
          {resumeUploaded && !isUploadingResume && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 4, 
                padding: '4px 8px', 
                background: '#e8f5e8', 
                color: '#2e7d32', 
                borderRadius: 4, 
                fontSize: 12, 
                fontWeight: 600 
              }}>
                <span>📄</span>
                Resume Active
              </div>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  if (!testUsed) {
                    sendToOpenAI('Tell me about my experience with JavaScript');
                    setTestUsed(true);
                  }
                }}
                disabled={testUsed}
                sx={{ 
                  minWidth: 60, 
                  height: 24, 
                  fontSize: 10, 
                  borderRadius: 2, 
                  borderColor: '#110F40',
                  color: '#110F40',
                  background: '#A8AFB5',
                  '&:hover': {
                    borderColor: '#110F40',
                    backgroundColor: '#A8AFB5',
                  }
                }}
              >
                Test
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setResumeContext(null);
                  resumeContextRef.current = null; // Clear ref as well
                  setResumeUploaded(false);
                  setTestUsed(false); // Re-enable Test button
                  setAiResponse('Resume context cleared. You can now ask general questions or upload a new resume.');
                }}
                sx={{ 
                  minWidth: 60, 
                  height: 24, 
                  fontSize: 10, 
                  borderRadius: 2, 
                  borderColor: '#A8AFB5',
                  color: '#110F40',
                  background: '#A8AFB5',
                  '&:hover': {
                    borderColor: '#110F40',
                    backgroundColor: '#A8AFB5'
                  }
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            className="shortcuts-container"
            onMouseEnter={() => setIsShortcutsHovered(true)}
            onMouseLeave={() => setIsShortcutsHovered(false)}
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <span className="shortcuts-icon"><KeyboardIcon style={{ fontSize: 28, cursor: 'pointer' }} /></span>
            {isShortcutsHovered && (
              <div 
                className="settings-content shortcuts-content" 
                ref={shortcutsRef} 
                style={{ position: 'absolute', right: 0, top: 40, zIndex: 1000, background: '#A8AFB5', border: '1px solid #110F40', color: '#110F40' }}
                onMouseEnter={() => setIsShortcutsHovered(true)}
                onMouseLeave={() => setIsShortcutsHovered(false)}
              >
                <p className="title" style={{ color: '#110F40', fontWeight: 700 }}>Keyboard Shortcuts</p>
                <div className="shortcut-item">
                  <div className="shortcut-title" style={{ color: '#110F40' }}>
                    Take Screenshot <span className="key-combo" style={{ background: '#110F40', color: '#A8AFB5' }}>Ctrl + H</span>
                  </div>
                  <p className="shortcut-description" style={{ color: '#110F40' }}>Capture the problem description as a screenshot.</p>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-title" style={{ color: '#110F40' }}>
                    Start Over <span className="key-combo" style={{ background: '#110F40', color: '#A8AFB5' }}>Ctrl + G</span>
                  </div>
                  <p className="shortcut-description" style={{ color: '#110F40' }}>Reset and start a new session.</p>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-title" style={{ color: '#110F40' }}>
                    Move Window <span className="key-combo" style={{ background: '#110F40', color: '#A8AFB5' }}>Ctrl + Arrow Keys</span>
                  </div>
                  <p className="shortcut-description" style={{ color: '#110F40' }}>Reposition the window using arrow keys.</p>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-title" style={{ color: '#110F40' }}>
                    Toggle App Visibility <span className="key-combo" style={{ background: '#110F40', color: '#A8AFB5' }}>Ctrl + .</span>
                  </div>
                  <p className="shortcut-description" style={{ color: '#110F40' }}>Show or hide the app window.</p>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-title" style={{ color: '#110F40' }}>
                    Quit App <span className="key-combo" style={{ background: '#110F40', color: '#A8AFB5' }}>Ctrl + Q</span>
                  </div>
                  <p className="shortcut-description" style={{ color: '#110F40' }}>Exit the application.</p>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-title" style={{ color: '#110F40' }}>
                    Solve Screenshots <span className="key-combo" style={{ background: '#110F40', color: '#A8AFB5' }}>Ctrl + Enter</span>
                  </div>
                  <p className="shortcut-description" style={{ color: '#110F40' }}>Send all captured screenshots for AI solution.</p>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-title" style={{ color: '#110F40' }}>
                    Mic Toggle <span className="key-combo" style={{ background: '#110F40', color: '#A8AFB5' }}>Ctrl + M</span>
                  </div>
                  <p className="shortcut-description" style={{ color: '#110F40' }}>Start or stop voice recognition.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="content-area">
        {isListening && (
          <p className="listening-indicator">Listening...</p>
        )}
        {transcript && !isListening && (
          <p className="result"><strong>You said:</strong> {transcript}</p>
        )}
        {(isThinking || isSolvingScreenshots) && (
          <div className="loading-container">
            <div className="loading-spinner">
              <CircularProgress size={24} color="primary" />
            </div>
            <div className="loading-text">
              <span className="loading-title">Processing your request...</span>
              <span className="loading-subtitle">Analyzing and generating response</span>
            </div>
          </div>
        )}
        {aiResponse && !isThinking && (
          <>
            {/* If the last action was screenshot solving, render attractively */}
            {isSolvingScreenshots === false && lastImageData ? (
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1976d2', marginBottom: 8 }}>
                  AI Says: {resumeUploaded && <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 500 }}>📄 Based on your resume</span>}
                </div>
                {renderScreenshotResponse(aiResponse)}
              </div>
            ) : (
              <p className="response">
                <strong>AI Says:</strong> {aiResponse}
                {resumeUploaded && <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 500, marginLeft: 8 }}>📄 Based on your resume</span>}
              </p>
            )}
            {showRetry && (
              <button onClick={handleRetry} style={{
                marginTop: 10,
                padding: '8px 18px',
                background: '#1976d2',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 15,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(25,118,210,0.08)'
              }}>
                Retry
              </button>
            )}
          </>
        )}
      </div>

      {screenshotQueue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
            Screenshots in queue: {screenshotQueue.length}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            {screenshotQueue.map((img, idx) => (
              <div key={idx} style={{ position: 'relative' }}>
                <img src={img.image} alt={`Screenshot ${idx + 1}`} style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid #ccc' }} />
                <div style={{ 
                  position: 'absolute', 
                  top: -8, 
                  right: -8, 
                  background: '#1976d2', 
                  color: 'white', 
                  fontSize: 10, 
                  padding: '2px 4px', 
                  borderRadius: 4,
                  fontWeight: 'bold'
                }}>
                  {img.language}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .settings-content .shortcut-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 14px;
          font-weight: 600;
          color: #1976d2;
        }
        .settings-content .key-combo {
          margin-left: 16px;
          color: #1976d2;
          font-weight: 600;
          // font-size: 12px;
          background: #e3f2fd;
          border-radius: 4px;
          padding: 2px 8px;
          text-align: right;
          display: inline-block;
        }
        .settings-content .shortcut-description {
          color: #555;
          font-size: 11px;
          margin-left: 0;
        }
        .settings-content .shortcut-item {
          margin-bottom: 10px;
        }
        .settings-content .title {
          color: #1976d2;
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .screenshot-response-box {
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 16px;
        }
        .solution-block {
          white-space: pre-wrap;
          word-break: break-all;
        }
        .solution-block::-webkit-scrollbar {
          height: 6px;
        }
        .solution-block::-webkit-scrollbar-thumb {
          background: #1976d2;
          border-radius: 3px;
        }
        .solution-block::-webkit-scrollbar-track {
          background: #23272e;
        }
        .solution-block {
          scrollbar-width: thin;
          scrollbar-color: #1976d2 #23272e;
        }
      `}</style>
    </div>
  );
};

export default App;