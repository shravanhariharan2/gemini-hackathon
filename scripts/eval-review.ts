import express from 'express';
import path from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { scoreRun, validateReferences, type EvalVideo, type ReferenceSet, type EvalRun } from '../src/eval/quality';
const root=path.resolve(import.meta.dirname,'..');
const referenceFile=path.join(root,'evals/references.json');
const videos:EvalVideo[]=JSON.parse(await readFile(path.join(root,'evals/dataset.json'),'utf8')).videos;
const runFile=path.resolve(process.argv[2]||path.join(root,'evals/baselines/wimbledon-initial.json'));
const revision=(text:string)=>createHash('sha256').update(text).digest('hex');
const app=express();let saving=false;
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');const origin=req.get('origin');if(origin){try{if(new URL(origin).host!==req.get('host')){res.status(403).json({error:'Use the local reference editor.'});return;}}catch{res.status(403).json({error:'Invalid origin.'});return;}}next();});
app.use(express.json({limit:'512kb'}));
app.get('/api/state',async(_req,res)=>{try{const text=await readFile(referenceFile,'utf8');const references:ReferenceSet=JSON.parse(text);const run:EvalRun=JSON.parse(await readFile(runFile,'utf8'));res.json({videos,references,revision:revision(text),run,score:scoreRun(run,references,videos)});}catch(error){res.status(500).json({error:(error as Error).message});}});
app.post('/api/references',async(req,res)=>{
 if(saving){res.status(409).json({error:'Another save is in progress. Reload before saving.'});return;}saving=true;
 try{const text=await readFile(referenceFile,'utf8');if(req.body.revision!==revision(text)){res.status(409).json({error:'References changed. Reload the page before saving.'});return;}validateReferences(req.body.references,videos);const next=JSON.stringify(req.body.references,null,2)+'\n';await writeFile(referenceFile+'.tmp',next);await rename(referenceFile+'.tmp',referenceFile);res.json({revision:revision(next)});}catch(error){res.status(400).json({error:(error as Error).message});}finally{saving=false;}
});
app.get('/media/:id',(req,res)=>{const video=videos.find(v=>v.id===req.params.id);if(!video){res.sendStatus(404);return;}const file=path.resolve(root,video.file);if(!file.startsWith(root+path.sep)){res.sendStatus(403);return;}res.sendFile(file);});
app.get('/',(_req,res)=>res.sendFile(path.join(root,'evals/ui/index.html')));
app.listen(3002,'127.0.0.1',()=>console.log('Eval reference editor: http://127.0.0.1:3002 (local edits only; no Gemini calls)'));
