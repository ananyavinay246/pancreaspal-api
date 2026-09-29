import React, { useState } from 'react';
import { useChatStore } from '../context/chatStore';
import { patientService } from '../services/apiService';
import { MessageList } from '../components/MessageList';
import { ChatInput } from '../components/ChatInput';
import { Disclaimer } from '../components/Disclaimer';

function PancreasIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="13" y="3" width="6" height="26" rx="3" fill="#94a3b8" />
      <rect x="3" y="13" width="26" height="6" rx="3" fill="#94a3b8" />
    </svg>
  );
}

function getOrCreatePatientId() {
  const existing = localStorage.getItem('currentPatientId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem('currentPatientId', id);
  return id;
}

export function ChatPage() {
  const { currentMessages, addMessage, setLoading, isLoading } = useChatStore();
  const [patientId] = useState(getOrCreatePatientId);

  const handleSendMessage = async (message) => {
    addMessage({ role: 'user', content: message, timestamp: new Date().toISOString() });
    setLoading(true);
    try {
      const response = await patientService.query(patientId, message);
      addMessage({
        role: 'assistant',
        content: response.data.answer,
        sources: response.data.sources,
        timestamp: new Date().toISOString()
      });
    } catch {
      addMessage({
        role: 'assistant',
        content: 'Sorry, I could not get a response. Please try again.',
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const hasMessages = currentMessages.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {hasMessages ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="max-w-2xl mx-auto">
              <MessageList messages={currentMessages} isLoading={isLoading} />
            </div>
          </div>
          <div className="px-4 pb-6">
            <div className="max-w-2xl mx-auto flex flex-col items-center gap-2">
              <ChatInput
                onSendMessage={handleSendMessage}
                isLoading={isLoading}
                compact
              />
              <Disclaimer />
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-2xl flex flex-col items-center -mt-10">
            <div className="flex flex-col items-center mb-7">
              <PancreasIcon />
              <h1
                className="text-5xl text-gray-900 mt-4 mb-3 text-center tracking-tight"
                style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300, letterSpacing: '-0.5px' }}
              >
                I'm your Pancreas Pal!
              </h1>
              <p
                className="mt-5 text-sm text-slate-400 text-center tracking-widest uppercase"
                style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
              >
                Ask me anything
              </p>
            </div>

            <div className="w-full">
              <ChatInput
                onSendMessage={handleSendMessage}
                isLoading={isLoading}
              />
            </div>
            <div className="mt-3">
              <Disclaimer />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
