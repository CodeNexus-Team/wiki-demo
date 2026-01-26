import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatMessage, WikiBlock } from '../types';

interface UseChatHistoryOptions {
  initialHistory?: ChatMessage[];
  onHistoryChange?: (history: ChatMessage[]) => void;
}

interface UseChatHistoryReturn {
  chatHistory: ChatMessage[];
  isChatExpanded: boolean;
  chatScrollRef: React.RefObject<HTMLDivElement>;

  addUserMessage: (content: string, references?: WikiBlock[]) => string;
  addAssistantMessage: (initialSteps?: string[]) => string;
  updateAssistantMessage: (id: string, updates: Partial<ChatMessage>) => void;
  updateAssistantProgress: (id: string, step: string) => void;
  finalizeAssistantMessage: (id: string, content: string) => void;
  addSimpleMessage: (role: 'user' | 'assistant', content: string) => void;

  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsChatExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  clearHistory: () => void;
}

export function useChatHistory(options: UseChatHistoryOptions = {}): UseChatHistoryReturn {
  const { initialHistory = [], onHistoryChange } = options;

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(initialHistory);
  const [isChatExpanded, setIsChatExpanded] = useState(true);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when chat history changes
  useEffect(() => {
    if (chatScrollRef.current && isChatExpanded) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, isChatExpanded, chatHistory[chatHistory.length - 1]?.steps?.length]);

  // Notify parent when history changes
  useEffect(() => {
    onHistoryChange?.(chatHistory);
  }, [chatHistory, onHistoryChange]);

  const addUserMessage = useCallback((content: string, references?: WikiBlock[]): string => {
    const msgId = Date.now().toString();
    const userMsg: ChatMessage = {
      id: msgId,
      role: 'user',
      content,
      timestamp: Date.now(),
      references: references && references.length > 0 ? references : undefined,
    };
    setChatHistory(prev => [...prev, userMsg]);
    return msgId;
  }, []);

  const addAssistantMessage = useCallback((initialSteps: string[] = ['Initializing...']): string => {
    const msgId = (Date.now() + 1).toString();
    setChatHistory(prev => [...prev, {
      id: msgId,
      role: 'assistant',
      content: '',
      steps: initialSteps,
      timestamp: Date.now()
    }]);
    return msgId;
  }, []);

  const updateAssistantMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setChatHistory(prev => prev.map(msg =>
      msg.id === id ? { ...msg, ...updates } : msg
    ));
  }, []);

  const updateAssistantProgress = useCallback((id: string, step: string) => {
    setChatHistory(prev => prev.map(msg =>
      msg.id === id
        ? { ...msg, steps: [...(msg.steps || []), step] }
        : msg
    ));
  }, []);

  const finalizeAssistantMessage = useCallback((id: string, content: string) => {
    setChatHistory(prev => prev.map(msg =>
      msg.id === id
        ? { ...msg, content, steps: [...(msg.steps || []), 'Done'] }
        : msg
    ));
  }, []);

  const addSimpleMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    setChatHistory(prev => [...prev, {
      id: Date.now().toString(),
      role,
      content,
      timestamp: Date.now()
    }]);
  }, []);

  const clearHistory = useCallback(() => {
    setChatHistory([]);
  }, []);

  return {
    chatHistory,
    isChatExpanded,
    chatScrollRef,
    addUserMessage,
    addAssistantMessage,
    updateAssistantMessage,
    updateAssistantProgress,
    finalizeAssistantMessage,
    addSimpleMessage,
    setChatHistory,
    setIsChatExpanded,
    clearHistory,
  };
}
