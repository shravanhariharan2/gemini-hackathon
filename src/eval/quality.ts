export interface EvalVideo { id: string; title: string; file: string; duration: number; sha256: string; split: 'dev' | 'test' }
export interface Reference { id: string; videoId: string; kind: 'moment' | 'negative'; start: number; end: number; peak?: number; title: string; notes: string; status: 'draft' | 'reviewed'; reviewer: string; origin: 'manual' | 'model-suggestion' }
export interface ReferenceSet { version: 1; references: Reference[]; coverage: Record<string, { complete: boolean; reviewer: string }> }
export interface Prediction { id: string; videoId: string; start: number; end: number; scores?: Record<string, number> }
export interface EvalRun { version: 1; id: string; createdAt: string; completedVideoIds: string[]; predictions: Prediction[]; sourceHashes: Record<string, string>; errors: { videoId: string; error: string }[]; provenance?: string; config?: unknown; usage?: { inputTokens: number; outputTokens: number } }
export const overlap = (a: {start: number; end: number}, b: {start: number; end: number}) => Math.max(0, Math.min(a.end,b.end)-Math.max(a.start,b.start));
export const iou = (a: {start: number; end: number}, b: {start: number; end: number}) => overlap(a,b)/(Math.max(a.end,b.end)-Math.min(a.start,b.start));
export function validateReferences(value: unknown, videos: EvalVideo[]): asserts value is ReferenceSet {
  const set=value as ReferenceSet;
  if (!set || set.version !== 1 || !Array.isArray(set.references) || set.references.length > 1000 || !set.coverage || typeof set.coverage !== 'object') throw new Error('Invalid reference set.');
  const ids=new Set<string>();
  for(const r of set.references){
    const video=videos.find(v=>v.id===r.videoId);
    if(!r || typeof r.id!=='string' || !r.id || ids.has(r.id) || !video || !['moment','negative'].includes(r.kind) || !['draft','reviewed'].includes(r.status) || !['manual','model-suggestion'].includes(r.origin)) throw new Error('Invalid or duplicate reference.');
    if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||r.end>video.duration) throw new Error('Reference bounds must be inside the source video.');
    if(r.kind==='moment'&&(!Number.isFinite(r.peak)||r.peak!<r.start||r.peak!>=r.end)) throw new Error('Mark a peak inside the reference cut.');
    if(typeof r.title!=='string'||r.title.length>200||typeof r.notes!=='string'||r.notes.length>2000||typeof r.reviewer!=='string'||r.reviewer.length>100||r.status==='reviewed'&&!r.reviewer.trim()) throw new Error('Reviewed references need a reviewer name.');
    ids.add(r.id);
  }
  for(const [videoId,c] of Object.entries(set.coverage)){
    if(!videos.some(v=>v.id===videoId)||!c||typeof c.complete!=='boolean'||typeof c.reviewer!=='string'||c.complete&&!c.reviewer.trim()) throw new Error('Complete coverage needs a reviewer.');
    if(c.complete&&set.references.some(r=>r.videoId===videoId&&r.status==='draft')) throw new Error('Review all drafts before declaring complete coverage.');
  }
  const reviewed=set.references.filter(r=>r.status==='reviewed');
  if(reviewed.some(a=>a.kind==='moment'&&reviewed.some(b=>b.videoId===a.videoId&&b.kind==='negative'&&a.peak!>=b.start&&a.peak!<=b.end))) throw new Error('A moment peak cannot also be labeled negative.');
}
export function scoreRun(run: EvalRun, references: ReferenceSet, videos: EvalVideo[]) {
  validateReferences(references,videos);
  const completed=new Set(run.completedVideoIds);
  if([...completed].some(id=>!videos.some(v=>v.id===id&&run.sourceHashes[id]===v.sha256))) throw new Error('Run source fingerprints differ from the eval dataset.');
  const predictions=run.predictions;
  const ids=new Set<string>();
  for(const p of predictions){const video=videos.find(v=>v.id===p.videoId);if(!video||!completed.has(p.videoId)||ids.has(p.id)||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<0||p.end<=p.start||p.end>video.duration+.1)throw new Error('Invalid prediction bounds, identity, or video.');ids.add(p.id);}
  const reviewed=references.references.filter(r=>r.status==='reviewed'&&completed.has(r.videoId));
  const moments=reviewed.filter(r=>r.kind==='moment');
  const negatives=reviewed.filter(r=>r.kind==='negative');
  // Maximum-cardinality, one-to-one event matching. Prefer larger temporal overlap
  // when exploring alternatives; a 60s clip cannot count as several distinct hits.
  const edges=moments.map(r=>predictions.map((p,i)=>({p,i})).filter(({p})=>p.videoId===r.videoId&&p.start<=r.peak!&&p.end>r.peak!).sort((a,b)=>iou(b.p,r)-iou(a.p,r)).map(x=>x.i));
  const assigned=new Map<number,number>();
  function match(ref:number,seen:Set<number>):boolean {for(const pred of edges[ref]){if(seen.has(pred))continue;seen.add(pred);const previous=assigned.get(pred);if(previous===undefined||match(previous,seen)){assigned.set(pred,ref);return true;}}return false;}
  moments.forEach((_,i)=>match(i,new Set()));
  const matches=[...assigned].map(([pi,ri])=>{const p=predictions[pi],r=moments[ri];return {predictionId:p.id,referenceId:r.id,videoId:p.videoId,iou:iou(p,r),startErrorSec:p.start-r.start,endErrorSec:p.end-r.end,extraSec:(p.end-p.start)-overlap(p,r),lengthRatio:(p.end-p.start)/(r.end-r.start),wellTrimmed:iou(p,r)>=.5&&Math.abs(p.start-r.start)<=5&&Math.abs(p.end-r.end)<=5};});
  const unmatched=predictions.filter((_,i)=>!assigned.has(i));
  const falsePositives=unmatched.filter(p=>references.coverage[p.videoId]?.complete||moments.some(r=>r.videoId===p.videoId&&p.start<=r.peak!&&p.end>r.peak!)||negatives.some(r=>r.videoId===p.videoId&&overlap(p,r)/(p.end-p.start)>=.5));
  const ignored=unmatched.filter(p=>!falsePositives.includes(p));
  const average=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return {runId:run.id,status:!reviewed.length&&!Object.entries(references.coverage).some(([id,c])=>completed.has(id)&&c.complete)?'needs-reference-labels':'scored',completedVideos:completed.size,failedVideos:run.errors.length,reviewedMoments:moments.length,draftReferences:references.references.filter(r=>completed.has(r.videoId)&&r.status==='draft').length,predictions:predictions.length,hits:matches.length,misses:moments.filter((_,i)=>![...assigned.values()].includes(i)).map(r=>r.id),falsePositives:falsePositives.map(p=>p.id),unscoredPredictions:ignored.map(p=>p.id),eventRecall:moments.length?matches.length/moments.length:null,precisionOnReviewedRegions:matches.length+falsePositives.length?matches.length/(matches.length+falsePositives.length):null,meanTrimIoU:average(matches.map(m=>m.iou)),meanBoundaryErrorSec:average(matches.map(m=>(Math.abs(m.startErrorSec)+Math.abs(m.endErrorSec))/2)),meanExtraSec:average(matches.map(m=>m.extraSec)),meanLengthRatio:average(matches.map(m=>m.lengthRatio)),wellTrimmedRecall:moments.length?matches.filter(m=>m.wellTrimmed).length/moments.length:null,matches};
}
