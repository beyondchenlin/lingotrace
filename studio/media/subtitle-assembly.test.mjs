import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const script=new URL('../../scripts/assemble-site.mjs',import.meta.url);
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'c1-assembly-'));
 const save=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text)};
 try{
  await cp(script,join(root,'assemble.mjs'));
  for(const part of ['studio','portrait-preview','media-transport-check','studio-assets','subtitle-workbench'])await save(`out/${part}/index.html`,`new ${part}`);
  await save('out/_next/static/new.js','new asset');
  await save('dist/_next/static/retained.js','prior immutable asset');
  await save('dist/demo/index.html','archived demo');
  await fn({root,save,run:()=>execFileSync(process.execPath,['assemble.mjs'],{cwd:root,stdio:'pipe'})});
 }finally{await rm(root,{recursive:true,force:true})}
}
test('C1 assembler preserves old immutable URLs and archived routes while adding new build',()=>fixture(async({root,run})=>{
 run();run();
 assert.equal(await readFile(join(root,'dist/_next/static/retained.js'),'utf8'),'prior immutable asset');
 assert.equal(await readFile(join(root,'dist/_next/static/new.js'),'utf8'),'new asset');
 assert.equal(await readFile(join(root,'dist/demo/index.html'),'utf8'),'archived demo');
 assert.equal(await readFile(join(root,'dist/subtitle-workbench/index.html'),'utf8'),'new subtitle-workbench');
}));
test('C1 assembler rejects immutable path collisions before replacing old pages',()=>fixture(async({root,save,run})=>{
 await save('out/_next/static/retained.js','different bytes');await save('dist/studio/index.html','old page');
 assert.throws(run,error=>String(error.stderr).includes('Immutable asset collision'));
 assert.equal(await readFile(join(root,'dist/_next/static/retained.js'),'utf8'),'prior immutable asset');
 assert.equal(await readFile(join(root,'dist/studio/index.html'),'utf8'),'old page');
}));
