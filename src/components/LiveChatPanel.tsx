import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pin, Send, Trash2, Users } from 'lucide-react';
import {
  formatClockDuration,
  getFallbackAnimalAvatar,
  partitionParticipants,
  QUICK_REACTIONS,
} from '../utils/streamUtils';
import type { ChatMessage, ParticipantRole, RoomParticipant } from '../utils/types';

interface LiveChatPanelProps {
  clipsPanel?: ReactNode;
  clipCount?: number;
  messages: ChatMessage[];
  pinnedMessage: ChatMessage | null;
  participants: RoomParticipant[];
  selfId: string | null;
  selfRole: ParticipantRole;
  connected: boolean;
  slowModeSec: number;
  chatError: string | null;
  onSendMessage: (text: string) => void;
  onReactMessage: (messageId: string, label: string) => void;
  onPinMessage: (messageId: string | null) => void;
  onDeleteMessage: (messageId: string) => void;
  onUpdateSlowMode: (sec: number) => void;
}

export function LiveChatPanel({
  clipsPanel,
  clipCount = 0,
  messages,
  pinnedMessage,
  participants,
  selfId,
  selfRole,
  connected,
  slowModeSec,
  chatError,
  onSendMessage,
  onReactMessage,
  onPinMessage,
  onDeleteMessage,
  onUpdateSlowMode,
}: LiveChatPanelProps) {
  const [panelView, setPanelView] = useState<'chat' | 'crew' | 'clips'>(clipsPanel ? 'clips' : 'chat');
  const [draft, setDraft] = useState('');
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const canModerate = selfRole !== 'viewer';

  const { broadcasters, viewers } = partitionParticipants(participants);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSendMessage(draft);
    setDraft('');
  };

  return (
    <aside
      aria-label="Stream chat and audience"
      className="w-full lg:w-[360px] h-[440px] lg:h-auto shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200/80 bg-white flex flex-col"
    >
      {/* Header Switcher */}
      <div className="px-4 py-3 border-b border-slate-200/80 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setPanelView('chat')}
            className={`px-2 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
              panelView === 'chat'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {clipsPanel ? 'Chat' : 'Stream Chat'}
          </button>
          {clipsPanel && <button type="button" onClick={() => setPanelView('clips')} aria-pressed={panelView === 'clips'} className={`px-2 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${panelView === 'clips' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}>My Clips ({clipCount})</button>}
          <button
            type="button"
            onClick={() => setPanelView('crew')}
            className={`px-2 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${
              panelView === 'crew'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Room ({participants.length})</span>
          </button>
        </div>

        <span className={`${clipsPanel ? 'sr-only' : ''} text-xs text-slate-400 tabular-nums whitespace-nowrap`}>
          {connected ? 'Connected' : 'Reconnecting'}
        </span>
      </div>

      {panelView === 'clips' && clipsPanel ? clipsPanel : panelView === 'chat' ? (
        <>
          {/* Pinned Announcement */}
          {pinnedMessage && (
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200/80 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500">
                  Pinned by {pinnedMessage.senderName}
                </p>
                <p className="text-xs text-slate-900 break-words mt-0.5">{pinnedMessage.text}</p>
              </div>
              {canModerate && (
                <button
                  type="button"
                  onClick={() => onPinMessage(null)}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 shrink-0"
                >
                  Unpin
                </button>
              )}
            </div>
          )}

          {/* Chat Feed */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
                <p className="text-sm font-medium text-slate-800">Stream chat is live</p>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                  Messages broadcast instantly to everyone on stage and watching in this room.
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const reactionEntries = Object.entries(msg.reactions || {}).filter(
                  ([, count]) => count > 0
                );
                return (
                  <div
                    key={msg.id}
                    className="group rounded-xl px-2.5 py-2 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-400 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`font-semibold truncate ${
                            msg.role === 'host'
                              ? 'text-rose-600'
                              : msg.role === 'cohost'
                                ? 'text-slate-900'
                                : 'text-slate-700'
                          }`}
                        >
                          {msg.senderName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize shrink-0">{msg.role}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums shrink-0">
                          {formatClockDuration(msg.streamTimeSec)}
                        </span>
                      </div>

                      <div className="opacity-70 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-1 transition-opacity">
                        <button
                          type="button"
                          onClick={() => onReactMessage(msg.id, 'W')}
                          aria-label={`React W to ${msg.senderName}`}
                          className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                        >
                          W
                        </button>
                        {canModerate && (
                          <>
                            <button
                              type="button"
                              onClick={() => onPinMessage(msg.id)}
                              aria-label={`Pin message from ${msg.senderName}`}
                              className="p-1 text-slate-400 hover:text-slate-900 rounded"
                            >
                              <Pin className="w-3 h-3" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteMessage(msg.id)}
                              aria-label={`Delete message from ${msg.senderName}`}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            >
                              <Trash2 className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-slate-800 break-words leading-snug">{msg.text}</p>

                    {reactionEntries.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500">
                        {reactionEntries.map(([label, count]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => onReactMessage(msg.id, label)}
                            className="hover:text-slate-950 transition-colors tabular-nums"
                          >
                            {label} {count}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={feedEndRef} />
          </div>

          {/* Chat Composer & Slow Mode Control */}
          <div className="p-3.5 border-t border-slate-200/80 space-y-2.5 bg-white">
            {chatError && (
              <p role="alert" className="text-xs text-rose-600">
                {chatError}
              </p>
            )}

            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <label htmlFor="live-chat-input" className="sr-only">
                Chat message
              </label>
              <input
                id="live-chat-input"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  slowModeSec > 0 && selfRole === 'viewer'
                    ? `Slow mode (${slowModeSec}s)...`
                    : 'Send a message...'
                }
                className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-950 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
              />
              <button
                type="submit"
                disabled={!draft.trim() || !connected}
                aria-label="Send chat message"
                className="p-2.5 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
              </button>
            </form>

            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                {QUICK_REACTIONS.slice(0, 4).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onSendMessage(r)}
                    className="px-2 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                  >
                    {r}
                  </button>
                ))}
              </div>

              {canModerate ? (
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span>Slow</span>
                  <select
                    aria-label="Chat slow mode"
                    value={slowModeSec}
                    onChange={(e) => onUpdateSlowMode(Number(e.target.value))}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-0.5 font-mono text-slate-800"
                  >
                    <option value={0}>Off</option>
                    <option value={5}>5s</option>
                    <option value={15}>15s</option>
                    <option value={30}>30s</option>
                  </select>
                </label>
              ) : (
                <span className="font-mono text-[11px] tabular-nums">
                  {slowModeSec > 0 ? `Slow ${slowModeSec}s` : 'Open chat'}
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div>
            <h2 className="text-xs font-semibold text-slate-500 mb-2">
              On Stage ({broadcasters.length})
            </h2>
            <div className="space-y-2">
              {broadcasters.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200/70"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={p.avatarUrl || getFallbackAnimalAvatar(p.id).url}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {p.name} {p.id === selfId ? '(You)' : ''}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {p.handle} · <span className="capitalize">{p.role}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                    {p.audioEnabled ? 'Mic On' : 'Muted'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {viewers.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 mb-2">
                Viewers ({viewers.length})
              </h2>
              <div className="space-y-1.5">
                {viewers.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-50/70 text-xs"
                  >
                    <span className="text-slate-800 truncate">
                      {v.name} {v.id === selfId ? '(You)' : ''}
                    </span>
                    <span className="text-slate-500 font-mono">{v.handle}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
