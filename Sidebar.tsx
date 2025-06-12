import React from 'react';
import { User, ChatSession, ModelType } from '../types';
import { 
  LOGO_URL, HEADER_TITLE_BN, LOGIN_WITH_GOOGLE_BN, LOGOUT_BN, 
  NEW_CHAT_BUTTON_TEXT_BN, SIDEBAR_CHAT_HISTORY_TITLE_BN, SIDEBAR_NO_HISTORY_BN,
  MODEL_SWITCH_LABEL_BN, MODEL_B1_LABEL_BN, MODEL_B2_LABEL_BN, DEFAULT_MODEL_TYPE,
  SIDEBAR_USER_PROFILE_BN, WELCOME_USER_BN, PROFILE_BUTTON_LABEL_BN
} from '../constants';
import UserIcon from './icons/UserIcon';
import NewChatIcon from './icons/NewChatIcon';
import CloseIcon from './icons/CloseIcon'; // Assuming you have a CloseIcon
import SpinnerIcon from './icons/SpinnerIcon';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  authLoading: boolean;
  onLogin: () => void;
  onLogout: () => void;
  chatSessions: Record<string, ChatSession>;
  activeChatId: string | null;
  onSelectChat: (sessionId: string) => void;
  onNewChat: (model: ModelType) => void;
  currentModel: ModelType;
  onModelChange: (model: ModelType) => void;
  isChatInitializing: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen, onClose, currentUser, authLoading, onLogin, onLogout,
  chatSessions, activeChatId, onSelectChat, onNewChat,
  currentModel, onModelChange, isChatInitializing
}) => {
  const sortedChatSessions = Object.values(chatSessions).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const handleNewChatClick = () => {
    onNewChat(currentModel); // Start new chat with the currently selected model in sidebar
    // onClose(); // Close sidebar handled in App.tsx after action
  };
  
  const handleModelSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onModelChange(event.target.value as ModelType);
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        ></div>
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 w-72 sm:w-80 h-full bg-[var(--dark-surface)] text-[var(--text-on-dark)] 
                   shadow-xl z-40 flex flex-col p-4 sidebar
                   ${isOpen ? 'sidebar-open' : 'sidebar-closed lg:sidebar-open'}
                   lg:translate-x-0 lg:static lg:shadow-none lg:border-r lg:border-[var(--dark-element)]`}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <img src={LOGO_URL} alt={`${HEADER_TITLE_BN} Logo`} className="h-10 w-10 mr-3 rounded-full" />
            <h2 className="text-xl font-semibold">{HEADER_TITLE_BN}</h2>
          </div>
          <button onClick={onClose} className="lg:hidden p-1 rounded-md hover:bg-[var(--dark-element)]" aria-label="Close menu">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        <button
          onClick={handleNewChatClick}
          disabled={authLoading || isChatInitializing}
          className="w-full flex items-center justify-center bg-[var(--main-color)] text-[var(--text-on-main)] px-4 py-2.5 mb-6 rounded-lg text-sm font-medium hover:bg-[var(--main-color-darker)] transition-colors disabled:opacity-60"
        >
          <NewChatIcon className="w-5 h-5 mr-2" />
          {NEW_CHAT_BUTTON_TEXT_BN}
        </button>

        {/* Model Selector */}
        <div className="mb-4">
            <label htmlFor="sidebar-model-select" className="block text-sm font-medium text-gray-300 mb-1">{MODEL_SWITCH_LABEL_BN}</label>
            <select
                id="sidebar-model-select"
                value={currentModel}
                onChange={handleModelSelection}
                disabled={authLoading || isChatInitializing}
                className="w-full bg-[var(--dark-element)] text-[var(--text-on-dark)] rounded-md p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--main-color)]"
            >
                <option value={ModelType.B1_REGULAR}>{MODEL_B1_LABEL_BN}</option>
                <option value={ModelType.B2_CODING}>{MODEL_B2_LABEL_BN}</option>
            </select>
        </div>
        
        <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wider">{SIDEBAR_CHAT_HISTORY_TITLE_BN}</h3>
        <div className="flex-grow overflow-y-auto mb-4 custom-scrollbar pr-1 -mr-1"> {/* pr for scrollbar space */}
          {isChatInitializing && sortedChatSessions.length === 0 && (
            <div className="text-center py-4 text-gray-400">
              <SpinnerIcon />
              <p className="mt-1 text-sm">ইতিহাস লোড হচ্ছে...</p>
            </div>
          )}
          {!isChatInitializing && sortedChatSessions.length === 0 && (
            <p className="text-gray-400 text-sm italic">{SIDEBAR_NO_HISTORY_BN}</p>
          )}
          {sortedChatSessions.map(session => (
            <button
              key={session.id}
              onClick={() => onSelectChat(session.id)}
              className={`w-full text-left px-3 py-2.5 mb-1.5 rounded-md text-sm truncate
                          transition-colors duration-150
                          ${activeChatId === session.id 
                            ? 'bg-[var(--main-color)] text-[var(--text-on-main)] font-medium' 
                            : 'hover:bg-[var(--dark-element)] text-gray-300 hover:text-white'}`}
              title={session.title}
            >
              {session.title || "Untitled Chat"}
            </button>
          ))}
        </div>

        {/* User Profile / Login Section */}
        <div className="mt-auto pt-4 border-t border-[var(--dark-element)]">
          {authLoading ? (
            <div className="flex items-center justify-center text-sm text-gray-400">
              <SpinnerIcon /> <span className="ml-2">লোড হচ্ছে...</span>
            </div>
          ) : currentUser ? (
            <div className="flex flex-col space-y-3">
              <div className="flex items-center">
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="User" className="w-9 h-9 rounded-full mr-3" />
                ) : (
                  <UserIcon className="w-9 h-9 text-gray-400 mr-3" />
                )}
                <div>
                  <p className="text-sm font-medium text-white truncate" title={currentUser.displayName || SIDEBAR_USER_PROFILE_BN}>
                    {currentUser.displayName || SIDEBAR_USER_PROFILE_BN}
                  </p>
                  <p className="text-xs text-gray-400 truncate" title={currentUser.email || ''}>
                    {currentUser.email}
                  </p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="w-full bg-[var(--dark-element)] text-gray-300 px-4 py-2 rounded-md text-sm font-medium hover:bg-opacity-75 transition-colors"
              >
                {LOGOUT_BN}
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="w-full bg-[var(--main-color)] text-[var(--text-on-main)] px-4 py-2.5 rounded-md text-sm font-medium hover:bg-[var(--main-color-darker)] transition-colors"
            >
              {LOGIN_WITH_GOOGLE_BN}
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
