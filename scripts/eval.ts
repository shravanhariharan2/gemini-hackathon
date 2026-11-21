import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { scoreRun, type EvalRun, type EvalVideo, type ReferenceSet } from '../src/eval/quality';
import { parseEvalConfig } from '../src/eval/config';
const args=process.argv.slice(2), command=args[0]||'score';
const arg=(key:string,fallback?:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const root=path.resolve(import.meta.dirname,'..');
const videos:EvalVideo[]=JSON.parse(await readFile(path.join(root,'evals/dataset.json'),'utf8')).videos;
const refs:ReferenceSet=JSON.parse(await readFile(path.resolve(arg('--references',path.join(root,'evals/references.json'))!),'utf8'));
const baseline=path.join(root,'evals/baselines/wimbledon-initial.json');
const out=path.resolve(arg('--output',path.join(root,'.data/evals',command==='run'?new Date().toISOString().replace(/[:.]/g,'-'):'latest'))!);
if(command==='run'&&existsSync(path.join(out,'run.json')))throw new Error('Run output already exists. Choose a new --output directory to preserve the previous run.');
await mkdir(out,{recursive:true});
const saveScore=async(run:EvalRun,name='score.json')=>{const score=scoreRun(run,refs,videos);await writeFile(path.join(out,name),JSON.stringify({ ...score,scoredAt:new Date().toISOString(),referenceHash:createHash('sha256').update(JSON.stringify(refs)).digest('hex'),references:refs },null,2));return score;};
if(command==='score'){
 const run:EvalRun=JSON.parse(await readFile(path.resolve(arg('--run',baseline)!),'utf8'));
 console.log(JSON.stringify(await saveScore(run),null,2));
}else if(command==='compare'){
 const before=arg('--before'),after=arg('--after');if(!before||!after)throw new Error('Compare needs --before <run.json> and --after <run.json>.');
 const a=await saveScore(JSON.parse(await readFile(before,'utf8')),'before.json');const b=await saveScore(JSON.parse(await readFile(after,'utf8')),'after.json');
 if(a.completedVideos!==b.completedVideos)throw new Error('Compare runs over the same videos.');
 const ra:EvalRun=JSON.parse(await readFile(before,'utf8')),rb:EvalRun=JSON.parse(await readFile(after,'utf8'));
 if(JSON.stringify([...ra.completedVideoIds].sort())!==JSON.stringify([...rb.completedVideoIds].sort()))throw new Error('Compare runs over the same videos.');
 const metrics=['eventRecall','precisionOnReviewedRegions','meanTrimIoU','meanBoundaryErrorSec','meanExtraSec','wellTrimmedRecall'] as const;
 const delta=Object.fromEntries(metrics.map(k=>[k,a[k]===null||b[k]===null?null:b[k]!-a[k]!]));
 const comparison={before:a,after:b,delta};await writeFile(path.join(out,'comparison.json'),JSON.stringify(comparison,null,2));console.log(JSON.stringify(comparison,null,2));
}else if(command==='run'){
 const selected=videos.filter(v=>arg('--split') ? v.split===arg('--split') : args.includes('--all')||v.id===arg('--video','wimbledon'));
 if(!selected.length)throw new Error('Unknown video ID.');
 const config=parseEvalConfig(JSON.parse(await readFile(path.resolve(arg('--config',path.join(root,'evals/config.json'))!),'utf8')));
 const run:EvalRun={version:1,id:path.basename(out),createdAt:new Date().toISOString(),completedVideoIds:[],predictions:[],sourceHashes:{},errors:[],config,usage:{inputTokens:0,outputTokens:0}};
 const configFile=path.join(out,'config.json');await writeFile(configFile,JSON.stringify(config,null,2));
 const runFile=path.join(out,'run.json');
 // Persist the exact labels used to score this run. They never enter model prompts.
 await writeFile(path.join(out,'references.snapshot.json'),JSON.stringify(refs,null,2));
 for(const video of selected){
  try{
   const source=path.resolve(root,video.file);const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);
   if(hash.digest('hex')!==video.sha256)throw new Error('Source fingerprint changed. Update the dataset intentionally before running.');
   const videoOut=path.join(out,video.id);console.log(`Evaluating ${video.id} using real Gemini calls…`);
   await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',path.join(root,'scripts/clip-video.ts'),source,videoOut,'--config',configFile,'--no-media'],{cwd:root,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Video runner exited ${code}`)));});
   const result=JSON.parse(await readFile(path.join(videoOut,'results.json'),'utf8'));
   run.predictions.push(...result.candidates.filter((c:{approved:boolean})=>c.approved).map((c:{id:number;start:number;end:number;scores:Record<string,number>})=>({id:`${video.id}-${c.id}`,videoId:video.id,start:c.start,end:c.end,scores:c.scores})));
   run.completedVideoIds.push(video.id);run.sourceHashes[video.id]=video.sha256;run.usage!.inputTokens+=result.usage.inputTokens;run.usage!.outputTokens+=result.usage.outputTokens;
  }catch(error){run.errors.push({videoId:video.id,error:(error as Error).message});console.error(`${video.id}: ${(error as Error).message}`);}
  await writeFile(runFile,JSON.stringify(run,null,2));
 }
 console.log(JSON.stringify(await saveScore(run),null,2));console.log(`Saved ${runFile}`);if(run.errors.length)process.exitCode=1;
}else throw new Error('Use run, score, or compare.');
