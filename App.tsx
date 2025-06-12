
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import ChatInterface from './components/ChatInterface';
import Sidebar from './components/Sidebar';
import MenuIcon from './components/icons/MenuIcon';
import UserIcon from './components/icons/UserIcon';
import { auth, googleProvider, signInWithPopup, firebaseSignOut, onAuthStateChanged } from './firebase';
import { User, ChatSession, ChatMessage, ModelType, Sender } from './types';
import { 
  LOGO_URL, HEADER_TITLE_BN, LOGIN_WITH_GOOGLE_BN, LOGOUT_BN, WELCOME_USER_BN, PROFILE_BUTTON_LABEL_BN,
  CHAT_HISTORY_KEY, ACTIVE_CHAT_ID_KEY, DEFAULT_MODEL_TYPE, GEMINI_TEXT_MODEL_FLASH,
  ERROR_API_KEY_MISSING_BN, ERROR_INIT_FAILED_BN, INITIAL_WELCOME_MESSAGE_BN,
  SYSTEM_INSTRUCTION_B1_BN, SYSTEM_INSTRUCTION_B2_BN, DEFAULT_CHAT_TITLE_BN,
  SPLASH_SCREEN_LOADING_BN, SPLASH_SCREEN_TITLE_BN
} from './constants';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<Record<string, ChatSession>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isChatInitializing, setIsChatInitializing] = useState(true);
  
  const apiKey = process.env.API_KEY;
  const chatSessionRef = useRef<Chat | null>(null);

  useEffect(() => {
    const splashTimer = setTimeout(() => {
      setShowSplash(false);
      const splashElement = document.getElementById('splash-screen');
      if (splashElement) {
        splashElement.classList.add('hidden');
      }
    }, 2000); // Show splash for 2 seconds

    const unsubscribe = onAuthStateChanged(auth, (userAuth) => {
      setCurrentUser(userAuth as User);
      setAuthLoading(false);
    });

    return () => {
      clearTimeout(splashTimer);
      unsubscribe();
    };
  }, []);

  const getSystemInstruction = (model: ModelType) => {
    return model === ModelType.B2_CODING ? SYSTEM_INSTRUCTION_B2_BN : SYSTEM_INSTRUCTION_B1_BN;
  };

  const createNewChatSessionObject = useCallback((model: ModelType, id?: string, messages?: ChatMessage[], title?: string): ChatSession => {
    const newChatId = id || Date.now().toString();
    const systemInstruction = getSystemInstruction(model);
    const initialMessages = messages || [{
      id: Date.now().toString() + '_ai_welcome',
      text: INITIAL_WELCOME_MESSAGE_BN,
      sender: Sender.AI,
      timestamp: new Date(),
      modelUsed: model,
    }];

    return {
      id: newChatId,
      title: title || DEFAULT_CHAT_TITLE_BN,
      messages: initialMessages,
      model: model,
      timestamp: new Date(),
      systemInstruction: systemInstruction,
    };
  }, []);

  const initializeChatLogic = useCallback(async (sessionIdToLoad?: string, modelToUse?: ModelType) => {
    if (!apiKey) {
      setGlobalError(ERROR_API_KEY_MISSING_BN);
      setIsChatInitializing(false);
      // Create a dummy session to allow UI interaction even if API key is missing
      const newSession = createNewChatSessionObject(modelToUse || DEFAULT_MODEL_TYPE);
      setChatSessions({ [newSession.id]: newSession });
      setActiveChatId(newSession.id);
      return;
    }

    setIsChatInitializing(true);
    setGlobalError(null);

    try {
      const storedHistory = localStorage.getItem(CHAT_HISTORY_KEY);
      const storedActiveChatId = sessionIdToLoad || localStorage.getItem(ACTIVE_CHAT_ID_KEY);
      let loadedSessions: Record<string, ChatSession> = {};
      let newActiveChatId = storedActiveChatId;

      if (storedHistory) {
        loadedSessions = JSON.parse(storedHistory);
        Object.values(loadedSessions).forEach(session => {
          session.timestamp = new Date(session.timestamp); // Ensure dates are Date objects
          session.messages.forEach(msg => msg.timestamp = new Date(msg.timestamp));
          if (!session.title) session.title = session.messages.find(m => m.sender === Sender.User)?.text.substring(0,30) || DEFAULT_CHAT_TITLE_BN;
        });
      }
      
      let activeSessionToInit: ChatSession | undefined = newActiveChatId ? loadedSessions[newActiveChatId] : undefined;

      if (!activeSessionToInit) {
        if (Object.keys(loadedSessions).length > 0 && !sessionIdToLoad) { // if not forcing a new session
             newActiveChatId = Object.values(loadedSessions).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0].id;
             activeSessionToInit = loadedSessions[newActiveChatId!];
        } else {
            const newSession = createNewChatSessionObject(modelToUse || DEFAULT_MODEL_TYPE);
            loadedSessions[newSession.id] = newSession;
            newActiveChatId = newSession.id;
            activeSessionToInit = newSession;
        }
      }
      
      setChatSessions(loadedSessions);
      setActiveChatId(newActiveChatId);

      if (activeSessionToInit) {
        const ai = new GoogleGenAI({ apiKey });
        const chat = ai.chats.create({
          model: GEMINI_TEXT_MODEL_FLASH, // Use the appropriate text model
          config: { systemInstruction: activeSessionToInit.systemInstruction },
          history: activeSessionToInit.messages
            .filter(m => m.text && m.sender !== Sender.AI || (m.sender === Sender.AI && !m.id.includes('_ai_welcome') && m.text)) // filter out welcome, keep actual AI responses
            .map(m => ({
                role: m.sender === Sender.User ? "user" : "model",
                parts: [{ text: m.text }] // Ensure text is not undefined
            })),
        });
        chatSessionRef.current = chat;
      } else {
         throw new Error("Could not determine active session to initialize.");
      }

    } catch (e) {
      console.error("Failed to initialize/load chat:", e);
      setGlobalError(ERROR_INIT_FAILED_BN);
      // Fallback: create a brand new session if everything else fails
      const newSession = createNewChatSessionObject(modelToUse || DEFAULT_MODEL_TYPE);
      setChatSessions({ [newSession.id]: newSession });
      setActiveChatId(newSession.id);
      // Attempt to re-initialize Gemini for this new session
      if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            chatSessionRef.current = ai.chats.create({
                model: GEMINI_TEXT_MODEL_FLASH,
                config: { systemInstruction: newSession.systemInstruction },
            });
        } catch (initError) {
            console.error("Failed to initialize Gemini for fallback session:", initError);
            // Non-fatal, UI can still show messages, but API calls will fail
        }
      }
    } finally {
      setIsChatInitializing(false);
    }
  }, [apiKey, createNewChatSessionObject]);

  useEffect(() => {
    if (!authLoading) { // Initialize chat only after auth state is resolved
        initializeChatLogic();
    }
  }, [authLoading, initializeChatLogic]); // Add initializeChatLogic to dependency array

  useEffect(() => {
    if (activeChatId && Object.keys(chatSessions).length > 0 && !isChatInitializing) {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatSessions));
        localStorage.setItem(ACTIVE_CHAT_ID_KEY, activeChatId);
    }
  }, [chatSessions, activeChatId, isChatInitializing]);


  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setIsSidebarOpen(false); // Close sidebar on successful login
    } catch (error) {
      console.error("Error during Google sign-in:", error);
      setGlobalError("গুগল সাইন-ইন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।");
    }
  };

  const handleLogout = async () => {
    try {
      await firebaseSignOut(auth);
      // Optionally, clear chat history or reset state on logout
      // initializeChatLogic(); // Re-initialize with default session
      setIsSidebarOpen(false); // Close sidebar
    } catch (error) {
      console.error("Error during sign-out:", error);
      setGlobalError("সাইন-আউট ব্যর্থ হয়েছে।");
    }
  };

  const startNewChat = async (model: ModelType) => {
    const newSession = createNewChatSessionObject(model);
    setChatSessions(prev => ({ ...prev, [newSession.id]: newSession }));
    setActiveChatId(newSession.id);
    
    if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const geminiChat = ai.chats.create({
                model: GEMINI_TEXT_MODEL_FLASH,
                config: { systemInstruction: newSession.systemInstruction },
            });
            chatSessionRef.current = geminiChat;
            setGlobalError(null);
        } catch (e) {
            console.error("Failed to initialize new Gemini chat session:", e);
            setGlobalError(ERROR_INIT_FAILED_BN);
        }
    } else {
        setGlobalError(ERROR_API_KEY_MISSING_BN);
    }
    setIsSidebarOpen(false); // Close sidebar after starting new chat
  };

  const selectChatSession = (sessionId: string) => {
    if (sessionId === activeChatId) {
      setIsSidebarOpen(false); // Close sidebar if same chat selected
      return;
    }
    const selectedSession = chatSessions[sessionId];
    if (selectedSession) {
      setActiveChatId(sessionId);
      if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const geminiChat = ai.chats.create({
              model: GEMINI_TEXT_MODEL_FLASH,
              config: { systemInstruction: selectedSession.systemInstruction },
              history: selectedSession.messages
                .filter(m => m.text && m.sender !== Sender.AI || (m.sender === Sender.AI && !m.id.includes('_ai_welcome') && m.text))
                .map(m => ({
                    role: m.sender === Sender.User ? "user" : "model",
                    parts: [{ text: m.text }]
                })),
            });
            chatSessionRef.current = geminiChat;
            setGlobalError(null);
        } catch (e) {
            console.error("Failed to reinitialize Gemini chat for selected session:", e);
            setGlobalError(ERROR_INIT_FAILED_BN);
        }
      } else {
        setGlobalError(ERROR_API_KEY_MISSING_BN);
      }
    }
    setIsSidebarOpen(false); // Close sidebar after selecting chat
  };
  
  const handleModelChangeOnSidebar = (newModel: ModelType) => {
    if (activeChatId && chatSessions[activeChatId]?.model !== newModel) {
        // Option 1: Start a new chat with the new model
        startNewChat(newModel);
        // Option 2: Update current chat model (more complex, might need to clear history or re-init Gemini)
        // For simplicity, starting a new chat is often preferred when model changes fundamentally.
    }
  };

  const updateChatSessions = (updater: (prevSessions: Record<string, ChatSession>) => Record<string, ChatSession>) => {
    setChatSessions(updater);
  };
  
  if (showSplash) {
    return null; // Splash screen is handled by static HTML + CSS initially
  }

  return (
    <div className="flex h-screen antialiased bg-[var(--dark-bg)]">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentUser={currentUser}
        authLoading={authLoading}
        onLogin={handleLogin}
        onLogout={handleLogout}
        chatSessions={chatSessions}
        activeChatId={activeChatId}
        onSelectChat={selectChatSession}
        onNewChat={startNewChat}
        currentModel={activeChatId ? chatSessions[activeChatId]?.model || DEFAULT_MODEL_TYPE : DEFAULT_MODEL_TYPE}
        onModelChange={handleModelChangeOnSidebar}
        isChatInitializing={isChatInitializing}
      />
      
      <div className="flex flex-col flex-grow h-screen overflow-hidden">
        <header className="bg-[var(--dark-surface)] shadow-md p-3 sm:p-4">
          <div className="container mx-auto flex items-center justify-between max-w-7xl px-2 sm:px-4">
            <div className="flex items-center">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 mr-2 text-[var(--text-on-dark)] hover:bg-[var(--dark-element)] rounded-md focus:outline-none"
                aria-label="Open menu"
              >
                <MenuIcon className="h-6 w-6" />
              </button>
              <img src={LOGO_URL} alt="বার্তা AI Logo" className="h-8 w-8 sm:h-10 sm:w-10 mr-2 sm:mr-3 rounded-full" />
              <h1 className="text-lg sm:text-xl font-bold text-white whitespace-nowrap">
                {HEADER_TITLE_BN}
              </h1>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-3">
              {authLoading ? (
                <div className="text-sm text-gray-400">{SPLASH_SCREEN_LOADING_BN}</div>
              ) : currentUser ? (
                <>
                  {currentUser.photoURL ? (
                     <img src={currentUser.photoURL} alt={PROFILE_BUTTON_LABEL_BN} className="h-8 w-8 rounded-full" />
                  ) : (
                    <UserIcon className="h-7 w-7 text-[var(--text-on-dark)]" />
                  )}
                  <span className="text-sm text-[var(--text-on-dark)] hidden md:inline">
                    {WELCOME_USER_BN(currentUser.displayName || PROFILE_BUTTON_LABEL_BN)}
                  </span>
                  {/* Logout button moved to sidebar, can add a small profile dropdown here if needed later */}
                </>
              ) : (
                <button
                  onClick={handleLogin}
                  className="bg-[var(--main-color)] text-[var(--text-on-main)] px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[var(--main-color-darker)] transition-colors"
                >
                  {LOGIN_WITH_GOOGLE_BN}
                </button>
              )}
            </div>
          </div>
        </header>
        
        {globalError && (
            <div className="p-3 text-center text-red-400 bg-red-900 bg-opacity-50 text-sm">
             {globalError}
            </div>
        )}

        <ChatInterface
          currentUser={currentUser}
          authLoading={authLoading}
          activeChatSession={activeChatId ? chatSessions[activeChatId] : null}
          chatSessionsUpdater={updateChatSessions} // Pass the updater function
          geminiChatSession={chatSessionRef} // Pass the ref
          isChatInitializing={isChatInitializing}
          onNewChatRequest={startNewChat} // For the "New Chat" button within ChatInterface
          apiKey={apiKey}
          onErrorStateChange={setGlobalError}
        />
        
        <footer className="bg-[var(--dark-surface)] p-2 sm:p-3 text-center text-xs text-gray-400">
          <p>Powered by Gemini &copy; {new Date().getFullYear()} {HEADER_TITLE_BN}.</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
