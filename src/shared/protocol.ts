import type {
  ChatMessage,
  ClipMarkerEvent,
  ParticipantRole,
  RoomParticipant,
  RoomStatePayload,
  RoomSummary,
  StreamCategory,
} from '../utils/types';

/**
 * Typed REST API contracts for room management and health checks.
 */
export interface HealthResponse {
  status: 'ok';
  service: 'ClipThat';
  uptimeSec: number;
  activeRooms: number;
  activeParticipants: number;
}

export interface RoomsListResponse {
  rooms: RoomSummary[];
}

export interface CreateRoomRequest {
  roomId?: string;
  title?: string;
  category?: StreamCategory;
}

export interface CreateRoomResponse {
  room: RoomSummary;
}

/**
 * Downstream clipping integration contract.
 * A downstream clipping service (e.g., Deepgram + DaVinci Resolve) can register
 * a ClipSinkAdapter to consume clip markers. The sink owns recording and post-roll.
 */
export interface DownstreamClipPayload {
  marker: ClipMarkerEvent;
}

export interface ClipSinkAdapter {
  readonly name: string;
  onClipMarked: (payload: DownstreamClipPayload) => void | Promise<void>;
}

/**
 * Strict discriminated union for Client -> Server WebSocket frames.
 */
export type ClientWsMessage =
  | { type: 'ping' }
  | {
      type: 'room:join';
      roomId: string;
      participantId?: string;
      name: string;
      handle?: string;
      role?: ParticipantRole;
      title?: string;
      category?: StreamCategory;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      avatarUrl?: string;
    }
  | {
      type: 'participant:media-state';
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      screenSharing?: boolean;
    }
  | { type: 'stream:toggle-live'; isLive: boolean }
  | { type: 'clip:mark'; source: 'manual' | 'voice'; streamTimeSec?: number }
  | {
      type: 'room:update-meta';
      title?: string;
      category?: StreamCategory;
      slowModeSec?: number;
    }
  | { type: 'chat:send'; text: string; streamTimeSec?: number }
  | { type: 'chat:react'; messageId: string; label: string }
  | { type: 'chat:pin'; messageId: string | null }
  | { type: 'chat:delete'; messageId: string }
  | { type: 'webrtc:offer'; targetId: string; offer: RTCSessionDescriptionInit }
  | { type: 'webrtc:answer'; targetId: string; answer: RTCSessionDescriptionInit }
  | { type: 'webrtc:ice-candidate'; targetId: string; candidate: RTCIceCandidateInit }
  | { type: 'media:frame'; frame: string }
  | { type: 'media:audio'; pcm16: string; sampleRate: number };

/**
 * Strict discriminated union for Server -> Client WebSocket frames.
 */
export type ServerWsMessage =
  | { type: 'pong'; ts: number }
  | { type: 'room:joined'; selfId: string; state: RoomStatePayload }
  | { type: 'participant:joined'; participant: RoomParticipant }
  | { type: 'participant:updated'; participant: RoomParticipant }
  | { type: 'participant:left'; participantId: string }
  | { type: 'stream:status'; isLive: boolean; streamStartedAt: number | null }
  | { type: 'clip:marked'; marker: ClipMarkerEvent }
  | {
      type: 'room:meta-updated';
      title: string;
      category: StreamCategory;
      slowModeSec: number;
    }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:updated'; message: ChatMessage }
  | { type: 'chat:deleted'; messageId: string }
  | { type: 'chat:pinned'; pinnedMessage: ChatMessage | null }
  | { type: 'chat:rejected'; reason: string }
  | { type: 'webrtc:offer'; fromId: string; offer: RTCSessionDescriptionInit }
  | { type: 'webrtc:answer'; fromId: string; answer: RTCSessionDescriptionInit }
  | { type: 'webrtc:ice-candidate'; fromId: string; candidate: RTCIceCandidateInit }
  | { type: 'media:frame'; fromId: string; frame: string }
  | { type: 'media:audio'; fromId: string; pcm16: string; sampleRate: number }
  | { type: 'error'; reason: string };

/** Public creator metadata only. Never add shipping addresses or Shop tokens. */
export interface StreamerProfile {
  id: string;
  roomId: string;
  displayName: string;
  handle: string;
  bio: string;
  initials: string;
  hasShippingAddress: boolean;
  giftingEnabled: boolean;
  /** Exact product selections will be added after Shop catalog verification. */
  wishlist: { productId: string; variantId: string; shop: string }[];
}

export interface RoomStreamerResponse {
  streamer: StreamerProfile | null;
  canEdit: boolean;
}
