import { useEffect, useState } from 'react';
import {
  Mic,
  MicOff,
  MonitorUp,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Scissors,
  SlidersHorizontal,
  Video,
  VideoOff,
  VolumeX,
  X,
} from 'lucide-react';
import {
  formatClockDuration,
  partitionParticipants,
  STREAM_CATEGORIES,
} from '../utils/streamUtils';
import type {
  ClipMarkerEvent,
  ParticipantRole,
  RecentRoomEntry,
  RoomParticipant,
  RoomSummary,
  StreamCategory,
} from '../utils/types';
import type { MediaDeviceOption, StudioProfile } from '../hooks/useStudioRoom';
import { CreatorProfileSection } from './CreatorProfileSection';
import { RoomSwitcherDrawer } from './RoomSwitcherDrawer';
import { ParticipantVideoTile } from './VideoTile';

interface LiveStageProps {
  roomId: string;
  roomTitle: string;
  roomCategory: StreamCategory;
  isLive: boolean;
  streamStartedAt: number | null;
  isAutoRecording: boolean;
  lastClipMarker: ClipMarkerEvent | null;
  streamEndedNotice: string | null;
  audioBlocked: boolean;
  audioUnlockSeq: number;
  mutedPeerIds: Record<string, boolean>;
  selfId: string | null;
  selfName: string;
  selfRole: ParticipantRole;
  participants: RoomParticipant[];
  directoryRooms: RoomSummary[];
  recentRooms: RecentRoomEntry[];
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  remoteRelayFrames: Record<string, string>;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  audioLevel: number;
  mediaNotice: string | null;
  audioDevices: MediaDeviceOption[];
  videoDevices: MediaDeviceOption[];
  selectedAudioId: string;
  selectedVideoId: string;
  showRoomSwitcher: boolean;
  theaterMode: boolean;
  onToggleTheaterMode: () => void;
  onCloseRoomSwitcher: () => void;
  onRefreshDirectory: () => void;
  onRemoveRecentRoom: (roomId: string) => void;
  onClearRecentRooms: () => void;
  onJoinRoom: (
    roomId: string,
    profile: StudioProfile,
    meta?: { title?: string; category?: StreamCategory }
  ) => void;
  onLeaveRoom: () => void;
  onDismissStreamEndedNotice: () => void;
  onUpdateRoomMeta: (meta: { title?: string; category?: StreamCategory }) => void;
  onSwitchInputDevice: (audioId: string, videoId: string) => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onTogglePeerMute: (peerId: string) => void;
  onUnlockAudio: () => void;
  onReportAudioBlocked: () => void;
  onTriggerClipMark: (source?: 'manual' | 'voice') => void;
}

export function LiveStage({
  roomId,
  roomTitle,
  roomCategory,
  isLive,
  streamStartedAt,
  isAutoRecording,
  lastClipMarker,
  streamEndedNotice,
  audioBlocked,
  audioUnlockSeq,
  mutedPeerIds,
  selfId,
  selfName,
  selfRole,
  participants,
  directoryRooms,
  recentRooms,
  localStream,
  remoteStreams,
  remoteRelayFrames,
  audioEnabled,
  videoEnabled,
  screenSharing,
  audioLevel,
  mediaNotice,
  audioDevices,
  videoDevices,
  selectedAudioId,
  selectedVideoId,
  showRoomSwitcher,
  theaterMode,
  onToggleTheaterMode,
  onCloseRoomSwitcher,
  onRefreshDirectory,
  onRemoveRecentRoom,
  onClearRecentRooms,
  onJoinRoom,
  onLeaveRoom,
  onDismissStreamEndedNotice,
  onUpdateRoomMeta,
  onSwitchInputDevice,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onTogglePeerMute,
  onUnlockAudio,
  onReportAudioBlocked,
  onTriggerClipMark,
}: LiveStageProps) {
  const [editingMeta, setEditingMeta] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [titleDraft, setTitleDraft] = useState(roomTitle);
  const [categoryDraft, setCategoryDraft] = useState<StreamCategory>(roomCategory);
  const [liveClockSec, setLiveClockSec] = useState(0);

  useEffect(() => {
    setTitleDraft(roomTitle);
    setCategoryDraft(roomCategory);
  }, [roomCategory, roomTitle]);

  useEffect(() => {
    if (!isLive || !streamStartedAt) {
      setLiveClockSec(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLiveClockSec(Math.max(0, Math.floor((Date.now() - streamStartedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(interval);
  }, [isLive, streamStartedAt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditingMeta(false);
        setShowDevices(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { broadcasters, viewers } = partitionParticipants(participants);
  const hostParticipant =
    broadcasters.find((p) => p.role === 'host') || broadcasters[0] || undefined;

  const handleSaveMeta = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateRoomMeta({ title: titleDraft.trim() || roomTitle, category: categoryDraft });
    setEditingMeta(false);
  };

  const singleStageMaxWidth = theaterMode ? 'max-w-5xl' : 'max-w-4xl';
  const gridColsClass =
    broadcasters.length <= 1
      ? `grid-cols-1 ${singleStageMaxWidth} mx-auto w-full`
      : broadcasters.length === 2
        ? 'grid-cols-1 md:grid-cols-2 w-full'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 w-full';

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[#FAFAFB] lg:overflow-y-auto">
      {/* Inline Twitch-style Room Browser & Switcher Drawer */}
      {showRoomSwitcher && (
        <RoomSwitcherDrawer
          roomId={roomId}
          selfName={selfName}
          selfRole={selfRole}
          directoryRooms={directoryRooms}
          recentRooms={recentRooms}
          onClose={onCloseRoomSwitcher}
          onRefreshDirectory={onRefreshDirectory}
          onRemoveRecentRoom={onRemoveRecentRoom}
          onClearRecentRooms={onClearRecentRooms}
          onJoinRoom={onJoinRoom}
        />
      )}

      {/* Stream Context Header */}
      <div className="px-5 md:px-7 pt-5 pb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-xl font-semibold tracking-tight text-slate-950 truncate">
              {roomTitle}
            </h1>
            {selfRole !== 'viewer' && (
              <button
                type="button"
                onClick={() => setEditingMeta((v) => !v)}
                aria-label="Edit stream title and category"
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            {isLive ? (
              <span className="inline-flex items-center gap-2 text-xs font-mono font-semibold text-rose-600 tabular-nums">
                <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" aria-hidden="true" />
                LIVE · {formatClockDuration(liveClockSec)}
                {isAutoRecording && (
                  <span className="text-slate-500 font-normal">· Auto-buffering</span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden="true" />
                OFFLINE
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {roomCategory} · Room <span className="font-mono text-slate-700">{roomId}</span> ·{' '}
            {broadcasters.length} on stage · {viewers.length} watching
          </p>
        </div>

        {/* Subtle Desktop Theater Mode Toggle (T) */}
        <button
          type="button"
          onClick={onToggleTheaterMode}
          aria-pressed={theaterMode}
          aria-keyshortcuts="T"
          aria-label={theaterMode ? 'Show stream chat' : 'Hide stream chat (Theater mode)'}
          title={theaterMode ? 'Show chat (T)' : 'Theater mode (T)'}
          className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 bg-white hover:bg-slate-100 border border-slate-200/90 rounded-xl shadow-2xs transition-colors shrink-0"
        >
          {theaterMode ? (
            <>
              <PanelRightOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Show Chat</span>
            </>
          ) : (
            <>
              <PanelRightClose className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Theater</span>
            </>
          )}
        </button>
      </div>

      {/* Inline Stream Info Editor */}
      {editingMeta && (
        <form
          onSubmit={handleSaveMeta}
          className="mx-5 md:mx-7 mb-4 p-4 bg-white border border-slate-200/90 rounded-2xl flex flex-wrap items-end gap-3 shadow-xs"
        >
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="edit-stream-title" className="block text-xs font-medium text-slate-600 mb-1">
              Stream Title
            </label>
            <input
              id="edit-stream-title"
              type="text"
              required
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900"
            />
          </div>
          <div>
            <label htmlFor="edit-stream-category" className="block text-xs font-medium text-slate-600 mb-1">
              Category
            </label>
            <select
              id="edit-stream-category"
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value as StreamCategory)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900"
            >
              {STREAM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingMeta(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Browser Autoplay Unlock Prompt */}
      {audioBlocked && (
        <div
          role="alert"
          className="mx-5 md:mx-7 mb-4 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <VolumeX className="w-4 h-4 text-rose-600" aria-hidden="true" />
            <span>Your browser paused remote audio until you interact with the page.</span>
          </span>
          <button
            type="button"
            onClick={onUnlockAudio}
            className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            Enable Stream Audio
          </button>
        </div>
      )}

      {/* End Stream Confirmation Banner */}
      {streamEndedNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mx-5 md:mx-7 mb-4 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs"
        >
          <span className="font-medium">{streamEndedNotice}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onLeaveRoom}
              className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
            >
              Leave Room
            </button>
            <button
              type="button"
              onClick={onDismissStreamEndedNotice}
              aria-label="Dismiss stream ended notice"
              className="p-1 text-slate-400 hover:text-slate-900 rounded"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Momentary Clip Marker Confirmation */}
      {lastClipMarker && (
        <div
          role="status"
          aria-live="polite"
          className="mx-5 md:mx-7 mb-4 px-4 py-2.5 rounded-xl bg-slate-950 text-white flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <Scissors className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
            <span>
              Clip marked at{' '}
              <span className="font-mono tabular-nums">
                {formatClockDuration(lastClipMarker.streamTimeSec)}
              </span>{' '}
              by {lastClipMarker.triggeredBy} (
              {lastClipMarker.source === 'voice' ? 'Voice "Clip That"' : 'Manual'})
            </span>
          </span>
          <span className="text-slate-300">{selfRole === 'viewer' ? 'Highlight requested' : 'Follow progress in the Clips tab'}</span>
        </div>
      )}

      {/* Subtle status notice if camera unavailable */}
      {mediaNotice && (
        <div className="mx-5 md:mx-7 mb-4 px-4 py-2 rounded-xl bg-white border border-slate-200/80 text-xs text-slate-500">
          {mediaNotice}
        </div>
      )}

      {/* Main Video Stage + Sleek Control Dock + Creator Bio Below Fold */}
      <div className="px-5 md:px-7 pb-6 flex-1 flex flex-col gap-4">
        <div className="flex-1 flex items-center">
          <div className={`grid gap-4 ${gridColsClass}`} data-testid="stage-video-grid">
            {broadcasters.length === 0 ? (
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-white border border-slate-200/90 shadow-xs flex items-center justify-center p-8 text-center">
                <div className="max-w-sm space-y-1.5">
                  <p className="font-display text-lg font-semibold text-slate-900">
                    {selfRole === 'viewer' ? 'Stream is offline' : 'Preparing your stage'}
                  </p>
                  <p className="text-sm text-slate-500">
                    {selfRole === 'viewer'
                      ? 'No broadcasters are currently on stage in this room.'
                      : 'Connecting media devices and room signaling...'}
                  </p>
                </div>
              </div>
            ) : (
              broadcasters.map((p) => {
                const isSelf = p.id === selfId;
                const stream = isSelf ? localStream : remoteStreams[p.id] || null;
                const relayFrame = isSelf ? undefined : remoteRelayFrames[p.id];
                return (
                  <ParticipantVideoTile
                    key={p.id}
                    participant={p}
                    stream={stream}
                    relayFrame={relayFrame}
                    isSelf={isSelf}
                    isPeerMuted={Boolean(mutedPeerIds[p.id])}
                    audioUnlockSeq={audioUnlockSeq}
                    onTogglePeerMute={() => onTogglePeerMute(p.id)}
                    onAudioBlocked={onReportAudioBlocked}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Sleek Broadcast Control Dock */}
        {selfRole !== 'viewer' ? (
          <div
            className={`${singleStageMaxWidth} mx-auto w-full bg-white border border-slate-200/90 rounded-2xl px-4 py-3 shadow-xs space-y-3`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleAudio}
                  aria-pressed={!audioEnabled}
                  aria-keyshortcuts="M"
                  title={audioEnabled ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
                  aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                    audioEnabled
                      ? 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  {audioEnabled ? (
                    <Mic className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <MicOff className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{audioEnabled ? 'Mic' : 'Muted'}</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleVideo}
                  aria-pressed={!videoEnabled}
                  aria-keyshortcuts="V"
                  title={videoEnabled ? 'Turn camera off (V)' : 'Turn camera on (V)'}
                  aria-label={videoEnabled ? 'Turn camera off' : 'Turn camera on'}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                    videoEnabled
                      ? 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  {videoEnabled ? (
                    <Video className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <VideoOff className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{videoEnabled ? 'Camera' : 'Cam Off'}</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleScreenShare}
                  aria-pressed={screenSharing}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                    screenSharing
                      ? 'bg-slate-950 text-white border-slate-950'
                      : 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <MonitorUp className="w-4 h-4" aria-hidden="true" />
                  <span>{screenSharing ? 'Stop Share' : 'Share Screen'}</span>
                </button>

                {(audioDevices.length > 0 || videoDevices.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setShowDevices((v) => !v)}
                    aria-expanded={showDevices}
                    aria-label="Audio and video devices"
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                      showDevices
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Devices</span>
                  </button>
                )}

                <div
                  aria-hidden="true"
                  className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70"
                >
                  <span className="text-[11px] font-mono text-slate-500">IN</span>
                  <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-75"
                      style={{ width: `${audioEnabled ? audioLevel : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={!isLive || !isAutoRecording}
                onClick={() => onTriggerClipMark('manual')}
                aria-keyshortcuts="C"
                title="Mark clip moment (C)"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Scissors className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clip That</span>
              </button>
            </div>

            {showDevices && (audioDevices.length > 0 || videoDevices.length > 0) && (
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                {audioDevices.length > 0 && (
                  <label className="inline-flex items-center gap-2 text-slate-600">
                    <span>Microphone</span>
                    <select
                      value={selectedAudioId}
                      onChange={(e) => onSwitchInputDevice(e.target.value, selectedVideoId)}
                      className="max-w-[200px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-900"
                    >
                      <option value="">Default Microphone</option>
                      {audioDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {videoDevices.length > 0 && (
                  <label className="inline-flex items-center gap-2 text-slate-600">
                    <span>Camera</span>
                    <select
                      value={selectedVideoId}
                      onChange={(e) => onSwitchInputDevice(selectedAudioId, e.target.value)}
                      className="max-w-[200px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-900"
                    >
                      <option value="">Default Camera</option>
                      {videoDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`${singleStageMaxWidth} mx-auto w-full bg-white border border-slate-200/90 rounded-2xl px-4 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3`}
          >
            <p className="text-xs text-slate-600">
              {isLive
                ? 'Watching live. Chat on the right or step onto the stage anytime.'
                : 'Stream is currently offline. Chat live or step onto the stage.'}
            </p>
            <button
              type="button"
              onClick={() =>
                onJoinRoom(roomId, {
                  name: selfName,
                  handle: '',
                  role: 'cohost',
                })
              }
              className="px-4 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors whitespace-nowrap"
            >
              Join Stage
            </button>
          </div>
        )}

        {/* Creator Profile Bio / Setup cleanly positioned below the video stage & dock */}
        <CreatorProfileSection
          roomId={roomId}
          selfName={selfName}
          selfRole={selfRole}
          hostAvatarUrl={hostParticipant?.avatarUrl}
        />
      </div>
    </div>
  );
}
