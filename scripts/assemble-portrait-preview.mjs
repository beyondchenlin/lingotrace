import{access,mkdir,readFile,readdir,cp,rm,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function files(root,prefix=''){let result=[];for(const item of await readdir(root,{withFileTypes:true})){const name=prefix+item.name;if(item.isDirectory())result.push(...await files(root+'/'+item.name,name+'/'));else if(item.isFile())result.push(name);else throw Error('Unexpected symlink in publish tree')}return result}
await access('out/portrait-preview/index.html');
const protectedPaths=(await files('dist')).filter(p=>!p.startsWith('portrait-preview/'));
const before=Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,hash(await readFile('dist/'+p))])));
const dependencyPaths=(await files('out/_next')).filter(p=>!p.startsWith('static/chunks/app/studio/'));
const additions=[];
for(const p of dependencyPaths){const source=await readFile('out/_next/'+p);let old;try{old=await readFile('dist/_next/'+p)}catch(e){if(e.code!=='ENOENT')throw e}if(old&&hash(old)!==hash(source))throw Error('Refusing to replace existing shared asset: '+p);if(!old)additions.push(p)}
await rm('dist/portrait-preview',{recursive:true,force:true});await cp('out/portrait-preview','dist/portrait-preview',{recursive:true});
for(const p of additions){const parent=p.slice(0,p.lastIndexOf('/'));await mkdir('dist/_next/'+parent,{recursive:true});await cp('out/_next/'+p,'dist/_next/'+p)}
for(const[p,digest]of Object.entries(before))if(hash(await readFile('dist/'+p))!==digest)throw Error('Existing route changed: '+p);
await mkdir('docs/studio',{recursive:true});await writeFile('docs/studio/responsive-public-preservation.json',JSON.stringify({baseline:'aa8c65b41ec17a95de48c51546e308dd4b380912',protectedFiles:before,newDependencyFiles:additions.map(p=>'_next/'+p),routeFiles:await files('dist/portrait-preview')},null,2));
console.log(JSON.stringify({preservedExistingFiles:protectedPaths.length,newDependencies:additions.length,route:'/portrait-preview/'}));
