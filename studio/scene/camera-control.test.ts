import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraControlGeometry} from './camera-control';
import {responsiveLayout} from './responsive-layout';
import {parseArrangement} from './transparent-layout';
const overlap=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
for(const portrait of [false,true])for(const cssWidth of [280,320,375,430,500,768,1180,1920])for(const camera of ['off','requesting','error']as const){
 test(`compact ${camera} ${portrait?'portrait':'landscape'} width${cssWidth} is32px visible and44px hittable without moving input`,()=>{
  const g=responsiveLayout(portrait,{},'lesson',820),before=JSON.stringify(g),cssHeight=cssWidth*g.height/g.width;
  const r=cameraControlGeometry(g,camera,'lesson',{cssWidth,cssHeight});assert.ok(r.compact);
  assert.ok(Math.abs(r.hit.w*cssWidth/g.width-44)<1e-8);assert.ok(Math.abs(r.hit.h*cssHeight/g.height-44)<1e-8);
  assert.ok(Math.abs(r.visual.w*cssWidth/g.width-32)<1e-8);assert.ok(!overlap(r.hit,g.zones.input));assert.ok(!overlap(r.hit,g.zones.submit));assert.ok(!overlap(r.hit,g.zones.seek));assert.ok(!overlap(r.hit,g.title));
  assert.ok(r.hit.x>=0&&r.hit.x+r.hit.w<=g.width+1e-8);assert.ok(r.hit.y>=0&&r.hit.y+r.hit.h<=g.height+1e-8);
  assert.equal(JSON.stringify(g),before);
 });
}
for(const portrait of [false,true])for(const layout of ['lesson','camera','split']as const)for(const camera of ['off','requesting','error','on']as const){
 test(`original ${layout}/${camera}/${portrait} enabled or non-camera inset is retained`,()=>{
  const a=portrait?{inset:{x:25,y:220,w:180,h:114}}:parseArrangement({inset:{x:900,y:400,w:300,h:190}}),copy=JSON.stringify(a),g=responsiveLayout(portrait,a,layout);
  const r=cameraControlGeometry(g,camera,layout,{cssWidth:500,cssHeight:500*g.height/g.width});
  if(camera==='on'||layout!=='lesson'){assert.equal(r.compact,false);assert.deepEqual(r.visual,g.inset);assert.deepEqual(r.hit,g.inset)}
  const legacy=cameraControlGeometry(g,camera,layout,{fixture:true});assert.equal(legacy.compact,false);assert.deepEqual(legacy.hit,g.inset);assert.equal(JSON.stringify(a),copy);
 });
}
test('pathological valid saved inset stays unchanged while expanded OFF target clears title and input',()=>{
 for(const portrait of [false,true])for(const inset of [{x:0,y:0,w:240,h:152},{x:1600,y:700,w:240,h:152},{x:10,y:700,w:300,h:190}]){
  const a={inset},g=responsiveLayout(portrait,a,'lesson',820),before=JSON.stringify(a),r=cameraControlGeometry(g,'off','lesson',{cssWidth:320,cssHeight:320*g.height/g.width});
  assert.ok(!overlap(r.hit,g.title));assert.ok(!overlap(r.hit,g.zones.input));assert.ok(!overlap(r.hit,g.zones.submit));assert.equal(JSON.stringify(a),before);
 }
});
