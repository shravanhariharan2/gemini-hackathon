import { useEffect, useState } from 'react';
import { ClipGenPage } from './components/ClipGenPage';
import { Viewer3DPage } from './components/Viewer3DPage';
import { JoinStreamGate } from './components/JoinStreamGate';
import { LiveChatPanel } from './components/LiveChatPanel';
import { LiveStage } from './components/LiveStage';
import { TopNav } from './components/TopNav';
import { useStudioRoom } from './hooks/useStudioRoom';
import { sanitizeRoomSlug } from './utils/streamUtils';
import { resolveStudioShortcut } from './utils/studioShortcuts';

function getInitialRoomFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  return room ? sanitizeRoomSlug(room) : 'main-stage';
}

async function copyTextReliable(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below for iframe / non-HTTPS clipboard permissions
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export default function App() {
  if (window.location.pathname === '/3d') return <Viewer3DPage />;
  return window.location.pathname === '/clip-gen' ? <ClipGenPage /> : <StudioApp />;
}

function StudioApp() {
  const studio = useStudioRoom(getInitialRoomFromUrl());
  const [showRoomSwitcher, setShowRoomSwitcher] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  useEffect(() => {
    if (!studio.hasJoined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const action = resolveStudioShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          targetTagName: target?.tagName,
          targetIsContentEditable: target?.isContentEditable,
        },
        { isBroadcaster: studio.selfRole !== 'viewer' }
      );
      if (!action) return;
      if (action === 'close-overlays') {
        setShowRoomSwitcher(false);
        return;
      }
      event.preventDefault();
      if (action === 'toggle-theater') {
        setTheaterMode((v) => !v);
      } else if (action === 'toggle-mic') {
        studio.toggleAudio();
      } else if (action === 'toggle-camera') {
        studio.toggleVideo();
      } else if (action === 'trigger-clip') {
        studio.triggerClipMark('manual');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    studio.hasJoined,
    studio.selfRole,
    studio.toggleAudio,
    studio.toggleVideo,
    studio.triggerClipMark,
  ]);

  const handleCopyInvite = async () => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(studio.roomId)}`;
    const ok = await copyTextReliable(url);
    if (ok) {
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 2000);
    }
  };

  if (!studio.hasJoined) {
    return (
      <JoinStreamGate
        initialRoomId={studio.roomId}
        initialRole={studio.selfRole}
        avatar={studio.selfAvatar}
        directoryRooms={studio.directoryRooms}
        recentRooms={studio.recentRooms}
        onShuffleAvatar={studio.shuffleSelfAvatar}
        onRefreshDirectory={studio.refreshDirectory}
        onRemoveRecentRoom={studio.removeRecentRoom}
        onClearRecentRooms={studio.clearRecentRooms}
        onJoin={({ name, roomId, role, avatarUrl, title, category }) => {
          void studio.joinRoom(
            roomId,
            {
              name,
              handle: '',
              role,
              avatarUrl,
            },
            title || category ? { title, category } : undefined
          );
        }}
      />
    );
  }

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-white text-slate-950 lg:overflow-hidden">
      <TopNav
        isLive={studio.isLive}
        selfRole={studio.selfRole}
        copiedInvite={copiedInvite}
        showRoomSwitcher={showRoomSwitcher}
        onCopyInvite={handleCopyInvite}
        onToggleRoomSwitcher={() => setShowRoomSwitcher((v) => !v)}
        onToggleLive={studio.toggleGoLive}
        onLeaveRoom={() => {
          setShowRoomSwitcher(false);
          setTheaterMode(false);
          studio.leaveRoom();
        }}
        onSwitchToStageRole={() => {
          void studio.joinRoom(studio.roomId, {
            name: studio.selfName,
            handle: '',
            role: 'cohost',
            avatarUrl: studio.selfAvatar.url,
          });
        }}
      />

      <main className="flex-1 min-h-0 flex flex-col lg:flex-row lg:overflow-hidden">
        <LiveStage
          roomId={studio.roomId}
          roomTitle={studio.roomTitle}
          roomCategory={studio.roomCategory}
          isLive={studio.isLive}
          streamStartedAt={studio.streamStartedAt}
          isAutoRecording={studio.isAutoRecording}
          lastClipMarker={studio.lastClipMarker}
          streamEndedNotice={studio.streamEndedNotice}
          audioBlocked={studio.audioBlocked}
          audioUnlockSeq={studio.audioUnlockSeq}
          mutedPeerIds={studio.mutedPeerIds}
          selfId={studio.selfId}
          selfName={studio.selfName}
          selfRole={studio.selfRole}
          participants={studio.participants}
          directoryRooms={studio.directoryRooms}
          recentRooms={studio.recentRooms}
          localStream={studio.localStream}
          remoteStreams={studio.remoteStreams}
          remoteRelayFrames={studio.remoteRelayFrames}
          audioEnabled={studio.audioEnabled}
          videoEnabled={studio.videoEnabled}
          screenSharing={studio.screenSharing}
          audioLevel={studio.audioLevel}
          mediaNotice={studio.mediaNotice}
          audioDevices={studio.audioDevices}
          videoDevices={studio.videoDevices}
          selectedAudioId={studio.selectedAudioId}
          selectedVideoId={studio.selectedVideoId}
          showRoomSwitcher={showRoomSwitcher}
          theaterMode={theaterMode}
          onToggleTheaterMode={() => setTheaterMode((v) => !v)}
          onCloseRoomSwitcher={() => setShowRoomSwitcher(false)}
          onRefreshDirectory={studio.refreshDirectory}
          onRemoveRecentRoom={studio.removeRecentRoom}
          onClearRecentRooms={studio.clearRecentRooms}
          onJoinRoom={studio.joinRoom}
          onLeaveRoom={() => {
            setShowRoomSwitcher(false);
            setTheaterMode(false);
            studio.leaveRoom();
          }}
          onDismissStreamEndedNotice={studio.dismissStreamEndedNotice}
          onUpdateRoomMeta={studio.updateRoomMeta}
          onSwitchInputDevice={studio.switchInputDevice}
          onToggleAudio={studio.toggleAudio}
          onToggleVideo={studio.toggleVideo}
          onToggleScreenShare={studio.toggleScreenShare}
          onTogglePeerMute={studio.togglePeerMute}
          onUnlockAudio={studio.unlockAudio}
          onReportAudioBlocked={studio.reportAudioBlocked}
          onTriggerClipMark={studio.triggerClipMark}
        />

        {!theaterMode && (
          <LiveChatPanel
            messages={studio.chatMessages}
            pinnedMessage={studio.pinnedMessage}
            participants={studio.participants}
            selfId={studio.selfId}
            selfRole={studio.selfRole}
            connected={studio.connected}
            slowModeSec={studio.slowModeSec}
            chatError={studio.chatError}
            onSendMessage={studio.sendChatMessage}
            onReactMessage={studio.reactToChatMessage}
            onPinMessage={studio.pinChatMessage}
            onDeleteMessage={studio.deleteChatMessage}
            onUpdateSlowMode={(sec) => studio.updateRoomMeta({ slowModeSec: sec })}
          />
        )}
      </main>
    </div>
  );
}
