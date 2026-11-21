import { clipShopCommand } from './utils/clipShopping';
import type { SavedClip } from './shared/clipping';
import { StreamShopChat, type ShopChatHandle } from './components/StreamShopChat';
import type { StreamCaptureHandle } from './components/LiveStage';
import type { StreamerProfile } from './shared/protocol';
const GiftPanel = lazy(() => import('./components/GiftPanel').then(module => ({ default: module.GiftPanel })));
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AutoClipper, LiveClipsPanel, MyClipsPage } from './components/AutoClipper';
import { ClipGenPage } from './components/ClipGenPage';
import { Viewer3DPage } from './components/Viewer3DPage';
import { useAutoClipper } from './hooks/useAutoClipper';
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
  const clipper = useAutoClipper({ soundboardPlaying: !!studio.soundboardPlaying, active: studio.hasJoined && studio.isLive && studio.selfRole !== 'viewer', roomId: studio.roomId, localStream: studio.localStream, remoteStreams: studio.remoteStreams, remoteRelayFrames: studio.remoteRelayFrames, participants: studio.participants, selfName: studio.selfName, messages: studio.chatMessages });
  const [showMyClips, setShowMyClips] = useState(new URLSearchParams(window.location.search).get('view') === 'clips');
  const [showRoomSwitcher, setShowRoomSwitcher] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const captureRef = useRef<StreamCaptureHandle>(null);
  const shopRef = useRef<ShopChatHandle>(null);
  const [streamer, setStreamer] = useState<StreamerProfile | null>(null);
  const [shopDraft, setShopDraft] = useState<{ id: string; text: string }>();
  const [selectedShopClipId, setSelectedShopClipId] = useState<string>();
  const [shopConnected, setShopConnected] = useState(false);
  const [excludedShopDomains, setExcludedShopDomains] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('shop-merchant-checkout-exclusions') || '[]');
      return Array.isArray(saved) ? saved.filter((shop): shop is string => typeof shop === 'string' && /^[a-z0-9.-]+$/.test(shop)).slice(-100) : [];
    } catch { return []; }
  });
  const excludeMerchantCheckout = useCallback((shop: string) => {
    setExcludedShopDomains(previous => previous.includes(shop) ? previous : [...previous, shop].slice(-100));
  }, []);
  useEffect(() => {
    try { localStorage.setItem('shop-merchant-checkout-exclusions', JSON.stringify(excludedShopDomains)); } catch { /* In-memory filtering still applies. */ }
  }, [excludedShopDomains]);
  const [shopBusy, setShopBusy] = useState(false);
  useEffect(() => { setShopBusy(false); }, [studio.roomId]);
  const currentStreamer = streamer?.roomId === studio.roomId ? streamer : null;
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

  const handleShopClip = (clip: SavedClip) => {
    setSelectedShopClipId(clip.id);
    setShopDraft({ id: crypto.randomUUID(), text: clipShopCommand(clip) });
    setShowMyClips(false); setTheaterMode(false);
  };

  if (showMyClips) return <MyClipsPage clipper={clipper} onShopClip={studio.hasJoined ? handleShopClip : undefined} onBack={() => { setShowMyClips(false); window.history.replaceState(null, '', '/'); }} />;

  if (!studio.hasJoined) {
    return (
      <JoinStreamGate
        onOpenMyClips={() => setShowMyClips(true)}
        clipCount={clipper.queue.length}
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
          soundboardEnabled={studio.isLive && clipper.ready && clipper.recording}
          soundboardBusy={clipper.busy}
          soundboardPlaying={studio.soundboardPlaying}
          soundboardError={studio.soundboardError}
          onPlaySoundboard={async (sound, volume) => {
            if (await studio.playSoundboard(sound, volume)) clipper.detectSoundboard();
          }}
          onStopSoundboard={studio.stopSoundboard}
          captureRef={captureRef}
          onProfileChange={setStreamer}
          roomId={studio.roomId}
          roomTitle={studio.roomTitle}
          roomCategory={studio.roomCategory}
          isLive={studio.isLive}
          streamStartedAt={studio.streamStartedAt}
          isAutoRecording={clipper.recording}
          lastClipMarker={studio.lastClipMarker}
          lastGift={studio.lastGift}
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
          usingSyntheticFeed={studio.usingSyntheticFeed}
          remoteStreams={studio.remoteStreams}
          remoteRelayFrames={studio.remoteRelayFrames}
          peerConnectionStates={studio.peerConnectionStates}
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
            key={studio.roomId}
            shopAvailable={studio.isLive && studio.participants.some(p => p.role !== 'viewer' && (p.videoEnabled || p.screenSharing))}
            shopDraft={shopDraft}
            shopBusy={shopBusy}
            shopConnected={shopConnected}
            onShopQuestion={question => shopRef.current?.ask(question)}
            shoppingPanel={<Suspense fallback={<p className="p-3 text-xs">Opening Shop…</p>}>
              <GiftPanel compact onMerchantCheckoutRequired={excludeMerchantCheckout} onConnectionChange={setShopConnected} roomId={studio.roomId} recipient={currentStreamer?.displayName || 'the streamer'}
                chat={({ add, busy: purchaseBusy, pending: pendingPurchase, blockedReason, reviewCart }) => <StreamShopChat roomId={studio.roomId} clips={clipper.queue} selectedClipId={selectedShopClipId} excludedShopDomains={excludedShopDomains} purchaseBlockReason={blockedReason} onReviewCart={reviewCart} pendingPurchase={pendingPurchase} purchaseBusy={purchaseBusy} compact embedded controllerRef={shopRef} onBusyChange={setShopBusy} isLive={studio.isLive}
                  sources={studio.participants.filter(p => p.role !== 'viewer' && (p.videoEnabled || p.screenSharing)).map(p => ({ id: p.id, name: p.name }))}
                  capture={sourceId => { if (!captureRef.current) throw new Error('The stream is still connecting.'); return captureRef.current.capture(sourceId); }}
                  canGift={Boolean(currentStreamer?.giftingEnabled)} onGift={product => add(product, 'gift')} onBuy={product => add(product, 'self')} />} />
            </Suspense>}
            clipsPanel={studio.selfRole !== 'viewer' || clipper.queue.length > 0 ? <LiveClipsPanel onShopClip={handleShopClip} clipper={clipper} enabled={studio.isLive} /> : undefined}
            clipCount={clipper.queue.length}
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
      {studio.selfRole !== 'viewer' && <AutoClipper clipper={clipper} enabled={studio.isLive} />}
    </div>
  );
}
