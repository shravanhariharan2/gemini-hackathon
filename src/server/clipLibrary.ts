import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { ClipError } from './clipDecisions';
import type { SavedClip } from '../shared/clipping';
const validOwner=(id:string)=>/^[a-f0-9]{64}$/.test(id);
const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export function clipOwner(req:Request,res:Response) {
  const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('clipthat_library='))?.slice('clipthat_library='.length);
  if(cookie&&validOwner(cookie))return cookie;
  const owner=crypto.randomBytes(32).toString('hex');
  res.cookie('clipthat_library',owner,{httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:365*24*60*60*1000,path:'/api/clips'});
  return owner;
}
export class ClipLibrary {
  private writes=new Map<string,Promise<unknown>>();
  constructor(private root=path.resolve(process.env.CLIP_DATA_DIR||'.data/clips'),private maxBytes=2*1024*1024*1024){}
  private directory(owner:string,id?:string){if(!validOwner(owner)||id!==undefined&&!validId(id))throw new ClipError('Clip not found.',404);return path.join(this.root,owner,...(id?[id]:[]));}
  async get(owner:string,id:string):Promise<SavedClip|null>{try{return JSON.parse(await readFile(path.join(this.directory(owner,id),'metadata.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  async list(owner:string){const dir=this.directory(owner);let names:string[];try{names=await readdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}const entries=await Promise.all(names.filter(validId).map(id=>this.get(owner,id)));return entries.filter((c):c is SavedClip=>!!c).sort((a,b)=>b.capturedAt-a.capturedAt||a.id.localeCompare(b.id));}
  mediaPath(owner:string,id:string){return path.join(this.directory(owner,id),'clip.webm');}
  async save(owner:string,metadata:Omit<SavedClip,'bytes'|'url'|'downloadUrl'>,media:Buffer):Promise<SavedClip>{
    // Serialize per-owner quota checks and atomic writes; media is never exposed before commit.
    const previous=this.writes.get(owner)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const existing=await this.get(owner,metadata.id);if(existing)return existing;
      const entries=await this.list(owner);if(entries.reduce((sum,c)=>sum+c.bytes,0)+media.length>this.maxBytes)throw new ClipError('My Clips storage is full. Download and delete clips to free space.',507);
      const parent=this.directory(owner);await mkdir(parent,{recursive:true,mode:0o700});
      const tmp=path.join(parent,`.pending-${crypto.randomUUID()}`);await mkdir(tmp,{mode:0o700});
      const clip:SavedClip={...metadata,bytes:media.length,url:`/api/clips/library/${metadata.id}/media`,downloadUrl:`/api/clips/library/${metadata.id}/media?download=1`};
      try{await writeFile(path.join(tmp,'clip.webm'),media,{mode:0o600});await writeFile(path.join(tmp,'metadata.json'),JSON.stringify(clip),{mode:0o600});await rename(tmp,this.directory(owner,metadata.id));return clip;}finally{await rm(tmp,{recursive:true,force:true});}
    });
    this.writes.set(owner,task);try{return await task;}finally{if(this.writes.get(owner)===task)this.writes.delete(owner);}
  }
  async remove(owner:string,id:string){const clip=await this.get(owner,id);if(!clip)throw new ClipError('Clip not found.',404);await rm(this.directory(owner,id),{recursive:true,force:true});}
}
