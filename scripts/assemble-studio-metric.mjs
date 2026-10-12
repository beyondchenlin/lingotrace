import { access, mkdir, readFile, readdir, cp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const baseline=process.argv[2]??'e94abb60f1e70e00681a41d1ec846b3106398450';
const reportPath=process.argv[3]??'docs/studio/cpm-public-preservation.json';
async function files(root,prefix=''){const result=[];for(const e of await readdir(root,{withFileTypes:true})){const p=prefix+e.name;if(e.isDirectory())result.push(...await files(root+'/'+e.name,p+'/'));else if(e.isFile())result.push(p);else throw Error('Unexpected publish-tree symlink')}return result}
const routes=['studio','portrait-preview'];
for(const route of routes)await access(`out/${route}/index.html`);
let rootEntry=null;
try{rootEntry=await readFile('public/index.html')}catch(e){if(e.code!=='ENOENT')throw e}
const protectedPaths=(await files('dist')).filter(p=>!(rootEntry&&p==='index.html')&&!routes.some(r=>p.startsWith(r+'/')));
const before=Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,hash(await readFile('dist/'+p))])));
const additions=[];
for(const p of await files('out/_next')){
 const next=await readFile('out/_next/'+p);let old;
 try{old=await readFile('dist/_next/'+p)}catch(e){if(e.code!=='ENOENT')throw e}
 if(old&&hash(old)!==hash(next))throw Error('Refusing to replace another route shared asset: '+p);
 if(!old)additions.push(p);
}
for(const p of await files('out/studio-assets'))if(hash(await readFile('out/studio-assets/'+p))!==hash(await readFile('dist/studio-assets/'+p)))throw Error('Unexpected media change: '+p);
for(const route of routes){await rm('dist/'+route,{recursive:true,force:true});await cp('out/'+route,'dist/'+route,{recursive:true})}
if(rootEntry)await writeFile('dist/index.html',rootEntry);
for(const p of additions){await mkdir('dist/_next/'+p.slice(0,p.lastIndexOf('/')),{recursive:true});await cp('out/_next/'+p,'dist/_next/'+p)}
for(const[p,digest]of Object.entries(before))if(hash(await readFile('dist/'+p))!==digest)throw Error('Protected route changed: '+p);
await writeFile(reportPath,JSON.stringify({baseline,updatedRoutes:rootEntry?['/',...routes]:routes,protectedFiles:before,newDependencies:additions},null,2));
console.log(JSON.stringify({updatedRoutes:rootEntry?['/',...routes]:routes,preservedFiles:protectedPaths.length,newDependencies:additions.length}));
