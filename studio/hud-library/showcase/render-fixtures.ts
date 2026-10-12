/** Program rendering only. These images are not browser or recording acceptance. */
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {renderHudScene} from '../renderer.ts';
import {COMPONENT_TYPES,FIXTURE_CLOCK,fixtureScene} from './fixtures.ts';
for(const suffix of ['Regular','Bold']) {
  GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationSans-${suffix}.ttf`,'Arial');
  GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationMono-${suffix}.ttf`,'Courier New');
}
const dir=process.argv[2]??'/tmp/lingotrace-hud-v01';await mkdir(dir,{recursive:true});
const sheet=createCanvas(1060,750),c=sheet.getContext('2d');c.fillStyle='#101b1d';c.fillRect(0,0,1060,750);
c.fillStyle='#edf4f1';c.font='24px Arial';c.fillText('LingoTrace / Display instruments',36,47);
c.fillStyle='#93a6a6';c.font='12px Arial';c.fillText('v0.1 · Independent components · FIXTURE DATA · PROGRAM RENDER, not browser QA',36,73);
for(const [i,type] of COMPONENT_TYPES.entries()){
  const canvas=createCanvas(480,270);renderHudScene(canvas.getContext('2d') as unknown as CanvasRenderingContext2D,fixtureScene(type),FIXTURE_CLOCK);
  await writeFile(join(dir,`${type}-transparent.png`),canvas.toBuffer('image/png'));
  const x=30+(i%2)*520,y=112+Math.floor(i/2)*310;c.drawImage(canvas,x,y);
  c.fillStyle='#506767';c.font='10px Courier New';c.fillText(`${String(i+1).padStart(2,'0')} / ${type}`,x+18,y+290);
}
await writeFile(join(dir,'hud-components-v01-program-render.png'),sheet.toBuffer('image/png'));
console.log(dir);
