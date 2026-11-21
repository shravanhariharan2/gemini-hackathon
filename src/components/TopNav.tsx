import { Check, LogOut } from 'lucide-react';
import type { ParticipantRole } from '../utils/types';
import { AppHeader } from './AppHeader';

interface TopNavProps {
  isLive: boolean;
  selfRole: ParticipantRole;
  copiedInvite: boolean;
  showRoomSwitcher: boolean;
  onCopyInvite: () => void;
  onToggleRoomSwitcher: () => void;
  onToggleLive: () => void;
  onSwitchToStageRole: () => void;
  onLeaveRoom: () => void;
}

export function TopNav({
  isLive,
  selfRole,
  copiedInvite,
  showRoomSwitcher,
  onCopyInvite,
  onToggleRoomSwitcher,
  onToggleLive,
  onSwitchToStageRole,
  onLeaveRoom,
}: TopNavProps) {
  return (
    <AppHeader current="/">
      {/* Zone 2: Clean single-line room actions */}
      <nav aria-label="Studio actions" className="flex items-center gap-3.5 sm:gap-6 md:gap-7">
        <button
          type="button"
          onClick={onCopyInvite}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-950 transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded"
        >
          {copiedInvite && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />}
          <span>{copiedInvite ? 'Copied' : 'Copy Invite'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleRoomSwitcher}
          aria-expanded={showRoomSwitcher}
          className={`text-xs sm:text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded ${
            showRoomSwitcher ? 'text-slate-950 underline underline-offset-4' : 'text-slate-600 hover:text-slate-950'
          }`}
        >
          {showRoomSwitcher ? 'Close' : 'Switch Room'}
        </button>

        <button
          type="button"
          onClick={onLeaveRoom}
          aria-label="Leave stream room"
          className="inline-flex items-center gap-1 text-xs sm:text-sm font-medium text-slate-500 hover:text-rose-600 transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Leave</span>
        </button>
      </nav>

      {/* Zone 3: Single primary action CTA */}
      <div className="shrink-0">
        {selfRole === 'viewer' ? (
          <button
            type="button"
            onClick={onSwitchToStageRole}
            className="px-3 md:px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 bg-slate-950 hover:bg-slate-800 text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            Join Stage
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleLive}
            className={`px-3 md:px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              isLive
                ? 'bg-slate-950 text-white hover:bg-slate-800 focus-visible:ring-slate-900'
                : 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500'
            }`}
          >
            {isLive ? 'End Stream' : 'Go Live'}
          </button>
        )}
      </div>
    </AppHeader>
  );
}
