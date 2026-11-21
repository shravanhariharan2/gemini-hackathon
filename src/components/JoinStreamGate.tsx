import { useEffect, useRef, useState } from 'react';
import { AppHeader } from './AppHeader';
import {
  ArrowRight,
  Clock,
  Eye,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  type AnimalAvatarOption,
  formatClockDuration,
  getFallbackAnimalAvatar,
  sanitizeRoomSlug,
  STREAM_CATEGORIES,
  validateDisplayName,
} from '../utils/streamUtils';
import {
  filterAndSortDirectoryRooms,
  formatRelativeTime,
  generateFriendlyRoomSlug,
} from '../utils/roomLifecycle';
import type {
  ParticipantRole,
  RecentRoomEntry,
  RoomSummary,
  StreamCategory,
} from '../utils/types';

interface JoinStreamGateProps {
  onOpenMyClips: () => void;
  clipCount: number;
  initialRoomId: string;
  initialRole: ParticipantRole;
  avatar: AnimalAvatarOption;
  directoryRooms: RoomSummary[];
  recentRooms: RecentRoomEntry[];
  onShuffleAvatar: () => void;
  onRefreshDirectory: () => void;
  onRemoveRecentRoom: (roomId: string) => void;
  onClearRecentRooms: () => void;
  onJoin: (params: {
    name: string;
    roomId: string;
    role: ParticipantRole;
    avatarUrl: string;
    title?: string;
    category?: StreamCategory;
  }) => void;
}

export function JoinStreamGate({
  onOpenMyClips,
  clipCount,
  initialRoomId,
  initialRole,
  avatar,
  directoryRooms,
  recentRooms,
  onShuffleAvatar,
  onRefreshDirectory,
  onRemoveRecentRoom,
  onClearRecentRooms,
  onJoin,
}: JoinStreamGateProps) {
  const hasInviteParam = useRef(
    typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('room'))
  );
  const [nameInput, setNameInput] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [roomInput, setRoomInput] = useState(initialRoomId);
  const [hasUserEditedRoom, setHasUserEditedRoom] = useState(false);
  const [roleInput, setRoleInput] = useState<ParticipantRole>(
    initialRole === 'viewer' ? 'viewer' : 'host'
  );
  const [createTitle, setCreateTitle] = useState('');
  const [createCategory, setCreateCategory] = useState<StreamCategory>('Just Chatting');
  const [createSlug, setCreateSlug] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<StreamCategory | 'All'>('All');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleRooms = filterAndSortDirectoryRooms(directoryRooms, searchQuery, selectedCategory);
  const sortedAllRooms = filterAndSortDirectoryRooms(directoryRooms);
  const activeById = new Map(directoryRooms.map((r) => [r.roomId, r]));
  const liveChannelCount = directoryRooms.filter((r) => r.isLive).length;
  const totalOnlineCount = directoryRooms.reduce(
    (sum, r) => sum + r.broadcasterCount + r.viewerCount,
    0
  );

  // If the user landed on the Lobby without an explicit ?room= invite link and hasn't typed a custom room code,
  // auto-target the top active stream so clicking "Join Stream" immediately joins the live room instead of an empty default.
  useEffect(() => {
    if (hasInviteParam.current || hasUserEditedRoom) return;
    if (sortedAllRooms.length > 0 && !activeById.has(sanitizeRoomSlug(roomInput))) {
      setRoomInput(sortedAllRooms[0].roomId);
    }
  }, [sortedAllRooms, hasUserEditedRoom, roomInput, activeById]);

  const normalizedRoomTarget = sanitizeRoomSlug(roomInput);
  const matchedTargetRoom = activeById.get(normalizedRoomTarget);

  const attemptDirectJoin = (targetRoomId: string, targetRole: ParticipantRole, label?: string) => {
    const check = validateDisplayName(nameInput);
    if (!check.ok) {
      setMode('join');
      setRoomInput(targetRoomId);
      setHasUserEditedRoom(true);
      setRoleInput(targetRole);
      setErrorMessage(
        label
          ? `Enter your display name to join "${label}".`
          : check.reason
      );
      nameInputRef.current?.focus();
      return;
    }
    setErrorMessage(null);
    onJoin({
      name: check.name,
      roomId: sanitizeRoomSlug(targetRoomId),
      role: targetRole,
      avatarUrl: avatar.url,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateDisplayName(nameInput);
    if (!check.ok) {
      setErrorMessage(check.reason);
      nameInputRef.current?.focus();
      return;
    }
    setErrorMessage(null);

    if (mode === 'create') {
      const cleanTitle = createTitle.trim().slice(0, 80) || `${check.name}'s Stream`;
      const slug = createSlug.trim()
        ? sanitizeRoomSlug(createSlug)
        : generateFriendlyRoomSlug(cleanTitle);
      onJoin({
        name: check.name,
        roomId: slug,
        role: 'host',
        avatarUrl: avatar.url,
        title: cleanTitle,
        category: createCategory,
      });
      return;
    }

    onJoin({
      name: check.name,
      roomId: sanitizeRoomSlug(roomInput),
      role: roleInput,
      avatarUrl: avatar.url,
    });
  };

  return (
    <div className="min-h-screen bg-[#FAFAFB] text-slate-950 flex flex-col">
      <AppHeader current="/">
        <button type="button" onClick={onOpenMyClips} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium">My Clips ({clipCount})</button>
        <div className="flex items-center gap-4 text-xs text-slate-500 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                liveChannelCount > 0 ? 'bg-rose-600 animate-pulse' : 'bg-slate-300'
              }`}
              aria-hidden="true"
            />
            <span className="font-medium text-slate-800">
              {liveChannelCount > 0
                ? `${liveChannelCount} live ${liveChannelCount === 1 ? 'channel' : 'channels'}`
                : 'No live channels'}
            </span>
          </span>
          {totalOnlineCount > 0 && (
            <span className="hidden sm:inline text-slate-400">
              · {totalOnlineCount} online
            </span>
          )}
          <button
            type="button"
            onClick={onRefreshDirectory}
            aria-label="Refresh available rooms"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </AppHeader>

      {/* Main Two-Column Lobby */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 md:gap-8 items-start">
        {/* Left Column: Available Live Channels & Room History */}
        <section aria-label="Browse live channels and room history" className="space-y-8 min-w-0">
          {/* Available Rooms Header + Search + Categories */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="font-display text-xl md:text-2xl font-bold tracking-tight text-slate-950">
                  Available Rooms
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live streams and open stages. Empty rooms clean up automatically after 2 minutes.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <label htmlFor="lobby-room-search" className="sr-only">
                  Search available rooms
                </label>
                <input
                  id="lobby-room-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search rooms or hosts..."
                  className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-950 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 transition-colors"
                />
              </div>
            </div>

            {/* Category Filter Bar */}
            <div
              role="group"
              aria-label="Filter rooms by category"
              className="flex items-center gap-1.5 overflow-x-auto pb-1"
            >
              {(['All', ...STREAM_CATEGORIES] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  aria-pressed={selectedCategory === cat}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap transition-colors ${
                    selectedCategory === cat
                      ? 'bg-slate-950 text-white border-slate-950'
                      : 'bg-white text-slate-600 border-slate-200 hover:text-slate-950 hover:border-slate-300'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Twitch-style Channel Cards */}
            {visibleRooms.length === 0 ? (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-8 md:p-10 text-center space-y-2">
                <div className="w-10 h-10 mx-auto rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                  <Radio className="w-5 h-5" aria-hidden="true" />
                </div>
                <p className="font-display text-base font-semibold text-slate-900">
                  {directoryRooms.length === 0
                    ? 'No channels are active right now'
                    : 'No rooms match your filter'}
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  {directoryRooms.length === 0
                    ? 'Start a new stream room on the right, or enter a friend’s room code to hop onto their stage.'
                    : 'Try clearing your search or switching back to All categories.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="available-rooms-grid">
                {visibleRooms.map((room) => {
                  const elapsedSec =
                    room.isLive && room.streamStartedAt
                      ? Math.max(0, Math.floor((nowMs - room.streamStartedAt) / 1000))
                      : 0;
                  const hostAvatar =
                    room.hostAvatarUrl || getFallbackAnimalAvatar(room.roomId).url;

                  return (
                    <article
                      key={room.roomId}
                      data-testid={`channel-card-${room.roomId}`}
                      className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs hover:border-slate-300 transition-colors flex flex-col"
                    >
                      {/* 16:9 Channel Preview Header */}
                      <div className="relative aspect-video bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center border-b border-slate-100">
                        <img
                          src={hostAvatar}
                          alt={`${room.hostName} avatar`}
                          className="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-sm"
                        />

                        {/* Live / Backstage status */}
                        <div className="absolute top-3 left-3">
                          {room.isLive ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-mono font-semibold tabular-nums shadow-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                              LIVE · {formatClockDuration(elapsedSec)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/80 text-white text-[11px] font-mono font-medium">
                              BACKSTAGE
                            </span>
                          )}
                        </div>

                        {/* Stage + Viewer counts */}
                        <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-slate-950/75 backdrop-blur-sm text-white text-[11px] font-mono tabular-nums inline-flex items-center gap-1.5">
                          <Users className="w-3 h-3" aria-hidden="true" />
                          <span>
                            {room.broadcasterCount} stage · {room.viewerCount} watching
                          </span>
                        </div>
                      </div>

                      {/* Channel Metadata + Direct Actions */}
                      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="font-display text-sm font-semibold text-slate-950 truncate">
                            {room.title}
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {room.hostName} · {room.category}
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
                            /{room.roomId}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => attemptDirectJoin(room.roomId, 'viewer', room.title)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-900 rounded-xl transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Watch</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => attemptDirectJoin(room.roomId, 'cohost', room.title)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors"
                          >
                            <Video className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Join Stage</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Room History */}
          {recentRooms.length > 0 && (
            <div className="space-y-3" data-testid="recent-rooms-section">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Recent Room History
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClearRecentRooms}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-rose-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  <span>Clear history</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200/90 rounded-2xl divide-y divide-slate-100 overflow-hidden shadow-xs">
                {recentRooms.map((item) => {
                  const liveInfo = activeById.get(item.roomId);
                  return (
                    <div
                      key={item.roomId}
                      className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {liveInfo?.title || item.title}
                          </span>
                          {liveInfo?.isLive ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-rose-600 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                              LIVE
                            </span>
                          ) : liveInfo ? (
                            <span className="text-[11px] font-mono text-emerald-700 shrink-0">
                              Active ({liveInfo.broadcasterCount + liveInfo.viewerCount})
                            </span>
                          ) : (
                            <span className="text-[11px] font-mono text-slate-400 shrink-0">
                              Offline
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          <span className="font-mono text-slate-600">/{item.roomId}</span> ·{' '}
                          {liveInfo?.category || item.category} · Last joined as{' '}
                          <span className="capitalize">{item.lastRole}</span> ·{' '}
                          {formatRelativeTime(item.lastVisitedAt, nowMs)}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            attemptDirectJoin(
                              item.roomId,
                              item.lastRole === 'viewer' ? 'viewer' : 'cohost',
                              liveInfo?.title || item.title
                            )
                          }
                          className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-950 text-slate-900 hover:text-white rounded-lg transition-colors"
                        >
                          Rejoin
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveRecentRoom(item.roomId)}
                          aria-label={`Remove ${item.title} from history`}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Sticky Join / Create Studio Card */}
        <aside
          aria-label="Join or create a stream room"
          className="bg-white border border-slate-200/90 rounded-2xl shadow-xs p-5 sm:p-6 space-y-5 lg:sticky lg:top-6"
        >
          {/* Animal Avatar Preview */}
          <div className="flex items-center gap-3.5 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
            <img
              src={avatar.url}
              alt={`${avatar.label} profile avatar`}
              className="w-14 h-14 rounded-full object-cover ring-2 ring-white shadow-xs shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-900">Camera-Off Avatar</p>
              <p className="text-xs text-slate-500 truncate">{avatar.label}</p>
            </div>
            <button
              type="button"
              onClick={onShuffleAvatar}
              aria-label="Shuffle animal avatar"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors shrink-0"
            >
              <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Shuffle</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Required Display Name */}
            <div>
              <label
                htmlFor="join-display-name"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Display Name
              </label>
              <input
                ref={nameInputRef}
                id="join-display-name"
                type="text"
                autoFocus
                required
                maxLength={32}
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="Enter your name"
                aria-invalid={Boolean(errorMessage)}
                aria-describedby={errorMessage ? 'join-name-error' : undefined}
                className={`w-full bg-slate-50 border rounded-xl px-3.5 py-2.5 text-sm text-slate-950 placeholder:text-slate-400 focus:bg-white focus:outline-none transition-colors ${
                  errorMessage
                    ? 'border-rose-400 focus:border-rose-600'
                    : 'border-slate-200 focus:border-slate-900'
                }`}
              />
              {errorMessage && (
                <p
                  id="join-name-error"
                  role="alert"
                  className="mt-1.5 text-xs text-rose-600 font-medium"
                >
                  {errorMessage}
                </p>
              )}
            </div>

            {/* Join Room vs Create New Room Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setMode('join')}
                aria-pressed={mode === 'join'}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                  mode === 'join'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Join Room
              </button>
              <button
                type="button"
                onClick={() => setMode('create')}
                aria-pressed={mode === 'create'}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1 ${
                  mode === 'create'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Create Room</span>
              </button>
            </div>

            {mode === 'join' ? (
              <>
                <div>
                  <label
                    htmlFor="join-room-slug"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Room Code or Invite Link
                  </label>
                  <input
                    id="join-room-slug"
                    type="text"
                    maxLength={200}
                    value={roomInput}
                    onChange={(e) => {
                      setRoomInput(e.target.value);
                      setHasUserEditedRoom(true);
                    }}
                    placeholder="Room code or paste invite URL"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-950 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                  />
                  {matchedTargetRoom ? (
                    <p className="mt-1.5 text-[11px] text-slate-600 flex items-center gap-1.5 truncate">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          matchedTargetRoom.isLive ? 'bg-rose-600' : 'bg-emerald-600'
                        }`}
                      />
                      <span className="truncate">
                        {matchedTargetRoom.isLive ? 'Live' : 'Active'}:{' '}
                        <span className="font-medium text-slate-900">{matchedTargetRoom.title}</span>{' '}
                        ({matchedTargetRoom.hostName})
                      </span>
                    </p>
                  ) : hasInviteParam.current ? (
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Invited to room <span className="font-mono text-slate-700">/{normalizedRoomTarget}</span>
                    </p>
                  ) : null}
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-semibold text-slate-700">Join As</legend>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setRoleInput('host')}
                      aria-pressed={roleInput !== 'viewer'}
                      className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
                        roleInput !== 'viewer'
                          ? 'bg-slate-950 text-white border-slate-950'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>On Stage</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleInput('viewer')}
                      aria-pressed={roleInput === 'viewer'}
                      className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
                        roleInput === 'viewer'
                          ? 'bg-slate-950 text-white border-slate-950'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Viewer</span>
                    </button>
                  </div>
                </fieldset>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                >
                  <span>Join Stream</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="create-room-title"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Stream Title
                  </label>
                  <input
                    id="create-room-title"
                    type="text"
                    maxLength={80}
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="e.g. Late Night Build Session"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-950 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-room-category"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Category
                  </label>
                  <select
                    id="create-room-category"
                    value={createCategory}
                    onChange={(e) => setCreateCategory(e.target.value as StreamCategory)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                  >
                    {STREAM_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="create-room-slug"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Custom Room Code <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="create-room-slug"
                    type="text"
                    maxLength={48}
                    value={createSlug}
                    onChange={(e) => setCreateSlug(e.target.value)}
                    placeholder={
                      createTitle.trim()
                        ? sanitizeRoomSlug(createTitle)
                        : 'auto-generated'
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-950 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Start Studio Room</span>
                </button>
              </>
            )}
          </form>
        </aside>
      </main>
    </div>
  );
}
