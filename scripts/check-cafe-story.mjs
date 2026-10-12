import assert from 'node:assert/strict';
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import vm from 'node:vm';
const root=resolve('dist/story/cafe'),manifest=JSON.parse(await readFile('docs/story/cafe-publish-manifest.json','utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const expected=new Map(manifest.files.map(file=>[file.path,file]));assert.equal(expected.size,19);
async function walk(dir){const result=[];for(const name of await readdir(dir)){const p=resolve(dir,name),s=await lstat(p);assert.ok(!s.isSymbolicLink(),'No symbolic links in the public package');if(s.isDirectory())result.push(...await walk(p));else{assert.ok(s.isFile());result.push(relative(root,p).split(sep).join('/'))}}return result}
assert.deepEqual((await walk(root)).sort(),[...expected.keys()].sort());
for(const[key,item]of expected){assert.ok(!key.startsWith('/')&&!key.split('/').includes('..')&&!key.includes('\\'));const p=await realpath(resolve(root,key));assert.ok(p.startsWith(root+sep));const bytes=await readFile(p);assert.equal(bytes.length,item.bytes,key);assert.equal(sha(bytes),item.sha256,key)}
const html=await readFile(resolve(root,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){const url=new URL(match[1],'https://example.invalid/story/cafe/');assert.equal(url.origin,'https://example.invalid');assert.ok(url.pathname.startsWith('/story/cafe/'));assert.ok(expected.has(decodeURIComponent(url.pathname.slice('/story/cafe/'.length))),match[1])}
const context=vm.createContext({});for(const file of['camera.js','story-data.js','scene-camera.js']){vm.runInContext(await readFile(resolve(root,file),'utf8'),context,{filename:file,timeout:1000})}
const data=JSON.parse(await readFile(resolve(root,'story-data.json'),'utf8'));assert.deepEqual(JSON.parse(JSON.stringify(context.STORY)),data);assert.equal(data.scenes.length,8);assert.equal(data.scenes.reduce((n,s)=>n+s.dialogue.length,0),24);assert.ok(data.scenes.every(s=>s.exercise.answer));
const assets=context.SceneCamera.assets;for(const path of Object.values(assets))assert.ok(expected.has(path),path);
const reached=new Set();for(let scene=0;scene<8;scene++)for(let n=0;n<=100;n++){for(const layer of context.SceneCamera.frame(scene,n/100).layers){assert.ok(assets[layer.id],layer.id);reached.add(layer.id)}}
for(let tick=0;tick<=440;tick++){for(const layer of context.SceneCamera.demo(tick/10).frame.layers)assert.ok(assets[layer.id],layer.id)}
for(const file of['index.html','app.js','camera.js','scene-camera.js','story-data.js']){const code=await readFile(resolve(root,file),'utf8');assert.ok(!/https?:\/\/|\/workspace\/|\/tmp\/|localStorage|indexedDB|sessionStorage|XMLHttpRequest|WebSocket|navigator\.sendBeacon|fetch\s*\(/.test(code),`${file}: unexpected external API, private path or persistence`)}
const baseline=JSON.parse(await readFile('docs/story/studio-v27-preservation.json','utf8'));for(const[path,hash]of Object.entries(baseline.files))assert.equal(sha(await readFile(path)),hash,`Studio changed: ${path}`);
console.log(JSON.stringify({status:'pass',publicFiles:expected.size,storySchema:data.schemaVersion,scenes:8,dialogueUnits:24,exercises:8,activeAssets:Object.keys(assets).length,reachableLayers:[...reached],preservedStudioFiles:Object.keys(baseline.files).length,browser:'not tested by this static check'}));
