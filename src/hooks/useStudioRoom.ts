import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANIMAL_AVATARS,
  type AnimalAvatarOption,
  appendChatUnique,
  detectClipTriggerPhrase,
  getFallbackAnimalAvatar,
  isPolitePeer,
  normalizeHandle,
  pickRandomAnimalAvatar,
  sanitizeRoomSlug,
  shouldTriggerClipMark,
  validateDisplayName,
} from '../utils/streamUtils';
import {
  base64ToFloat32,
  computeRmsLevel,
  downsampleFloat32ToInt16,
  int16ToBase64,
  RELAY_TARGET_SAMPLE_RATE,
} from '../utils/audioRelay';
import {
  RECENT_ROOMS_STORAGE_KEY,
  removeRecentRoomHistory,
  upsertRecentRoomHistory,
} from '../utils/roomLifecycle';
import { dispatchClipToSink } from '../services/clipSink';
import type {
  ClientWsMessage,
  RoomsListResponse,
  ServerWsMessage,
} from '../shared/protocol';
import type {
  ChatMessage,
  ClipMarkerEvent,
  ParticipantRole,
  RecentRoomEntry,
  RoomParticipant,
  RoomSummary,
  StreamCategory,
} from '../utils/types';

export interface StudioProfile {
  name: string;
  handle: string;
  role: ParticipantRole;
  avatarUrl?: string;
}

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

interface PeerRecord {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

function createClientParticipantId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    }
  } catch {
    // Fallback below
  }
  return `user_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function getOrCreateTabAnimalAvatar(): AnimalAvatarOption {
  const key = 'clipthat_avatar_id';
  try {
    const existingId = window.sessionStorage.getItem(key);
    if (existingId) {
      const found = ANIMAL_AVATARS.find((a) => a.id === existingId);
      if (found) return found;
    }
    const picked = pickRandomAnimalAvatar();
    window.sessionStorage.setItem(key, picked.id);
    return picked;
  } catch {
    return pickRandomAnimalAvatar();
  }
}

function getInitialJoinContext(): {
  autoJoined: boolean;
  profile: StudioProfile;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawName = params.get('name') || '';
    const rawRole = params.get('role')?.trim();
    const autostart = params.get('autostart') === '1';
    const role: ParticipantRole =
      rawRole === 'viewer' || rawRole === 'cohost' || rawRole === 'host' ? rawRole : 'host';

    const nameCheck = validateDisplayName(rawName);
    if (nameCheck.ok) {
      return {
        autoJoined: true,
        profile: {
          name: nameCheck.name,
          handle: normalizeHandle(nameCheck.name),
          role,
        },
      };
    }

    if (autostart) {
      return {
        autoJoined: true,
        profile: {
          name: 'Studio Host',
          handle: '@studiohost',
          role,
        },
      };
    }

    return {
      autoJoined: false,
      profile: {
        name: '',
        handle: '',
        role,
      },
    };
  } catch {
    return {
      autoJoined: false,
      profile: {
        name: '',
        handle: '',
        role: 'host',
      },
    };
  }
}

export function useStudioRoom(initialRoomId = 'main-stage') {
  const initialContext = useRef(getInitialJoinContext());
  const initialAvatar = useRef<AnimalAvatarOption>(getOrCreateTabAnimalAvatar());
  const initialClientId = useRef<string>(createClientParticipantId());

  const [hasJoined, setHasJoined] = useState<boolean>(initialContext.current.autoJoined);
  const [selfAvatar, setSelfAvatar] = useState<AnimalAvatarOption>(initialAvatar.current);
  const [roomId, setRoomId] = useState(() => sanitizeRoomSlug(initialRoomId));
  const [roomTitle, setRoomTitle] = useState('Main Studio Stream');
  const [roomCategory, setRoomCategory] = useState<StreamCategory>('Just Chatting');
  const [slowModeSec, setSlowModeSec] = useState(0);
  const [pinnedMessage, setPinnedMessage] = useState<ChatMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState<string | null>(initialClientId.current);
  const [selfName, setSelfName] = useState<string>(initialContext.current.profile.name);
  const [selfRole, setSelfRole] = useState<ParticipantRole>(initialContext.current.profile.role);
  const [isLive, setIsLive] = useState(false);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [lastClipMarker, setLastClipMarker] = useState<ClipMarkerEvent | null>(null);
  const [streamEndedNotice, setStreamEndedNotice] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [directoryRooms, setDirectoryRooms] = useState<RoomSummary[]>([]);
  const [recentRooms, setRecentRooms] = useState<RecentRoomEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_ROOMS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as RecentRoomEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteRelayFrames, setRemoteRelayFrames] = useState<Record<string, string>>({});
  const [mutedPeerIds, setMutedPeerIds] = useState<Record<string, boolean>>({});
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioUnlockSeq, setAudioUnlockSeq] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [usingSyntheticFeed, setUsingSyntheticFeed] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceOption[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceOption[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const hasJoinedRef = useRef<boolean>(initialContext.current.autoJoined);
  const selfIdRef = useRef<string>(initialClientId.current);
  const roomIdRef = useRef<string>(sanitizeRoomSlug(initialRoomId));
  const pendingRoomMetaRef = useRef<{ title?: string; category?: StreamCategory } | null>(null);
  const avatarRef = useRef<AnimalAvatarOption>(initialAvatar.current);
  const profileRef = useRef<StudioProfile>({
    ...initialContext.current.profile,
    avatarUrl: initialAvatar.current.url,
  });
  const audioEnabledRef = useRef<boolean>(true);
  const videoEnabledRef = useRef<boolean>(true);
  const streamStartedAtRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localMediaPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  const peersRef = useRef<Map<string, PeerRecord>>(new Map());
  const remoteStreamsMapRef = useRef<Map<string, MediaStream>>(new Map());
  const mutedPeerIdsRef = useRef<Record<string, boolean>>({});
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const peerPlayCursorRef = useRef<Map<string, number>>(new Map());
  const usingSyntheticAudioRef = useRef<boolean>(false);
  const meterAudioCtxRef = useRef<AudioContext | null>(null);
  const lastClipMarkMsRef = useRef<number>(0);
  const clipBannerTimerRef = useRef<number | null>(null);
  const synthAnimRef = useRef<number | null>(null);
  const synthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const rtcConfigRef = useRef<RTCConfiguration>(RTC_CONFIG);

  streamStartedAtRef.current = streamStartedAt;
  hasJoinedRef.current = hasJoined;
  mutedPeerIdsRef.current = mutedPeerIds;

  useEffect(() => {
    let active = true;
    void fetch('/api/rtc-config')
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { iceServers?: RTCIceServer[] };
        if (active && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          rtcConfigRef.current = { iceServers: data.iceServers };
        }
      })
      .catch(() => {
        // Default STUN config remains active
      });
    return () => {
      active = false;
    };
  }, []);

  const ensurePlaybackContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        playbackCtxRef.current = new AudioCtx();
      } catch {
        return null;
      }
    }
    return playbackCtxRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    const ctx = ensurePlaybackContext();
    if (ctx && ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          setAudioBlocked(false);
          setAudioUnlockSeq((s) => s + 1);
        })
        .catch(() => {
          setAudioBlocked(true);
        });
    } else {
      setAudioBlocked(false);
      setAudioUnlockSeq((s) => s + 1);
    }
  }, [ensurePlaybackContext]);

  const reportAudioBlocked = useCallback(() => {
    setAudioBlocked(true);
  }, []);

  const togglePeerMute = useCallback((peerId: string) => {
    setMutedPeerIds((prev) => {
      const next = { ...prev, [peerId]: !prev[peerId] };
      mutedPeerIdsRef.current = next;
      return next;
    });
  }, []);

  const playRelayedAudioChunk = useCallback(
    (fromId: string, pcm16: string, sampleRate: number) => {
      if (mutedPeerIdsRef.current[fromId]) return;
      if (peersRef.current.get(fromId)?.pc.connectionState === 'connected') {
        return;
      }
      const ctx = ensurePlaybackContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {
          setAudioBlocked(true);
        });
        if (ctx.state === 'suspended') {
          setAudioBlocked(true);
          return;
        }
      }

      const samples = base64ToFloat32(pcm16);
      if (samples.length === 0) return;

      try {
        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        let cursor = peerPlayCursorRef.current.get(fromId) ?? 0;
        if (cursor < now + 0.015 || cursor > now + 0.55) {
          cursor = now + 0.06;
        }
        source.start(cursor);
        peerPlayCursorRef.current.set(fromId, cursor + buffer.duration);
      } catch {
        // ignore invalid audio frame
      }
    },
    [ensurePlaybackContext]
  );

  // Automatically unlock suspended AudioContext / HTMLAudio on the next user click or keypress
  useEffect(() => {
    if (!audioBlocked) return;
    const handleGesture = () => {
      unlockAudio();
    };
    window.addEventListener('pointerdown', handleGesture, { once: true });
    window.addEventListener('keydown', handleGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, [audioBlocked, unlockAudio]);

  const shuffleSelfAvatar = useCallback(() => {
    const next = pickRandomAnimalAvatar(avatarRef.current.url);
    avatarRef.current = next;
    profileRef.current.avatarUrl = next.url;
    setSelfAvatar(next);
    try {
      window.sessionStorage.setItem('clipthat_avatar_id', next.id);
    } catch {
      // ignore storage errors
    }
  }, []);

  const recordRecentRoom = useCallback((entry: RecentRoomEntry) => {
    setRecentRooms((prev) => {
      const next = upsertRecentRoomHistory(prev, entry, 8);
      try {
        window.localStorage.setItem(RECENT_ROOMS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  }, []);

  const removeRecentRoom = useCallback((targetRoomId: string) => {
    setRecentRooms((prev) => {
      const next = removeRecentRoomHistory(prev, targetRoomId);
      try {
        window.localStorage.setItem(RECENT_ROOMS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const clearRecentRooms = useCallback(() => {
    setRecentRooms([]);
    try {
      window.localStorage.removeItem(RECENT_ROOMS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const refreshDirectory = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as RoomsListResponse;
        setDirectoryRooms(data.rooms || []);
      }
    } catch {
      // ignore transient poll failures
    }
  }, []);

  useEffect(() => {
    refreshDirectory();
    const intervalMs = hasJoined ? 4000 : 2500;
    const timer = window.setInterval(refreshDirectory, intervalMs);
    return () => window.clearInterval(timer);
  }, [hasJoined, refreshDirectory]);

  const enumerateMediaDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${idx + 1}`,
        }));
      const cams = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${idx + 1}`,
        }));
      setAudioDevices(mics);
      setVideoDevices(cams);
    } catch {
      // ignore device enumeration denial
    }
  }, []);

  const createSyntheticStudioStream = useCallback((label: string): MediaStream => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    synthCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    let frame = 0;

    const draw = () => {
      if (ctx) {
        frame += 1;
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, '#F8FAFC');
        grad.addColorStop(1, '#EEF2F6');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);

        ctx.strokeStyle = 'rgba(15, 23, 42, 0.05)';
        ctx.lineWidth = 1;
        for (let x = 0; x < 1280; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 720);
          ctx.stroke();
        }
        for (let y = 0; y < 720; y += 64) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(1280, y);
          ctx.stroke();
        }

        const barCount = 24;
        const barW = 12;
        const gap = 10;
        const startX = (1280 - barCount * (barW + gap)) / 2;
        for (let i = 0; i < barCount; i++) {
          const amp = 20 + Math.abs(Math.sin(frame * 0.08 + i * 0.45)) * 84;
          ctx.fillStyle = i % 4 === 0 ? '#E11D48' : '#0F172A';
          ctx.beginPath();
          ctx.roundRect(startX + i * (barW + gap), 375 - amp / 2, barW, amp, 6);
          ctx.fill();
        }

        ctx.fillStyle = '#0F172A';
        ctx.font = '600 32px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, 640, 240);

        ctx.fillStyle = '#64748B';
        ctx.font = '500 18px "JetBrains Mono", monospace';
        const sec = (frame / 15).toFixed(1);
        ctx.fillText(`STUDIO CAMERA STANDBY · 1280x720 · ${sec}s`, 640, 495);
      }
    };

    draw();
    if (synthAnimRef.current) {
      window.clearInterval(synthAnimRef.current);
    }
    synthAnimRef.current = window.setInterval(draw, 1000 / 15);

    const stream = canvas.captureStream(15);

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = new AudioCtx();
      audioCtxRef.current = actx;
      const dest = actx.createMediaStreamDestination();
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      // fallback video-only synthetic stream
    }

    return stream;
  }, []);

  const syncTracksToPeers = useCallback((stream: MediaStream | null) => {
    if (!stream) return;
    peersRef.current.forEach(({ pc }) => {
      const transceivers = pc.getTransceivers();
      stream.getTracks().forEach((track) => {
        const matchingTransceiver = transceivers.find(
          (t) =>
            t.sender.track?.kind === track.kind ||
            t.receiver.track?.kind === track.kind
        );
        if (matchingTransceiver) {
          if (matchingTransceiver.direction === 'recvonly') {
            matchingTransceiver.direction = 'sendrecv';
          }
          matchingTransceiver.sender.replaceTrack(track).catch(() => {});
        } else {
          pc.addTrack(track, stream);
        }
      });
    });
  }, []);

  const startLocalMedia = useCallback(
    async (preferCamera = true, audioDeviceId?: string, videoDeviceId?: string) => {
      const run = async (): Promise<MediaStream | null> => {
        if (profileRef.current.role === 'viewer') {
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
            setLocalStream(null);
          }
          setMediaNotice(null);
          return null;
        }

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        }

        let stream: MediaStream | null = null;
        let isSynthAudio = false;

        if (preferCamera && navigator.mediaDevices?.getUserMedia) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: videoDeviceId
                ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                : { width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: audioDeviceId
                ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true }
                : { echoCancellation: true, noiseSuppression: true },
            });
            setUsingSyntheticFeed(false);
            usingSyntheticAudioRef.current = false;
            setMediaNotice(null);
            await enumerateMediaDevices();
          } catch {
            // Camera unavailable/blocked — try microphone-only so real voice still broadcasts!
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioDeviceId
                  ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true }
                  : { echoCancellation: true, noiseSuppression: true },
              });
              videoEnabledRef.current = false;
              setVideoEnabled(false);
              setUsingSyntheticFeed(false);
              usingSyntheticAudioRef.current = false;
              setMediaNotice(
                'No camera detected — joined with live microphone and your animal avatar.'
              );
              await enumerateMediaDevices();
            } catch {
              stream = null;
            }
          }
        }

        if (!stream) {
          stream = createSyntheticStudioStream(profileRef.current.name);
          isSynthAudio = true;
          setUsingSyntheticFeed(true);
          usingSyntheticAudioRef.current = true;
          setMediaNotice(
            'No physical camera or microphone detected — previewing with Studio Camera Standby feed.'
          );
        }

        stream.getAudioTracks().forEach((t) => {
          t.enabled = audioEnabledRef.current;
        });
        stream.getVideoTracks().forEach((t) => {
          t.enabled = videoEnabledRef.current;
        });

        localStreamRef.current = stream;
        setLocalStream(stream);
        syncTracksToPeers(stream);
        const activeWs = wsRef.current;
        if (activeWs && activeWs.readyState === WebSocket.OPEN) {
          const mediaStateMsg: ClientWsMessage = {
            type: 'participant:media-state',
            audioEnabled: audioEnabledRef.current,
            videoEnabled: videoEnabledRef.current,
          };
          activeWs.send(JSON.stringify(mediaStateMsg));
        }

        if (meterAudioCtxRef.current) {
          meterAudioCtxRef.current.close().catch(() => {});
          meterAudioCtxRef.current = null;
        }

        if (!isSynthAudio && stream.getAudioTracks().length > 0) {
          try {
            const actx = new AudioContext();
            meterAudioCtxRef.current = actx;
            const src = actx.createMediaStreamSource(stream);
            const analyser = actx.createAnalyser();
            analyser.fftSize = 64;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              if (localStreamRef.current !== stream) return;
              analyser.getByteFrequencyData(data);
              const avg = data.reduce((a, b) => a + b, 0) / data.length;
              setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          } catch {
            setAudioLevel(24);
          }
        } else {
          setAudioLevel(32);
        }

        return stream;
      };

      const promise = run();
      localMediaPromiseRef.current = promise;
      return promise;
    },
    [createSyntheticStudioStream, enumerateMediaDevices, syncTracksToPeers]
  );

  const sendWs = useCallback((payload: ClientWsMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const closeAllPeers = useCallback(() => {
    peersRef.current.forEach(({ pc }) => pc.close());
    peersRef.current.clear();
    remoteStreamsMapRef.current.clear();
    setRemoteStreams({});
    setRemoteRelayFrames({});
  }, []);

  const sendOfferToPeer = useCallback(
    async (peerId: string, rec: PeerRecord) => {
      if (rec.makingOffer || rec.pc.signalingState !== 'stable') return;
      try {
        rec.makingOffer = true;
        await rec.pc.setLocalDescription();
        if (rec.pc.localDescription) {
          sendWs({
            type: 'webrtc:offer',
            targetId: peerId,
            offer: rec.pc.localDescription.toJSON(),
          });
        }
      } catch {
        // Ignore negotiation glare; handled by Perfect Negotiation
      } finally {
        rec.makingOffer = false;
      }
    },
    [sendWs]
  );

  const ensurePeerRecord = useCallback(
    (peerId: string): PeerRecord => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(rtcConfigRef.current);
      const record: PeerRecord = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        pendingCandidates: [],
      };
      peersRef.current.set(peerId, record);

      if (localStreamRef.current && profileRef.current.role !== 'viewer') {
        const tracks = localStreamRef.current.getTracks();
        tracks.forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
        if (!tracks.some((t) => t.kind === 'video')) {
          pc.addTransceiver('video', { direction: 'recvonly' });
        }
        if (!tracks.some((t) => t.kind === 'audio')) {
          pc.addTransceiver('audio', { direction: 'recvonly' });
        }
      } else {
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendWs({
            type: 'webrtc:ice-candidate',
            targetId: peerId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (ev) => {
        const track = ev.track;
        let peerStream = remoteStreamsMapRef.current.get(peerId);
        if (!peerStream) {
          peerStream = new MediaStream();
          remoteStreamsMapRef.current.set(peerId, peerStream);
        }
        if (!peerStream.getTracks().some((t) => t.id === track.id)) {
          peerStream.addTrack(track);
        }
        const publishSnapshot = () => {
          const current = remoteStreamsMapRef.current.get(peerId);
          if (!current) return;
          const snapshot = new MediaStream(current.getTracks());
          setRemoteStreams((prev) => ({ ...prev, [peerId]: snapshot }));
        };
        publishSnapshot();
        track.onunmute = publishSnapshot;
      };

      pc.onnegotiationneeded = async () => {
        const polite = isPolitePeer(selfIdRef.current, peerId);
        if (polite && !pc.currentRemoteDescription) {
          return;
        }
        await sendOfferToPeer(peerId, record);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          pc.restartIce();
        }
      };

      return record;
    },
    [sendOfferToPeer, sendWs]
  );

  const ensurePeerRecordRef = useRef(ensurePeerRecord);
  const sendOfferToPeerRef = useRef(sendOfferToPeer);
  const refreshDirectoryRef = useRef(refreshDirectory);
  const closeAllPeersRef = useRef(closeAllPeers);
  const startLocalMediaRef = useRef(startLocalMedia);
  const sendWsRef = useRef(sendWs);
  const playRelayedAudioChunkRef = useRef(playRelayedAudioChunk);
  const recordRecentRoomRef = useRef(recordRecentRoom);

  ensurePeerRecordRef.current = ensurePeerRecord;
  sendOfferToPeerRef.current = sendOfferToPeer;
  refreshDirectoryRef.current = refreshDirectory;
  closeAllPeersRef.current = closeAllPeers;
  startLocalMediaRef.current = startLocalMedia;
  sendWsRef.current = sendWs;
  playRelayedAudioChunkRef.current = playRelayedAudioChunk;
  recordRecentRoomRef.current = recordRecentRoom;

  const joinRoom = useCallback(
    async (
      targetRoomId: string,
      profile: StudioProfile,
      meta?: { title?: string; category?: StreamCategory }
    ) => {
      const nameCheck = validateDisplayName(profile.name);
      if (!nameCheck.ok) return;

      // Unlock browser Web Audio playback inside the user's Join click gesture
      unlockAudio();

      const cleanRoom = sanitizeRoomSlug(targetRoomId);
      const avatarUrl =
        profile.avatarUrl || avatarRef.current.url || getFallbackAnimalAvatar(selfIdRef.current).url;
      const cleanProfile: StudioProfile = {
        name: nameCheck.name,
        handle: normalizeHandle(nameCheck.name, profile.handle),
        role: profile.role,
        avatarUrl,
      };
      profileRef.current = cleanProfile;
      setSelfName(cleanProfile.name);
      setSelfRole(cleanProfile.role);
      roomIdRef.current = cleanRoom;
      setRoomId(cleanRoom);

      const url = new URL(window.location.href);
      url.searchParams.set('room', cleanRoom);
      window.history.replaceState({}, '', url.toString());

      if (!hasJoinedRef.current) {
        pendingRoomMetaRef.current = meta || null;
        hasJoinedRef.current = true;
        setHasJoined(true);
        return;
      }

      closeAllPeers();
      await startLocalMedia(
        cleanProfile.role !== 'viewer',
        selectedAudioId || undefined,
        selectedVideoId || undefined
      );

      sendWs({
        type: 'room:join',
        roomId: cleanRoom,
        participantId: selfIdRef.current,
        name: cleanProfile.name,
        handle: cleanProfile.handle,
        role: cleanProfile.role,
        title: meta?.title,
        category: meta?.category,
        audioEnabled: cleanProfile.role !== 'viewer' && audioEnabledRef.current,
        videoEnabled: cleanProfile.role !== 'viewer' && videoEnabledRef.current,
        avatarUrl,
      });

      refreshDirectory();
    },
    [closeAllPeers, refreshDirectory, selectedAudioId, selectedVideoId, sendWs, startLocalMedia, unlockAudio]
  );

  const triggerClipMark = useCallback((source: 'manual' | 'voice' = 'manual') => {
    if (profileRef.current.role === 'viewer') return;
    const now = Date.now();
    if (source === 'voice' && !shouldTriggerClipMark(lastClipMarkMsRef.current, now, 3500)) {
      return;
    }
    lastClipMarkMsRef.current = now;
    const streamTimeSec = streamStartedAtRef.current
      ? Math.max(0, Math.round((now - streamStartedAtRef.current) / 1000))
      : 0;
    sendWsRef.current({ type: 'clip:mark', source, streamTimeSec });
  }, []);

  // Always-on automatic "clip that" voice detection while live and unmuted (no manual toggle needed)
  useEffect(() => {
    if (!hasJoined || !isLive || selfRole === 'viewer' || !audioEnabled) {
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    let active = true;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript || '';
        if (detectClipTriggerPhrase(transcript)) {
          triggerClipMark('voice');
        }
      }
    };

    recognition.onerror = (ev) => {
      if (
        ev.error === 'not-allowed' ||
        ev.error === 'service-not-allowed' ||
        ev.error === 'audio-capture'
      ) {
        active = false;
      }
    };

    recognition.onend = () => {
      if (active) {
        try {
          recognition.start();
        } catch {
          // ignore restart race
        }
      }
    };

    try {
      recognition.start();
    } catch {
      active = false;
    }

    return () => {
      active = false;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };
  }, [audioEnabled, hasJoined, isLive, selfRole, triggerClipMark]);

  // WebSocket signaling & media connection once user has entered their name and joined
  useEffect(() => {
    if (!hasJoined) return;

    let disposed = false;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;

    if (profileRef.current.role !== 'viewer') {
      void startLocalMediaRef.current(true);
    }

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || ws.readyState !== WebSocket.OPEN) return;

        reconnectAttemptRef.current = 0;
        setConnected(true);
        const pendingMeta = pendingRoomMetaRef.current;
        pendingRoomMetaRef.current = null;
        const joinPayload: ClientWsMessage = {
          type: 'room:join',
          roomId: roomIdRef.current,
          participantId: selfIdRef.current,
          name: profileRef.current.name,
          handle: profileRef.current.handle,
          role: profileRef.current.role,
          title: pendingMeta?.title,
          category: pendingMeta?.category,
          audioEnabled: profileRef.current.role !== 'viewer' && audioEnabledRef.current,
          videoEnabled: profileRef.current.role !== 'viewer' && videoEnabledRef.current,
          avatarUrl: profileRef.current.avatarUrl || avatarRef.current.url,
        };
        ws.send(JSON.stringify(joinPayload));

        heartbeatTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const pingMsg: ClientWsMessage = { type: 'ping' };
            ws.send(JSON.stringify(pingMsg));
          }
        }, 20000);
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerWsMessage;

          if (msg.type === 'pong') return;

          if (msg.type === 'room:joined') {
            const state = msg.state;
            selfIdRef.current = msg.selfId;
            setSelfId(msg.selfId);
            setRoomTitle(state.title);
            setRoomCategory(state.category);
            setSlowModeSec(state.slowModeSec);
            setPinnedMessage(state.pinnedMessage);
            setIsLive(state.isLive);
            setStreamStartedAt(state.streamStartedAt);
            setParticipants(state.participants || []);
            setChatMessages(state.chatHistory || []);
            setRemoteRelayFrames({});

            const selfMember = state.participants.find((p) => p.id === msg.selfId);
            if (selfMember) {
              setSelfRole(selfMember.role);
              setSelfName(selfMember.name);
              profileRef.current.role = selfMember.role;
            }
            recordRecentRoomRef.current({
              roomId: state.roomId,
              title: state.title,
              category: state.category,
              lastRole: selfMember?.role || profileRef.current.role,
              lastVisitedAt: Date.now(),
            });
            refreshDirectoryRef.current();

            for (const peer of state.participants) {
              if (peer.id !== msg.selfId && !isPolitePeer(msg.selfId, peer.id)) {
                const rec = ensurePeerRecordRef.current(peer.id);
                if (rec.pc.signalingState === 'stable' && !rec.makingOffer && !rec.pc.localDescription) {
                  await sendOfferToPeerRef.current(peer.id, rec);
                }
              }
            }
          } else if (msg.type === 'participant:joined') {
            const incoming = msg.participant;
            setParticipants((prev) =>
              prev.some((p) => p.id === incoming.id)
                ? prev.map((p) => (p.id === incoming.id ? incoming : p))
                : [...prev, incoming]
            );
            if (incoming.id !== selfIdRef.current && !isPolitePeer(selfIdRef.current, incoming.id)) {
              const rec = ensurePeerRecordRef.current(incoming.id);
              if (rec.pc.signalingState === 'stable' && !rec.makingOffer && !rec.pc.localDescription) {
                await sendOfferToPeerRef.current(incoming.id, rec);
              }
            }
          } else if (msg.type === 'participant:updated') {
            const updated = msg.participant;
            let roleChanged = false;
            setParticipants((prev) => {
              const existing = prev.find((p) => p.id === updated.id);
              if (existing && existing.role !== updated.role) {
                roleChanged = true;
              }
              return prev.some((p) => p.id === updated.id)
                ? prev.map((p) => (p.id === updated.id ? updated : p))
                : [...prev, updated];
            });
            if (roleChanged && updated.id !== selfIdRef.current) {
              const stale = peersRef.current.get(updated.id);
              if (stale) {
                stale.pc.close();
                peersRef.current.delete(updated.id);
              }
              remoteStreamsMapRef.current.delete(updated.id);
              setRemoteStreams((prev) => {
                const next = { ...prev };
                delete next[updated.id];
                return next;
              });
              if (!isPolitePeer(selfIdRef.current, updated.id)) {
                const rec = ensurePeerRecordRef.current(updated.id);
                if (rec.pc.signalingState === 'stable' && !rec.makingOffer && !rec.pc.localDescription) {
                  await sendOfferToPeerRef.current(updated.id, rec);
                }
              }
            }
          } else if (msg.type === 'participant:left') {
            const leftId = msg.participantId;
            setParticipants((prev) => prev.filter((p) => p.id !== leftId));
            const rec = peersRef.current.get(leftId);
            if (rec) {
              rec.pc.close();
              peersRef.current.delete(leftId);
            }
            remoteStreamsMapRef.current.delete(leftId);
            setRemoteStreams((prev) => {
              const next = { ...prev };
              delete next[leftId];
              return next;
            });
            peerPlayCursorRef.current.delete(leftId);
            setRemoteRelayFrames((prev) => {
              const next = { ...prev };
              delete next[leftId];
              return next;
            });
          } else if (msg.type === 'stream:status') {
            const wasLive = streamStartedAtRef.current !== null;
            const prevDuration = streamStartedAtRef.current
              ? Math.max(0, Math.floor((Date.now() - streamStartedAtRef.current) / 1000))
              : 0;
            setIsLive(msg.isLive);
            setStreamStartedAt(msg.streamStartedAt ?? null);
            if (msg.isLive) {
              setStreamEndedNotice(null);
            } else if (wasLive) {
              const mins = Math.floor(prevDuration / 60);
              const secs = String(prevDuration % 60).padStart(2, '0');
              setStreamEndedNotice(`Stream ended (${mins}:${secs}) — room is now offline.`);
            }
            refreshDirectoryRef.current();
          } else if (msg.type === 'clip:marked') {
            const marker = msg.marker;
            setLastClipMarker(marker);
            if (profileRef.current.role !== 'viewer') {
              void dispatchClipToSink({
                marker,
              });
            }
            if (clipBannerTimerRef.current) {
              window.clearTimeout(clipBannerTimerRef.current);
            }
            clipBannerTimerRef.current = window.setTimeout(() => {
              setLastClipMarker(null);
            }, 6000);
          } else if (msg.type === 'room:meta-updated') {
            setRoomTitle(msg.title);
            setRoomCategory(msg.category);
            setSlowModeSec(msg.slowModeSec ?? 0);
            recordRecentRoomRef.current({
              roomId: roomIdRef.current,
              title: msg.title,
              category: msg.category,
              lastRole: profileRef.current.role,
              lastVisitedAt: Date.now(),
            });
            refreshDirectoryRef.current();
          } else if (msg.type === 'chat:message') {
            setChatMessages((prev) => appendChatUnique(prev, msg.message));
          } else if (msg.type === 'chat:updated') {
            const updated = msg.message;
            setChatMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          } else if (msg.type === 'chat:deleted') {
            setChatMessages((prev) => prev.filter((m) => m.id !== msg.messageId));
          } else if (msg.type === 'chat:pinned') {
            setPinnedMessage(msg.pinnedMessage || null);
          } else if (msg.type === 'chat:rejected') {
            setChatError(msg.reason || 'Message rejected');
            window.setTimeout(() => setChatError(null), 3500);
          } else if (msg.type === 'webrtc:offer') {
            const fromId = msg.fromId;
            const rec = ensurePeerRecordRef.current(fromId);
            const polite = isPolitePeer(selfIdRef.current, fromId);
            const offerCollision = rec.makingOffer || rec.pc.signalingState !== 'stable';
            rec.ignoreOffer = !polite && offerCollision;
            if (rec.ignoreOffer) return;

            await rec.pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
            while (rec.pendingCandidates.length > 0) {
              const cand = rec.pendingCandidates.shift()!;
              await rec.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            const answer = await rec.pc.createAnswer();
            await rec.pc.setLocalDescription(answer);
            if (rec.pc.localDescription) {
              sendWsRef.current({
                type: 'webrtc:answer',
                targetId: fromId,
                answer: rec.pc.localDescription.toJSON(),
              });
            }
          } else if (msg.type === 'webrtc:answer') {
            const rec = peersRef.current.get(msg.fromId);
            if (rec && rec.pc.signalingState === 'have-local-offer') {
              await rec.pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
              while (rec.pendingCandidates.length > 0) {
                const cand = rec.pendingCandidates.shift()!;
                await rec.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              }
            }
          } else if (msg.type === 'webrtc:ice-candidate') {
            const fromId = msg.fromId;
            const rec = ensurePeerRecordRef.current(fromId);
            if (rec.ignoreOffer) return;
            if (rec.pc.remoteDescription) {
              await rec.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
            } else {
              rec.pendingCandidates.push(msg.candidate);
            }
          } else if (msg.type === 'media:frame') {
            if (msg.fromId && msg.frame.startsWith('data:image/')) {
              setRemoteRelayFrames((prev) => ({ ...prev, [msg.fromId]: msg.frame }));
            }
          } else if (msg.type === 'media:audio') {
            playRelayedAudioChunkRef.current(msg.fromId, msg.pcm16, msg.sampleRate);
          }
        } catch {
          // ignore malformed signaling frames
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (heartbeatTimer) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (!disposed) {
          const delay = Math.min(8000, 1000 * Math.pow(1.5, reconnectAttemptRef.current));
          reconnectAttemptRef.current += 1;
          reconnectTimer = window.setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      if (clipBannerTimerRef.current) window.clearTimeout(clipBannerTimerRef.current);
      if (synthAnimRef.current) window.clearInterval(synthAnimRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      if (meterAudioCtxRef.current) meterAudioCtxRef.current.close().catch(() => {});
      if (playbackCtxRef.current) playbackCtxRef.current.close().catch(() => {});
      peerPlayCursorRef.current.clear();
      wsRef.current?.close();
      closeAllPeersRef.current();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [hasJoined]);

  // Automatic WebSocket media frame relay fallback when any peer's WebRTC P2P ICE connection is blocked/pending
  useEffect(() => {
    if (!hasJoined || !connected || selfRole === 'viewer' || !localStream || (!videoEnabled && !screenSharing)) {
      return;
    }
    const otherPeers = participants.filter((p) => p.id !== selfId);
    if (otherPeers.length === 0) return;

    const offscreenVideo = document.createElement('video');
    offscreenVideo.muted = true;
    offscreenVideo.playsInline = true;
    offscreenVideo.srcObject = localStream;
    offscreenVideo.play().catch(() => {});

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d');

    let timer: number | null = null;
    const startupGraceTimer = window.setTimeout(() => {
      timer = window.setInterval(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 180_000) return;

        const anyPeerNeedsRelay = otherPeers.some(
          (p) => peersRef.current.get(p.id)?.pc.connectionState !== 'connected'
        );
        if (!anyPeerNeedsRelay || !ctx) return;

        if (offscreenVideo.readyState >= 2 && offscreenVideo.videoWidth > 0) {
          ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
        } else if (usingSyntheticFeed && synthCanvasRef.current) {
          ctx.drawImage(synthCanvasRef.current, 0, 0, canvas.width, canvas.height);
        } else {
          return;
        }

        let dataUrl = canvas.toDataURL('image/webp', 0.62);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.62);
        }
        const frameMsg: ClientWsMessage = { type: 'media:frame', frame: dataUrl };
        ws.send(JSON.stringify(frameMsg));
      }, 130);
    }, 600);

    return () => {
      window.clearTimeout(startupGraceTimer);
      if (timer) window.clearInterval(timer);
      offscreenVideo.pause();
      offscreenVideo.srcObject = null;
    };
  }, [connected, hasJoined, localStream, participants, screenSharing, selfId, selfRole, usingSyntheticFeed, videoEnabled]);

  // Automatic WebSocket PCM audio relay fallback whenever any peer's WebRTC P2P ICE is not connected
  useEffect(() => {
    if (
      !hasJoined ||
      !connected ||
      selfRole === 'viewer' ||
      !localStream ||
      !audioEnabled ||
      usingSyntheticAudioRef.current ||
      localStream.getAudioTracks().length === 0
    ) {
      return;
    }
    const otherPeers = participants.filter((p) => p.id !== selfId);
    if (otherPeers.length === 0) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let captureCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let silentGain: GainNode | null = null;
    let lastVoiceMs = 0;

    try {
      captureCtx = new AudioCtx();
      if (captureCtx.state === 'suspended') {
        captureCtx.resume().catch(() => {});
      }
      const audioOnlyStream = new MediaStream(localStream.getAudioTracks());
      source = captureCtx.createMediaStreamSource(audioOnlyStream);
      processor = captureCtx.createScriptProcessor(4096, 1, 1);
      silentGain = captureCtx.createGain();
      silentGain.gain.value = 0;

      const inputSampleRate = captureCtx.sampleRate;
      processor.onaudioprocess = (event) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 120_000) return;
        const anyPeerNeedsRelay = otherPeers.some(
          (p) => peersRef.current.get(p.id)?.pc.connectionState !== 'connected'
        );
        if (!anyPeerNeedsRelay) return;

        const channelData = event.inputBuffer.getChannelData(0);
        const rms = computeRmsLevel(channelData);
        const now = Date.now();
        if (rms > 0.002) {
          lastVoiceMs = now;
        }
        if (now - lastVoiceMs > 700) {
          return;
        }

        const pcm16 = downsampleFloat32ToInt16(
          channelData,
          inputSampleRate,
          RELAY_TARGET_SAMPLE_RATE
        );
        if (pcm16.length === 0) return;
        const audioMsg: ClientWsMessage = {
          type: 'media:audio',
          pcm16: int16ToBase64(pcm16),
          sampleRate: RELAY_TARGET_SAMPLE_RATE,
        };
        ws.send(JSON.stringify(audioMsg));
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(captureCtx.destination);
    } catch {
      // ignore audio capture setup failure
    }

    return () => {
      if (processor) {
        processor.onaudioprocess = null;
        try {
          processor.disconnect();
        } catch {
          // ignore
        }
      }
      if (source) {
        try {
          source.disconnect();
        } catch {
          // ignore
        }
      }
      if (silentGain) {
        try {
          silentGain.disconnect();
        } catch {
          // ignore
        }
      }
      if (captureCtx) {
        captureCtx.close().catch(() => {});
      }
    };
  }, [audioEnabled, connected, hasJoined, localStream, participants, selfId, selfRole]);

  const switchInputDevice = useCallback(
    async (audioId: string, videoId: string) => {
      setSelectedAudioId(audioId);
      setSelectedVideoId(videoId);
      await startLocalMedia(true, audioId || undefined, videoId || undefined);
    },
    [startLocalMedia]
  );

  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      audioEnabledRef.current = next;
      localStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = next;
      });
      sendWs({ type: 'participant:media-state', audioEnabled: next });
      return next;
    });
  }, [sendWs]);

  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      videoEnabledRef.current = next;
      const tracks = localStreamRef.current?.getVideoTracks() || [];
      if (next && tracks.length === 0 && profileRef.current.role !== 'viewer') {
        void startLocalMedia(true, selectedAudioId || undefined, selectedVideoId || undefined);
      } else {
        tracks.forEach((t) => {
          t.enabled = next;
        });
      }
      sendWs({ type: 'participant:media-state', videoEnabled: next });
      return next;
    });
  }, [selectedAudioId, selectedVideoId, sendWs, startLocalMedia]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      setScreenSharing(false);
      sendWs({ type: 'participant:media-state', screenSharing: false });
      await startLocalMedia(true, selectedAudioId || undefined, selectedVideoId || undefined);
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaNotice('Screen sharing is not available in this browser context.');
      return;
    }
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = screenStream;
      setLocalStream(screenStream);
      setScreenSharing(true);
      setUsingSyntheticFeed(false);
      setMediaNotice(null);
      syncTracksToPeers(screenStream);
      sendWs({ type: 'participant:media-state', screenSharing: true });
      screenStream.getVideoTracks()[0].onended = () => {
        setScreenSharing(false);
        sendWs({ type: 'participant:media-state', screenSharing: false });
        void startLocalMedia(true, selectedAudioId || undefined, selectedVideoId || undefined);
      };
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name !== 'AbortError') {
        setMediaNotice('Screen sharing was cancelled or blocked by browser permissions.');
      }
    }
  }, [screenSharing, selectedAudioId, selectedVideoId, sendWs, startLocalMedia, syncTracksToPeers]);

  const toggleGoLive = useCallback(() => {
    if (selfRole === 'viewer') return;
    unlockAudio();
    const next = !isLive;
    if (next) {
      setStreamEndedNotice(null);
      setIsLive(true);
      setStreamStartedAt(Date.now());
      sendWs({ type: 'stream:toggle-live', isLive: true });
    } else {
      const durationSec = streamStartedAtRef.current
        ? Math.max(0, Math.floor((Date.now() - streamStartedAtRef.current) / 1000))
        : 0;
      const mins = Math.floor(durationSec / 60);
      const secs = String(durationSec % 60).padStart(2, '0');
      setIsLive(false);
      setStreamStartedAt(null);
      setStreamEndedNotice(`Stream ended (${mins}:${secs}) — you are back in backstage preview.`);
      sendWs({ type: 'stream:toggle-live', isLive: false });
      if (screenSharing) {
        setScreenSharing(false);
        sendWs({ type: 'participant:media-state', screenSharing: false });
        void startLocalMedia(true, selectedAudioId || undefined, selectedVideoId || undefined);
      }
    }
  }, [isLive, screenSharing, selectedAudioId, selectedVideoId, selfRole, sendWs, startLocalMedia, unlockAudio]);

  const leaveRoom = useCallback(() => {
    if (isLive && selfRole !== 'viewer') {
      const remainingBroadcasters = participants.filter(
        (p) => p.id !== selfIdRef.current && p.role !== 'viewer'
      );
      if (remainingBroadcasters.length === 0) {
        sendWs({ type: 'stream:toggle-live', isLive: false });
      }
    }
    wsRef.current?.close();
    wsRef.current = null;
    closeAllPeers();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setConnected(false);
    setIsLive(false);
    setStreamStartedAt(null);
    setScreenSharing(false);
    setStreamEndedNotice(null);
    setMediaNotice(null);
    setLastClipMarker(null);
    setParticipants([]);
    setChatMessages([]);
    hasJoinedRef.current = false;
    setHasJoined(false);
  }, [closeAllPeers, isLive, participants, selfRole, sendWs]);

  const dismissStreamEndedNotice = useCallback(() => {
    setStreamEndedNotice(null);
  }, []);

  const updateRoomMeta = useCallback(
    (meta: { title?: string; category?: StreamCategory; slowModeSec?: number }) => {
      sendWs({ type: 'room:update-meta', ...meta });
    },
    [sendWs]
  );

  const sendChatMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const streamTimeSec = streamStartedAt
        ? Math.max(0, Math.round((Date.now() - streamStartedAt) / 1000))
        : 0;
      sendWs({ type: 'chat:send', text: trimmed, streamTimeSec });
    },
    [sendWs, streamStartedAt]
  );

  const reactToChatMessage = useCallback(
    (messageId: string, label: string) => {
      sendWs({ type: 'chat:react', messageId, label });
    },
    [sendWs]
  );

  const pinChatMessage = useCallback(
    (messageId: string | null) => {
      sendWs({ type: 'chat:pin', messageId });
    },
    [sendWs]
  );

  const deleteChatMessage = useCallback(
    (messageId: string) => {
      sendWs({ type: 'chat:delete', messageId });
    },
    [sendWs]
  );

  return {
    hasJoined,
    selfAvatar,
    roomId,
    roomTitle,
    roomCategory,
    slowModeSec,
    pinnedMessage,
    connected,
    selfId,
    selfName,
    selfRole,
    isLive,
    streamStartedAt,
    lastClipMarker,
    streamEndedNotice,
    participants,
    chatMessages,
    chatError,
    directoryRooms,
    recentRooms,
    remoteStreams,
    remoteRelayFrames,
    mutedPeerIds,
    audioBlocked,
    audioUnlockSeq,
    localStream,
    audioEnabled,
    videoEnabled,
    screenSharing,
    audioLevel,
    usingSyntheticFeed,
    mediaNotice,
    audioDevices,
    videoDevices,
    selectedAudioId,
    selectedVideoId,
    shuffleSelfAvatar,
    togglePeerMute,
    unlockAudio,
    reportAudioBlocked,
    joinRoom,
    refreshDirectory,
    removeRecentRoom,
    clearRecentRooms,
    switchInputDevice,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleGoLive,
    leaveRoom,
    dismissStreamEndedNotice,
    triggerClipMark,
    updateRoomMeta,
    sendChatMessage,
    reactToChatMessage,
    pinChatMessage,
    deleteChatMessage,
  };
}
