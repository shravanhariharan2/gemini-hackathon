import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AutoClipper } from '../src/components/AutoClipper';
import { useAutoClipper } from '../src/hooks/useAutoClipper';
import '../src/index.css';
import type { ChatMessage, RoomParticipant } from '../src/utils/types';
const noGuests = {};
const noParticipants: RoomParticipant[] = [];
const noMessages: ChatMessage[] = [];
function Harness() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const canvas = document.createElement('canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d')!;
    const timer=setInterval(()=>{ctx.fillStyle='#0f172a';ctx.fillRect(0,0,640,360);ctx.fillStyle='#fb7185';ctx.fillRect(Date.now()/10%540,100,100,100);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('Generated recording test',30,45)},50);
    const media=canvas.captureStream(20);setStream(media);
    return()=>{clearInterval(timer);media.getTracks().forEach(t=>t.stop())};
  },[]);
  const clipper = useAutoClipper({ active: live, roomId: 'generated-test', localStream: stream, remoteStreams: noGuests, participants: noParticipants, selfName: 'Generated test', messages: noMessages });
  return <><div style={{padding:32}}><h1 style={{fontSize:28}}>Auto-clipper pipeline check</h1><p style={{margin:'16px 0'}}>Generated video only. Probes and flushes use your real Gemini key and return real scores.</p><button style={{padding:12,border:'1px solid #cbd5e1'}} onClick={()=>setLive(v=>!v)}>{live?'Stop test recording':'Start test recording'}</button></div><AutoClipper clipper={clipper} enabled={live}/></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
