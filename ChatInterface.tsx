
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Chat, GenerateContentResponse, Part, TextPart, InlineDataPart } from '@google/genai'; // Ensure GenerateContentResponse is imported
import { ChatMessage, Sender, ModelType, ChatSession, User, UserImageGenerationData } from '../types';
import {
  firestore, doc, getDoc, setDoc, serverTimestamp, Timestamp
} from '../firebase';
import {
  INPUT_PLACEHOLDER_BN, SEND_BUTTON_ARIA_LABEL_BN,
  UPLOAD_IMAGE_BUTTON_ARIA_LABEL_BN, GENERATE_IMAGE_BUTTON_ARIA_LABEL_BN, NEW_CHAT_BUTTON_TEXT_BN,
  NEW_CHAT_BUTTON_ARIA_LABEL_BN, EMPTY_CHAT_MESSAGE_BN, LOGO_URL,
  ERROR_API_KEY_MISSING_BN, ERROR_SEND_FAILED_BN, ERROR_API_KEY_INVALID_BN, ERROR_NO_INPUT_BN,
  ERROR_SESSION_NOT_READY_BN, IMAGE_GENERATION_PROMPT_PLACEHOLDER_BN, IMAGE_GENERATION_IN_PROGRESS_BN,
  IMAGE_GENERATION_FAILED_BN, IMAGE_QUERY_PROMPT_DEFAULT_BN, IMAGE_UPLOAD_FAILED_BN,
  GEMINI_IMAGE_MODEL, HEADER_TITLE_BN, GENERATE_IMAGE_BUTTON_TEXT_BN, DAILY_IMAGE_GENERATION_LIMIT,
  IMAGE_LIMIT_REACHED_BN, IMAGE_GENERATION_LOGIN_REQUIRED_BN, USER_DATA_COLLECTION_BN, GENERAL_CHAT_TOGGLE_BN,
  DEFAULT_CHAT_TITLE_BN
} from '../constants';
import MessageBubble from './MessageBubble';
import SendIcon from './icons/SendIcon';
import SpinnerIcon from './icons/SpinnerIcon';
import ImageIcon from './icons/ImageIcon';
import SparklesIcon from './icons/SparklesIcon';
import NewChatIcon from './icons/NewChatIcon';
import { generateImageFromPromptService, fileToGenerativePart } from '../services/geminiService';

interface ChatInterfaceProps {
  currentUser: User;
  authLoading: boolean;
  activeChatSession: ChatSession | null;
  chatSessionsUpdater: (updater: (prevSessions: Record<string, ChatSession>) => Record<string, ChatSession>) => void;
  geminiChatSession: React.MutableRefObject<Chat | null>;
  isChatInitializing: boolean;
  onNewChatRequest: (model: ModelType) => void; // For the button in ChatInterface
  apiKey: string | undefined;
  onErrorStateChange: (error: string | null) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  currentUser, authLoading, activeChatSession, chatSessionsUpdater, geminiChatSession, 
  isChatInitializing, onNewChatRequest, apiKey, onErrorStateChange 
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isLoadingBotResponse, setIsLoadingBotResponse] = useState(false); // For AI text response
  
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [isGeneratingImageMode, setIsGeneratingImageMode] = useState(false);
  const [isProcessingImageGen, setIsProcessingImageGen] = useState(false);

  const [userImageGenData, setUserImageGenData] = useState<UserImageGenerationData | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const currentMessages = activeChatSession?.messages || [];
  const currentModel = activeChatSession?.model || ModelType.B1_REGULAR;

  useEffect(() => {
    if (currentUser) {
      const fetchData = async () => {
        const userDocRef = doc(firestore, USER_DATA_COLLECTION_BN, currentUser.uid);
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
          setUserImageGenData(docSnap.data() as UserImageGenerationData);
        } else {
          setUserImageGenData({ count: 0, lastGeneratedAt: Timestamp.fromDate(new Date(0)) });
        }
      };
      fetchData();
    } else {
      setUserImageGenData(null);
    }
  }, [currentUser]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [currentMessages]);

  // Clear input when active chat changes and it's not just an update to the same chat
  useEffect(() => {
    setInputValue('');
    setUploadedImageFile(null);
    setUploadedImagePreview(null);
    onErrorStateChange(null); // Clear local errors too
  }, [activeChatSession?.id, onErrorStateChange]);


  const updateCurrentSessionMessages = (newMessagesFn: (prevMessages: ChatMessage[]) => ChatMessage[], newTitle?: string) => {
    if (!activeChatSession) return;
    chatSessionsUpdater(prevSessions => {
      const currentSession = prevSessions[activeChatSession.id];
      if (!currentSession) return prevSessions; // Should not happen if activeChatSession is set
      
      const updatedMessages = newMessagesFn(currentSession.messages);
      let titleToSet = currentSession.title;
      if (newTitle) {
        titleToSet = newTitle;
      } else if (updatedMessages.length > 1 && currentSession.title === DEFAULT_CHAT_TITLE_BN) {
        // Auto-set title from first user message if it's still default
        const firstUserMessage = updatedMessages.find(m => m.sender === Sender.User && m.text);
        if (firstUserMessage) {
          titleToSet = firstUserMessage.text.substring(0, 35) + (firstUserMessage.text.length > 35 ? '...' : '');
        }
      }

      return {
        ...prevSessions,
        [activeChatSession.id]: {
          ...currentSession,
          messages: updatedMessages,
          title: titleToSet,
          timestamp: new Date(), // Update timestamp on new message
        }
      };
    });
  };
  
  const addMessageToCurrentChat = (message: ChatMessage, title?: string) => {
    updateCurrentSessionMessages(prev => [...prev, message], title);
  };

  const updateAIMessageStream = (aiMessageId: string, chunkText: string, isFinal: boolean = false) => {
     if (!activeChatSession) return;
     updateCurrentSessionMessages(prevMessages => {
        let messageExists = false;
        const updatedMessages = prevMessages.map(msg => {
            if (msg.id === aiMessageId) {
                messageExists = true;
                return { ...msg, text: msg.text + chunkText, ...(isFinal && { modelUsed: currentModel }) };
            }
            return msg;
        });
        if (!messageExists && chunkText) { // First chunk for a new AI message
            updatedMessages.push({
                id: aiMessageId, text: chunkText, sender: Sender.AI, timestamp: new Date(), modelUsed: currentModel
            });
        }
        return updatedMessages;
    });
  };

  const handleSendMessage = async () => {
    const textToSend = inputValue.trim();
    if ((!textToSend && !uploadedImageFile) || isLoadingBotResponse || isProcessingImageGen) return;
    if (!geminiChatSession.current) { onErrorStateChange(ERROR_SESSION_NOT_READY_BN); return; }
    if (!apiKey) { onErrorStateChange(ERROR_API_KEY_MISSING_BN); return; }

    setIsLoadingBotResponse(true);
    onErrorStateChange(null);

    const userMessageText = textToSend || (uploadedImageFile ? IMAGE_QUERY_PROMPT_DEFAULT_BN : "");
     if (!userMessageText) { onErrorStateChange(ERROR_NO_INPUT_BN); setIsLoadingBotResponse(false); return; }

    const userMessage: ChatMessage = {
      id: Date.now().toString() + '_user', text: userMessageText, sender: Sender.User, timestamp: new Date(),
      imageUrl: uploadedImagePreview || undefined, isImageQuery: !!uploadedImageFile,
    };
    
    let titleForSession : string | undefined = undefined;
    if (activeChatSession && activeChatSession.title === DEFAULT_CHAT_TITLE_BN) {
        titleForSession = userMessageText.substring(0, 35) + (userMessageText.length > 35 ? '...' : '');
    }
    addMessageToCurrentChat(userMessage, titleForSession);
    
    setInputValue('');
    const currentUploadedImageFile = uploadedImageFile; // Capture before clearing
    setUploadedImageFile(null);
    setUploadedImagePreview(null);

    const aiMessageId = Date.now().toString() + '_ai';
    // Add a placeholder for AI response immediately
    addMessageToCurrentChat({
      id: aiMessageId, text: "", sender: Sender.AI, timestamp: new Date(), modelUsed: currentModel 
    });

    try {
      let responseStream: AsyncIterable<GenerateContentResponse>; // Correct type for stream
      if (currentUploadedImageFile) {
        const imagePart = await fileToGenerativePart(currentUploadedImageFile, currentUploadedImageFile.type);
        const messageParts: (TextPart | InlineDataPart)[] = [{ text: userMessage.text }];
        messageParts.push(imagePart); // imagePart is already { inlineData: { ... } }
        responseStream = await geminiChatSession.current.sendMessageStream({ message: messageParts });
      } else {
        responseStream = await geminiChatSession.current.sendMessageStream({message:userMessage.text});
      }

      for await (const chunk of responseStream) {
        if (chunk.text) { updateAIMessageStream(aiMessageId, chunk.text); }
      }
      updateAIMessageStream(aiMessageId, "", true); // Final update to mark as complete
    } catch (e: any) {
      console.error("Error sending message to Gemini:", e);
      let errorText = ERROR_SEND_FAILED_BN;
      if (e.message && e.message.includes("API key not valid")) { errorText = ERROR_API_KEY_INVALID_BN; }
      
      updateCurrentSessionMessages(prev => prev.map(msg => msg.id === aiMessageId ? { ...msg, text: errorText, modelUsed: currentModel } : msg));
      onErrorStateChange(errorText);
    } finally {
      setIsLoadingBotResponse(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
          onErrorStateChange("ছবি ফাইলের আকার 4MB এর বেশি হতে পারবে না।");
          if(fileInputRef.current) fileInputRef.current.value = ""; return;
      }
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)) {
          onErrorStateChange("সমর্থিত ছবির ধরণ: JPEG, PNG, WEBP, HEIC, HEIF।");
          if(fileInputRef.current) fileInputRef.current.value = ""; return;
      }
      setUploadedImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setUploadedImagePreview(reader.result as string);
      reader.readAsDataURL(file);
      onErrorStateChange(null);
      if (!inputValue.trim()) setInputValue(IMAGE_QUERY_PROMPT_DEFAULT_BN); // Set default prompt if input is empty
      setIsGeneratingImageMode(false); // Switch to chat mode if uploading an image for query
    }
  };

  const handleGenerateImage = async () => {
    const prompt = inputValue.trim();
    if (!prompt || isLoadingBotResponse || isProcessingImageGen) return;
    if (!apiKey) { onErrorStateChange(ERROR_API_KEY_MISSING_BN); return; }
    if (!currentUser) { onErrorStateChange(IMAGE_GENERATION_LOGIN_REQUIRED_BN); return; }

    let currentCount = 0;
    if (userImageGenData) {
      const today = new Date();
      today.setHours(0,0,0,0); // Start of today
      if (userImageGenData.lastGeneratedAt && userImageGenData.lastGeneratedAt.toDate() >= today) {
        currentCount = userImageGenData.count;
      }
    }
    
    if (currentCount >= DAILY_IMAGE_GENERATION_LIMIT) {
      onErrorStateChange(IMAGE_LIMIT_REACHED_BN);
      return;
    }

    setIsProcessingImageGen(true);
    onErrorStateChange(null);
    const originalInputValue = inputValue; 
    setInputValue(''); 

    const userMessage: ChatMessage = {
      id: Date.now().toString() + '_user_img_prompt',
      text: `"${originalInputValue}" - এই বিবরণে একটি ছবি তৈরি করার অনুরোধ।`,
      sender: Sender.User,
      timestamp: new Date(),
    };
    addMessageToCurrentChat(userMessage);

    const aiMessageId = Date.now().toString() + '_ai_img_gen';
    addMessageToCurrentChat({
      id: aiMessageId, text: IMAGE_GENERATION_IN_PROGRESS_BN, sender: Sender.AI,
      timestamp: new Date(), modelUsed: currentModel,
    });

    try {
      const base64Image = await generateImageFromPromptService(prompt, apiKey);
      const aiGeneratedImageMessage: ChatMessage = {
        id: aiMessageId, text: `"${originalInputValue}" এর জন্য তৈরি করা ছবি:`, sender: Sender.AI,
        timestamp: new Date(), generatedImage: base64Image, modelUsed: currentModel,
      };
      updateCurrentSessionMessages(prev => prev.map(msg => msg.id === aiMessageId ? aiGeneratedImageMessage : msg));

      const userDocRef = doc(firestore, USER_DATA_COLLECTION_BN, currentUser.uid);
      const newCountToday = (userImageGenData && userImageGenData.lastGeneratedAt.toDate() >= new Date(new Date().setHours(0,0,0,0)) ? userImageGenData.count : 0) + 1;
      const newGenData: UserImageGenerationData = {
        count: newCountToday,
        lastGeneratedAt: serverTimestamp() as Timestamp 
      };
      await setDoc(userDocRef, newGenData, { merge: true });
      // To get the actual server timestamp back for local state if needed, you'd typically re-fetch or handle it carefully.
      // For simplicity here, we can update with a client-side timestamp for `lastGeneratedAt` or assume it's roughly correct.
      setUserImageGenData({count: newCountToday, lastGeneratedAt: Timestamp.now()}); 
      
    } catch (e: any) {
      console.error("Error generating image:", e);
      updateCurrentSessionMessages(prev => prev.map(msg => msg.id === aiMessageId ? { ...msg, text: IMAGE_GENERATION_FAILED_BN } : msg));
      onErrorStateChange(IMAGE_GENERATION_FAILED_BN);
    } finally {
      setIsProcessingImageGen(false);
    }
  };
  
  const isInputCompletelyDisabled = isLoadingBotResponse || isProcessingImageGen || !geminiChatSession.current || !apiKey || authLoading || isChatInitializing;

  return (
    <div className="flex-grow flex flex-col max-w-4xl w-full mx-auto bg-[var(--dark-bg)] overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-[var(--dark-element)] flex justify-end items-center">
        {/* "New Chat" button within ChatInterface, as requested "new chat on Right side" */}
        <button
          onClick={() => onNewChatRequest(currentModel)} 
          disabled={isInputCompletelyDisabled}
          className="flex items-center bg-[var(--main-color)] text-[var(--text-on-main)] px-3 py-2 rounded-lg hover:bg-[var(--main-color-darker)] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          aria-label={NEW_CHAT_BUTTON_ARIA_LABEL_BN}
        >
          <NewChatIcon className="w-4 h-4 mr-2" />
          {NEW_CHAT_BUTTON_TEXT_BN}
        </button>
      </div>

      <div
        ref={chatContainerRef}
        className="flex-grow p-4 sm:p-6 space-y-4 overflow-y-auto"
        aria-live="polite"
      >
        {isChatInitializing && (
             <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
                <SpinnerIcon /> <p className="mt-2 text-lg">চ্যাট সেশন শুরু হচ্ছে...</p>
             </div>
        )}
        {!isChatInitializing && currentMessages.length === 0 && !isLoadingBotResponse && !authLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
            <img src={LOGO_URL} alt={HEADER_TITLE_BN} className="w-24 h-24 mb-4 rounded-full opacity-70" />
            <p className="text-lg">{EMPTY_CHAT_MESSAGE_BN}</p>
          </div>
        )}
        {authLoading && !isChatInitializing && currentMessages.length === 0 && ( // Show only if chat isn't also initializing
            <div className="flex justify-center items-center h-full text-gray-400">
                <SpinnerIcon /> <span className="ml-2">ব্যবহারকারীর তথ্য লোড হচ্ছে...</span>
            </div>
        )}
        {currentMessages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {(isLoadingBotResponse && !currentMessages.find(m=>m.id.endsWith('_ai') && m.text === "")) && ( // Show thinking if AI placeholder is empty
             <div className="flex self-start items-center py-2">
                 <img src={LOGO_URL} alt="AI Avatar" className="w-6 h-6 rounded-full mr-2"/>
                <SpinnerIcon /> <span className="ml-2 text-sm text-gray-400">বার্তা এআই ভাবছে...</span>
            </div>
        )}
      </div>

      {/* Error display is now handled globally in App.tsx, but can keep local one if specific context is needed */}

      {uploadedImagePreview && (
        <div className="p-2 bg-[var(--dark-surface)] border-t border-[var(--dark-element)]">
          <div className="relative w-24 h-24 mx-auto group">
            <img src={uploadedImagePreview} alt="Uploaded preview" className="object-cover w-full h-full rounded-md" />
            <button 
              onClick={() => { setUploadedImageFile(null); setUploadedImagePreview(null); if(fileInputRef.current) fileInputRef.current.value = "";}}
              className="absolute top-0 right-0 p-1 text-white bg-red-600 rounded-full -mt-2 -mr-2 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
              aria-label="Remove image"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="bg-[var(--dark-surface)] p-3 sm:p-4 border-t border-[var(--dark-element)]">
        <div className="flex items-center space-x-2 sm:space-x-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png, image/jpeg, image/webp, image/heic, image/heif"
            onChange={handleImageUpload}
            className="hidden"
            id="imageUploadInput"
            disabled={isInputCompletelyDisabled || isGeneratingImageMode}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isInputCompletelyDisabled || isGeneratingImageMode}
            className="p-3 rounded-lg hover:bg-[var(--dark-element)] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-12 h-12 shrink-0"
            aria-label={UPLOAD_IMAGE_BUTTON_ARIA_LABEL_BN}
            title={UPLOAD_IMAGE_BUTTON_ARIA_LABEL_BN}
          >
            <ImageIcon className="w-5 h-5 text-[var(--text-on-dark)]" />
          </button>

          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && !isInputCompletelyDisabled && (isGeneratingImageMode ? handleGenerateImage() : handleSendMessage())}
            placeholder={isGeneratingImageMode ? IMAGE_GENERATION_PROMPT_PLACEHOLDER_BN : INPUT_PLACEHOLDER_BN}
            className="flex-grow bg-[var(--dark-element)] text-[var(--text-on-dark)] rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[var(--main-color)] placeholder-gray-400"
            disabled={isInputCompletelyDisabled}
            aria-label={isGeneratingImageMode ? IMAGE_GENERATION_PROMPT_PLACEHOLDER_BN : INPUT_PLACEHOLDER_BN}
          />
          
          {isGeneratingImageMode ? (
            <button
                onClick={handleGenerateImage}
                disabled={isInputCompletelyDisabled || !inputValue.trim() || isProcessingImageGen || !currentUser}
                className="bg-[var(--main-color)] text-[var(--text-on-main)] p-3 rounded-lg hover:bg-[var(--main-color-darker)] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-12 h-12 shrink-0"
                aria-label={GENERATE_IMAGE_BUTTON_ARIA_LABEL_BN}
                title={GENERATE_IMAGE_BUTTON_ARIA_LABEL_BN}
            >
                {isProcessingImageGen ? <SpinnerIcon /> : <SparklesIcon className="w-5 h-5"/>}
            </button>
          ) : (
            <button
                onClick={handleSendMessage}
                disabled={isInputCompletelyDisabled || (!inputValue.trim() && !uploadedImageFile)}
                className="bg-[var(--main-color)] text-[var(--text-on-main)] p-3 rounded-lg hover:bg-[var(--main-color-darker)] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-12 h-12 shrink-0"
                aria-label={SEND_BUTTON_ARIA_LABEL_BN}
                title={SEND_BUTTON_ARIA_LABEL_BN}
            >
                {isLoadingBotResponse ? <SpinnerIcon /> : <SendIcon />}
            </button>
          )}
        </div>
        <div className="mt-3 flex justify-center sm:justify-end">
            <button
                onClick={() => {
                  setIsGeneratingImageMode(!isGeneratingImageMode);
                  if (!isGeneratingImageMode && uploadedImageFile) { // If switching to image gen mode with an image uploaded for query
                    setUploadedImageFile(null); // Clear uploaded image as it's not for generation prompt
                    setUploadedImagePreview(null);
                    if(fileInputRef.current) fileInputRef.current.value = "";
                  }
                }}
                disabled={isLoadingBotResponse || isProcessingImageGen} 
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${isGeneratingImageMode ? 'bg-[var(--main-color)] text-[var(--text-on-main)]' : 'bg-[var(--dark-element)] text-[var(--text-on-dark)] hover:bg-opacity-70'}`}
            >
                {isGeneratingImageMode ? GENERAL_CHAT_TOGGLE_BN : GENERATE_IMAGE_BUTTON_TEXT_BN}
            </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
