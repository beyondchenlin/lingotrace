import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), swc = require('next/dist/build/swc');
const root = new URL('../../', import.meta.url);
async function route(file: string) {
  const source = await readFile(new URL(file, root), 'utf8');
  const exports = {}, marker = function Studio() {};
  await swc.loadBindings();
  const { code } = await swc.transform(source, { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' } });
  const context = vm.createContext({ exports, require: (name: string) => name === '@/studio/components/Studio' ? { default: marker, __esModule: true } : name.endsWith('.css') ? {} : require(name) });
  vm.runInContext(code, context);
  return { element: (exports as { default: () => { type: unknown; props: { responsive: boolean } } }).default(), marker };
}
test('formal and retained portrait routes instantiate the same responsive controller', async () => {
  for (const file of ['app/studio/page.tsx', 'app/portrait-preview/page.tsx']) {
    const { element, marker } = await route(file);
    assert.equal(element.type, marker); assert.equal(element.props.responsive, true, file);
  }
});
test('root entry replaces navigation with the same-origin formal route and preserves query/hash', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  assert.ok(html.includes('content="0;url=/studio/"'));
  assert.ok(html.includes('href="/studio/"'));
  assert.ok(html.includes('href="/demo/01-fitness-flow/"'));
  assert.ok(!html.includes('/hud/ui.js'));
  for (const [search, hash] of [['',''], ['?layout=auto','#training'], ['?next=https://example.invalid','#/elsewhere']]) {
    let target='';
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], { location: { search, hash, replace: (value: string) => { target=value; } } });
    assert.equal(target, `/studio/${search}${hash}`);
  }
});
test('bounded assembler changes only root/training routes and preserves archived routes plus old shared assets', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'lingotrace-route-'));
  const put=async(path:string,value:string)=>{await mkdir(join(folder,path,'..'),{recursive:true});await writeFile(join(folder,path),value);};
  try {
    for(const [path,value] of Object.entries({'dist/index.html':'oldroot','dist/story/cafe/index.html':'story','dist/demo/01-fitness-flow/index.html':'archive','dist/hud-library/index.html':'gallery','dist/_next/old.js':'retained','dist/studio-assets/test.jpg':'media','dist/studio/index.html':'oldstudio','dist/portrait-preview/index.html':'oldportrait','out/studio/index.html':'newstudio','out/portrait-preview/index.html':'newportrait','out/_next/new.js':'newchunk','out/studio-assets/test.jpg':'media','public/index.html':'newentry'}))await put(path,value);
    execFileSync(process.execPath,[new URL('scripts/assemble-studio-metric.mjs',root).pathname,'v44','preservation.json'],{cwd:folder});
    for(const [path,value]of Object.entries({'index.html':'newentry','studio/index.html':'newstudio','portrait-preview/index.html':'newportrait','story/cafe/index.html':'story','demo/01-fitness-flow/index.html':'archive','hud-library/index.html':'gallery','_next/old.js':'retained','_next/new.js':'newchunk'}))assert.equal(await readFile(join(folder,'dist',path),'utf8'),value,path);
    const report=JSON.parse(await readFile(join(folder,'preservation.json'),'utf8'));
    assert.deepEqual(report.updatedRoutes,['/','studio','portrait-preview']);assert.ok(!('index.html'in report.protectedFiles));assert.ok(report.protectedFiles['story/cafe/index.html']);
  }finally{await rm(folder,{recursive:true,force:true});}
});
