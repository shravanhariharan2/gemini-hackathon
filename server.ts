import 'dotenv/config';
import { createClipGenRouter } from './src/server/clipGenRoutes';
import { requireProfileOrigin } from './src/server/profileOrigin';
import { createItemDetectionRouter } from './src/server/itemDetectionRoutes';
import { createShopRouter } from './src/server/shopRoutes';
import { getStreamer, saveStreamer } from './src/server/streamerProfiles';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  appendChatUnique,
  getFallbackAnimalAvatar,
  normalizeHandle,
  partitionParticipants,
  sanitizeAvatarUrl,
  sanitizeRoomSlug,
  validateChatSend,
  validateDisplayName,
} from './src/utils/streamUtils';
import {
  EMPTY_ROOM_GRACE_MS,
  filterAndSortDirectoryRooms,
  isRoomDeprecated,
} from './src/utils/roomLifecycle';
import type {
  ClientWsMessage,
  CreateRoomRequest,
  CreateRoomResponse,
  HealthResponse,
  RoomsListResponse,
  RoomStreamerResponse,
  ServerWsMessage,
} from './src/shared/protocol';
import type {
  ChatMessage,
  ClipMarkerEvent,
  ParticipantRole,
  RoomParticipant,
  RoomStatePayload,
  RoomSummary,
  StreamCategory,
} from './src/utils/types';

const PORT = Number(process.env.PORT || 3000);
const STARTED_AT = Date.now();
const MAX_WS_PAYLOAD_BYTES = 256 * 1024;
const ROOM_GC_INTERVAL_MS = 15_000;

interface ParticipantSession {
  info: RoomParticipant;
  ws: WebSocket;
  lastChatAt: number;
}

interface RoomState {
  id: string;
  title: string;
  category: StreamCategory;
  isLive: boolean;
  streamStartedAt: number | null;
  slowModeSec: number;
  pinnedMessage: ChatMessage | null;
  participants: Map<string, ParticipantSession>;
  chatHistory: ChatMessage[];
  createdAt: number;
  lastActivityAt: number;
  lastEmptyAt: number | null;
}

const VALID_CATEGORIES = new Set<StreamCategory>([
  'Just Chatting',
  'Live Coding',
  'Podcast & Talk',
  'Music & Audio',
  'Gaming',
]);

const rooms = new Map<string, RoomState>();

function sanitizeSafeId(raw: unknown): string | null {
  const str = String(raw || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(str)) {
    return null;
  }
  return str;
}

function getOrCreateRoom(rawRoomId: string): RoomState {
  const safeId = sanitizeRoomSlug(rawRoomId);
  let room = rooms.get(safeId);
  const now = Date.now();
  if (!room) {
    room = {
      id: safeId,
      title: safeId === 'main-stage' ? 'Main Studio Stream' : `${safeId} Live`,
      category: 'Just Chatting',
      isLive: false,
      streamStartedAt: null,
      slowModeSec: 0,
      pinnedMessage: null,
      participants: new Map(),
      chatHistory: [],
      createdAt: now,
      lastActivityAt: now,
      lastEmptyAt: now,
    };
    rooms.set(safeId, room);
  }
  return room;
}

function sweepDeprecatedRooms(now = Date.now()): number {
  let removed = 0;
  for (const [id, room] of rooms.entries()) {
    if (
      isRoomDeprecated(
        { participantCount: room.participants.size, lastEmptyAt: room.lastEmptyAt },
        now,
        EMPTY_ROOM_GRACE_MS
      )
    ) {
      rooms.delete(id);
      removed += 1;
    }
  }
  return removed;
}

function serializeRoomState(room: RoomState): RoomStatePayload {
  return {
    roomId: room.id,
    title: room.title,
    category: room.category,
    isLive: room.isLive,
    streamStartedAt: room.streamStartedAt,
    slowModeSec: room.slowModeSec,
    pinnedMessage: room.pinnedMessage,
    participants: Array.from(room.participants.values()).map((p) => p.info),
    chatHistory: room.chatHistory,
  };
}

function summarizeRoom(room: RoomState): RoomSummary {
  const list = Array.from(room.participants.values()).map((p) => p.info);
  const { broadcasters, viewers } = partitionParticipants(list);
  const host = broadcasters.find((p) => p.role === 'host') || broadcasters[0];
  return {
    roomId: room.id,
    title: room.title,
    category: room.category,
    isLive: room.isLive,
    streamStartedAt: room.streamStartedAt,
    broadcasterCount: broadcasters.length,
    viewerCount: viewers.length,
    hostName: host?.name || 'Open Stage',
    hostAvatarUrl: host?.avatarUrl,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
  };
}

function sendToSocket(ws: WebSocket, payload: ServerWsMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(room: RoomState, payload: ServerWsMessage, excludeId?: string) {
  const data = JSON.stringify(payload);
  for (const [pid, client] of room.participants.entries()) {
    if (excludeId && pid === excludeId) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

class SlidingWindowLimiter {
  private timestamps: number[] = [];
  constructor(
    private readonly maxEvents: number,
    private readonly windowMs: number
  ) {}

  allow(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.maxEvents) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) {
      const started = Date.now();
      res.on('finish', () => {
        if (req.path === '/api/rooms' && res.statusCode === 200) return;
        console.log(
          JSON.stringify({
            level: res.statusCode >= 500 ? 'error' : 'info',
            event: 'http_request',
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - started,
          })
        );
      });
    }
    next();
  });
  app.use('/api/shop', createItemDetectionRouter());
  app.use('/api/clip-gen', createClipGenRouter());
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/shop', createShopRouter());

  const defaultIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  function resolveIceServers() {
    const raw = process.env.WEBRTC_ICE_SERVERS;
    if (!raw) return defaultIceServers;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Fall back to default public STUN servers if env JSON is malformed
    }
    return defaultIceServers;
  }

  app.get('/api/rtc-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ iceServers: resolveIceServers() });
  });

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sweepDeprecatedRooms();
    let activeParticipants = 0;
    let activeRooms = 0;
    for (const room of rooms.values()) {
      if (room.participants.size > 0) {
        activeRooms += 1;
        activeParticipants += room.participants.size;
      }
    }
    const payload: HealthResponse = {
      status: 'ok',
      service: 'ClipThat',
      uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
      activeRooms,
      activeParticipants,
    };
    res.json(payload);
  });

  app.get('/api/rooms', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sweepDeprecatedRooms();
    const list = filterAndSortDirectoryRooms(Array.from(rooms.values()).map(summarizeRoom));
    const response: RoomsListResponse = { rooms: list };
    res.json(response);
  });

  // Demo profile ownership is tied to an HttpOnly browser cookie. Production
  // onboarding must bind this to an authenticated creator account.
  const profileOwner = (req: express.Request): string | null => {
    const cookie = req.headers.cookie?.split(';').map(part => part.trim())
      .find(part => part.startsWith('creator_owner='))?.slice('creator_owner='.length);
    return cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : null;
  };

  app.get('/api/rooms/:roomId/streamer', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const entry = getStreamer(req.params.roomId);
    const payload: RoomStreamerResponse = {
      streamer: entry?.profile || null,
      canEdit: !entry || entry.owner === profileOwner(req),
    };
    res.json(payload);
  });

  app.get('/api/rooms/:roomId/streamer/settings', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const entry = getStreamer(req.params.roomId);
    if (!entry || entry.owner !== profileOwner(req)) {
      res.status(403).json({ error: 'Only the browser that created this profile can edit it.' });
      return;
    }
    res.json({ shippingAddress: entry.shippingAddress });
  });

  app.post('/api/rooms/:roomId/streamer', requireProfileOrigin(), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.params.roomId)) {
      res.status(400).json({ error: 'Invalid room.' });
      return;
    }
    const entry = getStreamer(req.params.roomId);
    const owner = profileOwner(req) || crypto.randomBytes(32).toString('hex');
    if (entry && entry.owner !== owner) {
      res.status(403).json({ error: 'Only the browser that created this profile can edit it.' });
      return;
    }
    try {
      const streamer = saveStreamer(req.params.roomId, owner, req.body);
      res.cookie('creator_owner', owner, {
        httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
      });
      res.json({ streamer, canEdit: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save profile.';
      res.status(400).json({ error: message.startsWith('Enter ') || message.startsWith('Complete ') ? message : 'Could not save profile. Please try again.' });
    }
  });

  app.post('/api/rooms', (req, res) => {
    const { roomId, title, category } = (req.body || {}) as CreateRoomRequest;
    const slug = sanitizeRoomSlug(String(roomId || title || 'studio-room'));
    const room = getOrCreateRoom(slug);
    if (typeof title === 'string' && title.trim()) {
      room.title = title.trim().slice(0, 80);
    }
    if (category && VALID_CATEGORIES.has(category)) {
      room.category = category;
    }
    room.lastActivityAt = Date.now();
    const response: CreateRoomResponse = { room: summarizeRoom(room) };
    res.status(201).json(response);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  interface AliveWebSocket extends WebSocket {
    isAlive?: boolean;
  }

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const aliveClient = client as AliveWebSocket;
      if (aliveClient.isAlive === false) {
        aliveClient.terminate();
        continue;
      }
      aliveClient.isAlive = false;
      try {
        aliveClient.ping();
      } catch {
        aliveClient.terminate();
      }
    }
  }, 15000);

  const roomGcInterval = setInterval(() => {
    sweepDeprecatedRooms();
  }, ROOM_GC_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(roomGcInterval);
  });

  wss.on('connection', (ws: AliveWebSocket) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    let currentRoom: RoomState | null = null;
    let participantId: string | null = null;

    const chatLimiter = new SlidingWindowLimiter(10, 10_000);
    const clipLimiter = new SlidingWindowLimiter(8, 15_000);
    const frameLimiter = new SlidingWindowLimiter(15, 1_000);
    const audioLimiter = new SlidingWindowLimiter(25, 1_000);

    ws.on('message', (raw) => {
      ws.isAlive = true;
      try {
        const msg = JSON.parse(raw.toString()) as ClientWsMessage;
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
          return;
        }

        if (msg.type === 'ping') {
          sendToSocket(ws, { type: 'pong', ts: Date.now() });
          return;
        }

        if (msg.type === 'room:join') {
          const nameCheck = validateDisplayName(String(msg.name || ''));
          if (!nameCheck.ok) {
            sendToSocket(ws, { type: 'error', reason: nameCheck.reason });
            return;
          }

          const roomId = sanitizeRoomSlug(String(msg.roomId || 'main-stage'));
          const room = getOrCreateRoom(roomId);
          const incomingId =
            sanitizeSafeId(msg.participantId) ||
            `user_${crypto.randomBytes(5).toString('hex')}`;
          const name = nameCheck.name;
          const handle = normalizeHandle(name, typeof msg.handle === 'string' ? msg.handle : undefined);

          const requestedRole = msg.role;
          const activeBroadcasters = Array.from(room.participants.values()).filter(
            (p) => p.info.role !== 'viewer' && p.info.id !== incomingId
          );

          let role: ParticipantRole = 'cohost';
          if (requestedRole === 'viewer') {
            role = 'viewer';
          } else if (activeBroadcasters.length === 0 || requestedRole === 'host') {
            role = activeBroadcasters.some((p) => p.info.role === 'host')
              ? 'cohost'
              : 'host';
          }

          if (typeof msg.title === 'string' && msg.title.trim() && role === 'host') {
            room.title = msg.title.trim().slice(0, 80);
          }
          if (
            typeof msg.category === 'string' &&
            VALID_CATEGORIES.has(msg.category) &&
            role === 'host'
          ) {
            room.category = msg.category;
          }

          if (currentRoom && participantId && (currentRoom.id !== room.id || participantId !== incomingId)) {
            const prevEntry = currentRoom.participants.get(participantId);
            if (prevEntry && prevEntry.ws === ws) {
              currentRoom.participants.delete(participantId);
              if (currentRoom.participants.size === 0) {
                currentRoom.lastEmptyAt = Date.now();
              }
              broadcastToRoom(currentRoom, { type: 'participant:left', participantId });
            }
          }

          const existingSameId = room.participants.get(incomingId);
          if (existingSameId && existingSameId.ws !== ws) {
            try {
              existingSameId.ws.terminate();
            } catch {
              // ignore
            }
          }

          currentRoom = room;
          participantId = incomingId;
          room.lastEmptyAt = null;
          room.lastActivityAt = Date.now();

          const safeAvatar =
            sanitizeAvatarUrl(typeof msg.avatarUrl === 'string' ? msg.avatarUrl : undefined) ||
            getFallbackAnimalAvatar(participantId).url;

          const participant: RoomParticipant = {
            id: participantId,
            name,
            handle,
            role,
            audioEnabled: role === 'viewer' ? false : Boolean(msg.audioEnabled ?? true),
            videoEnabled: role === 'viewer' ? false : Boolean(msg.videoEnabled ?? true),
            screenSharing: false,
            avatarUrl: safeAvatar,
            joinedAt: existingSameId?.info.joinedAt ?? Date.now(),
          };

          room.participants.set(participantId, { info: participant, ws, lastChatAt: 0 });

          sendToSocket(ws, {
            type: 'room:joined',
            selfId: participantId,
            state: serializeRoomState(room),
          });

          broadcastToRoom(
            room,
            { type: existingSameId ? 'participant:updated' : 'participant:joined', participant },
            participantId
          );
          return;
        }

        if (!currentRoom || !participantId) return;

        if (msg.type === 'participant:media-state') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry) return;
          if (typeof msg.audioEnabled === 'boolean') entry.info.audioEnabled = msg.audioEnabled;
          if (typeof msg.videoEnabled === 'boolean') entry.info.videoEnabled = msg.videoEnabled;
          if (typeof msg.screenSharing === 'boolean') entry.info.screenSharing = msg.screenSharing;

          broadcastToRoom(currentRoom, {
            type: 'participant:updated',
            participant: entry.info,
          });
        } else if (msg.type === 'stream:toggle-live') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry || entry.info.role === 'viewer') return;
          currentRoom.isLive = Boolean(msg.isLive);
          currentRoom.streamStartedAt = currentRoom.isLive ? Date.now() : null;
          currentRoom.lastActivityAt = Date.now();
          broadcastToRoom(currentRoom, {
            type: 'stream:status',
            isLive: currentRoom.isLive,
            streamStartedAt: currentRoom.streamStartedAt,
          });
        } else if (msg.type === 'clip:mark') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry || entry.info.role === 'viewer') return;
          if (!clipLimiter.allow()) {
            sendToSocket(ws, { type: 'error', reason: 'Too many clip markers. Please wait a moment.' });
            return;
          }
          const now = Date.now();
          const streamTimeSec = currentRoom.streamStartedAt
            ? Math.max(0, Math.round((now - currentRoom.streamStartedAt) / 1000))
            : Math.max(0, Number(msg.streamTimeSec) || 0);
          const source = msg.source === 'voice' ? 'voice' : 'manual';
          const marker: ClipMarkerEvent = {
            id: `clip_${now}_${crypto.randomBytes(3).toString('hex')}`,
            roomId: currentRoom.id,
            triggeredBy: entry.info.name,
            source,
            streamTimeSec,
            createdAt: now,
          };
          broadcastToRoom(currentRoom, { type: 'clip:marked', marker });
        } else if (msg.type === 'room:update-meta') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry || entry.info.role === 'viewer') return;
          if (typeof msg.title === 'string' && msg.title.trim()) {
            currentRoom.title = msg.title.trim().slice(0, 80);
          }
          if (typeof msg.category === 'string' && VALID_CATEGORIES.has(msg.category)) {
            currentRoom.category = msg.category;
          }
          if (typeof msg.slowModeSec === 'number') {
            currentRoom.slowModeSec = Math.max(0, Math.min(60, Math.round(msg.slowModeSec)));
          }
          broadcastToRoom(currentRoom, {
            type: 'room:meta-updated',
            title: currentRoom.title,
            category: currentRoom.category,
            slowModeSec: currentRoom.slowModeSec,
          });
        } else if (msg.type === 'chat:send') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry) return;
          if (!chatLimiter.allow()) {
            sendToSocket(ws, { type: 'chat:rejected', reason: 'Sending messages too quickly — slow down a second.' });
            return;
          }
          const now = Date.now();
          const check = validateChatSend(
            String(msg.text || ''),
            entry.info.role,
            entry.lastChatAt,
            now,
            currentRoom.slowModeSec
          );
          if (!check.ok) {
            sendToSocket(ws, { type: 'chat:rejected', reason: check.reason });
            return;
          }

          entry.lastChatAt = now;
          currentRoom.lastActivityAt = now;
          const streamTimeSec = currentRoom.streamStartedAt
            ? Math.max(0, Math.round((now - currentRoom.streamStartedAt) / 1000))
            : Math.max(0, Number(msg.streamTimeSec) || 0);

          const chatMsg: ChatMessage = {
            id: `msg_${now}_${crypto.randomBytes(3).toString('hex')}`,
            roomId: currentRoom.id,
            senderId: participantId,
            senderName: entry.info.name,
            senderHandle: entry.info.handle,
            role: entry.info.role,
            text: check.text,
            timestamp: now,
            streamTimeSec,
            reactions: {},
          };

          currentRoom.chatHistory = appendChatUnique(currentRoom.chatHistory, chatMsg);
          broadcastToRoom(currentRoom, { type: 'chat:message', message: chatMsg });
        } else if (msg.type === 'chat:react') {
          const messageId = String(msg.messageId || '');
          const label = String(msg.label || '').trim().toUpperCase().slice(0, 8);
          if (!label) return;
          const target = currentRoom.chatHistory.find((m) => m.id === messageId);
          if (!target) return;
          target.reactions = target.reactions || {};
          target.reactions[label] = (target.reactions[label] || 0) + 1;
          broadcastToRoom(currentRoom, {
            type: 'chat:updated',
            message: target,
          });
        } else if (msg.type === 'chat:pin') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry || entry.info.role === 'viewer') return;
          const messageId = msg.messageId ? String(msg.messageId) : null;
          currentRoom.pinnedMessage = messageId
            ? currentRoom.chatHistory.find((m) => m.id === messageId) || null
            : null;
          broadcastToRoom(currentRoom, {
            type: 'chat:pinned',
            pinnedMessage: currentRoom.pinnedMessage,
          });
        } else if (msg.type === 'chat:delete') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry || entry.info.role === 'viewer') return;
          const messageId = String(msg.messageId || '');
          currentRoom.chatHistory = currentRoom.chatHistory.filter((m) => m.id !== messageId);
          if (currentRoom.pinnedMessage?.id === messageId) {
            currentRoom.pinnedMessage = null;
            broadcastToRoom(currentRoom, { type: 'chat:pinned', pinnedMessage: null });
          }
          broadcastToRoom(currentRoom, { type: 'chat:deleted', messageId });
        } else if (msg.type === 'webrtc:offer') {
          const targetPeer = currentRoom.participants.get(String(msg.targetId || ''));
          if (targetPeer) {
            sendToSocket(targetPeer.ws, {
              type: 'webrtc:offer',
              fromId: participantId,
              offer: msg.offer,
            });
          }
        } else if (msg.type === 'webrtc:answer') {
          const targetPeer = currentRoom.participants.get(String(msg.targetId || ''));
          if (targetPeer) {
            sendToSocket(targetPeer.ws, {
              type: 'webrtc:answer',
              fromId: participantId,
              answer: msg.answer,
            });
          }
        } else if (msg.type === 'webrtc:ice-candidate') {
          const targetPeer = currentRoom.participants.get(String(msg.targetId || ''));
          if (targetPeer) {
            sendToSocket(targetPeer.ws, {
              type: 'webrtc:ice-candidate',
              fromId: participantId,
              candidate: msg.candidate,
            });
          }
        } else if (msg.type === 'media:frame') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry || entry.info.role === 'viewer') return;
          if (!frameLimiter.allow()) return;
          const frame = typeof msg.frame === 'string' ? msg.frame : '';
          if (!frame.startsWith('data:image/') || frame.length > 180_000) return;
          broadcastToRoom(
            currentRoom,
            {
              type: 'media:frame',
              fromId: participantId,
              frame,
            },
            participantId
          );
        } else if (msg.type === 'media:audio') {
          const entry = currentRoom.participants.get(participantId);
          if (!entry || entry.info.role === 'viewer' || !entry.info.audioEnabled) return;
          if (!audioLimiter.allow()) return;
          const pcm16 = typeof msg.pcm16 === 'string' ? msg.pcm16 : '';
          const sampleRate = Number(msg.sampleRate);
          if (
            !pcm16 ||
            pcm16.length > 48_000 ||
            !Number.isFinite(sampleRate) ||
            sampleRate < 8000 ||
            sampleRate > 48000
          ) {
            return;
          }
          broadcastToRoom(
            currentRoom,
            {
              type: 'media:audio',
              fromId: participantId,
              pcm16,
              sampleRate: Math.round(sampleRate),
            },
            participantId
          );
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      if (currentRoom && participantId) {
        const entry = currentRoom.participants.get(participantId);
        if (entry && entry.ws === ws) {
          currentRoom.participants.delete(participantId);
          if (currentRoom.participants.size === 0) {
            currentRoom.lastEmptyAt = Date.now();
          }
          broadcastToRoom(currentRoom, {
            type: 'participant:left',
            participantId,
          });
          const remainingBroadcasters = Array.from(currentRoom.participants.values()).filter(
            (p) => p.info.role !== 'viewer'
          );
          if (currentRoom.isLive && remainingBroadcasters.length === 0) {
            currentRoom.isLive = false;
            currentRoom.streamStartedAt = null;
            broadcastToRoom(currentRoom, {
              type: 'stream:status',
              isLive: false,
              streamStartedAt: null,
            });
          }
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipThat server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    clearInterval(heartbeatInterval);
    clearInterval(roomGcInterval);
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down');
    }
    wss.close();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
