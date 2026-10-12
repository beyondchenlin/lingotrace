import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {startSceneFrameLoop,resetSceneContext,sceneRenderFailureCode} from './frame-loop';

function rig(draw:()=>void,recover=()=>{}){
 let id=0;const queued=new Map<number,FrameRequestCallback>(),errors:{error:unknown;terminal:boolean}[]=[];let recovered=0;
 const loop=startSceneFrameLoop(draw,{request:callback=>{queued.set(++id,callback);return id},cancel:id=>{queued.delete(id)},recover,onError:(error,terminal)=>errors.push({error,terminal}),onRecovered:()=>{recovered++}});
 return{loop,errors,queued,get recovered(){return recovered},step(){const entry=queued.entries().next().value;assert.ok(entry,'one scheduled frame');queued.delete(entry[0]);entry[1](id*16)}};
}
test('a transient draw exception gets exactly one automatic fresh-context retry and resumes',()=>{
 let calls=0,resets=0;const draft={text:'hello\nLong restored draft',selection:[2,5],scroll:80},before=JSON.stringify(draft),r=rig(()=>{if(++calls===1)throw Error('injected native projection error')},()=>{resets++});
 r.step();assert.equal(r.errors.length,1);assert.equal(r.errors[0].terminal,false);assert.equal(resets,1);assert.equal(r.queued.size,1);
 r.step();assert.equal(r.recovered,1);assert.equal(r.queued.size,1);assert.equal(JSON.stringify(draft),before);r.loop.dispose();assert.equal(r.queued.size,0);
});
test('persistent draw exception stops after two frames, exposes failure, and resumes only after retry',()=>{
 let fail=true,calls=0;const r=rig(()=>{calls++;if(fail)throw Error('injected permanent error')});r.step();r.step();
 assert.equal(calls,2);assert.deepEqual(r.errors.map(x=>x.terminal),[false,true]);assert.equal(r.queued.size,0);
 fail=false;r.loop.retry();r.loop.retry();assert.equal(r.queued.size,1);r.step();assert.equal(r.recovered,1);r.loop.dispose();r.loop.retry();assert.equal(r.queued.size,0);
});
test('context reset failure is terminal and never creates an unbounded retry loop',()=>{
 const r=rig(()=>{throw Error('paint')},()=>{throw Error('reset')});r.step();assert.equal(r.errors.at(-1)!.terminal,true);assert.equal(r.queued.size,0);r.loop.retry();assert.equal(r.queued.size,0);r.loop.dispose();
});
test('reset discards the entire nested save, transform and clip stack after a painter throws',()=>{
 const canvas=createCanvas(16,16),ctx=canvas.getContext('2d');
 ctx.save();ctx.translate(9,9);ctx.save();ctx.beginPath();ctx.rect(0,0,1,1);ctx.clip();ctx.globalAlpha=.1;
 resetSceneContext(canvas as unknown as HTMLCanvasElement);
 ctx.restore();ctx.restore();assert.equal(ctx.getTransform().a,1);assert.equal(ctx.getTransform().e,0);assert.equal(ctx.globalAlpha,1);
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,16,16);assert.deepEqual([...ctx.getImageData(15,15,1,1).data],[255,255,255,255]);
});

test('failure code contains only an owned phase and allowlisted exception name',()=>{
 assert.equal(sceneRenderFailureCode(new DOMException('private draft /secret/file https://private.example','IndexSizeError'),'native-input'),'native-input / IndexSizeError');
 assert.equal(sceneRenderFailureCode({name:'private draft',message:'secret',stack:'secret'},'https://private.example'),'unknown / Error');
 assert.equal(sceneRenderFailureCode('secret draft','scene-paint'),'scene-paint / Error');
 assert.equal(sceneRenderFailureCode({get name(){throw Error('private')}},'snapshot'),'snapshot / Error');
});
test('a failed context reset reports its own actual exception instead of the original draw error',()=>{
 const original=new RangeError('draw'),reset=new TypeError('reset'),r=rig(()=>{throw original},()=>{throw reset});r.step();
 assert.equal(r.errors[0].error,original);assert.equal(r.errors[1].error,reset);assert.equal(r.errors[1].terminal,true);assert.equal(r.queued.size,0);
});
