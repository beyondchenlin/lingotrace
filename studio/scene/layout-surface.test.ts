import test from 'node:test';import assert from 'node:assert/strict';
import{layoutSurfaceStyle,layoutSurfaceDelta}from'./layout-surface';
import{responsiveLayout}from'./responsive-layout';import{applyInputCardLayout}from'./input-card';
import{constrainRect}from'./transparent-layout';import{constrainPortraitRect}from'./responsive-editor';
for(const portrait of[false,true])for(const visible of[false,true])for(const scale of[.414,.6927,1])test(`editor roundtrip uses displayed surface without changing saved constraints ${portrait}/${visible}/${scale}`,()=>{
 const base=responsiveLayout(portrait,{},'lesson',820),shown=applyInputCardLayout(base,{keyboardVisible:visible,cssScale:scale});
 const r={...base.inset},saved=JSON.stringify(r),style=layoutSurfaceStyle(r,shown.width,shown.height),cssW=shown.width*scale,cssH=shown.height*scale;
 assert.ok(Math.abs(parseFloat(style.top)/100*cssH-r.y*scale)<1e-6);assert.ok(Math.abs(parseFloat(style.height)/100*cssH-r.h*scale)<1e-6);
 const delta=layoutSurfaceDelta(37,100,cssW,cssH,shown.width,shown.height);assert.ok(Math.abs(delta.dx*scale-37)<1e-9);assert.ok(Math.abs(delta.dy*scale-100)<1e-9);
 const clamped=portrait?constrainPortraitRect('inset',{...r,y:10000},820):constrainRect('inset',{...r,y:10000});
 const original=portrait?constrainPortraitRect('inset',{...r,y:10000},820):constrainRect('inset',{...r,y:10000});assert.deepEqual(clamped,original);assert.equal(JSON.stringify(r),saved);
});
