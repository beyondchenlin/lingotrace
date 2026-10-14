import {cp,mkdir,rm,access,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
await access('out/studio/index.html');
await access('out/portrait-preview/index.html');
await access('out/media-transport-check/index.html');
try{await access('out/cards/index.html')}catch(e){if(e.code!=='ENOENT')throw e}
await mkdir('dist',{recursive:true});
// Keep content-addressed resources referenced by earlier immutable releases.
// Refuse a same-path/different-byte collision rather than breaking an old URL.
async function verifyImmutableCopy(source,destination){
 for(const entry of await readdir(source,{withFileTypes:true})){
  const from=join(source,entry.name),to=join(destination,entry.name);
  if(entry.isDirectory()){await verifyImmutableCopy(from,to);continue;}
  let existing;try{existing=await readFile(to)}catch(error){if(error.code==='ENOENT')continue;throw error}
  if(!existing.equals(await readFile(from)))throw Error(`Immutable asset collision: ${to}`);
 }
}
await verifyImmutableCopy('out/_next','dist/_next');
await cp('out/_next','dist/_next',{recursive:true});
for(const part of ['studio','portrait-preview','media-transport-check','cards','studio-assets','subtitle-workbench']){try{await rm(`dist/${part}`,{recursive:true,force:true});await cp(`out/${part}`,`dist/${part}`,{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}}
try{await cp('public/index.html','dist/index.html')}catch(e){if(e.code!=='ENOENT')throw e}
console.log('Studio export merged. Immutable Next assets and archived /demo routes retained; authored root applied when present.');
