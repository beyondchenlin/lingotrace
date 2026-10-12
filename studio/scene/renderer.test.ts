import test from 'node:test';import assert from 'node:assert/strict';import {containRect} from './renderer.ts';
test('contain fits landscape portrait and square without cropping or distortion',()=>{for(const [w,h]of [[1920,1080],[1080,1920],[1000,1000]]){const r=containRect(w,h,0,0,1672,941);assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=1672+.001&&r.y+r.h<=941+.001);assert.ok(Math.abs(r.w/r.h-w/h)<.00001)}});
import {PHOTO_PATCHES} from './renderer.ts';
test('reference photograph patches contain zero baked interface pixels',()=>{const masks=[[0,0,1672,90],[1377,45,276,220],[453,521,768,77],[28,610,1616,137],[0,753,1672,188]];for(const [x,y,w,h]of PHOTO_PATCHES)for(const [mx,my,mw,mh]of masks){const area=Math.max(0,Math.min(x+w,mx+mw)-Math.max(x,mx))*Math.max(0,Math.min(y+h,my+mh)-Math.max(y,my));assert.equal(area,0)}});

import {CAMERA_PHOTO_PATCHES}from'./renderer.ts';
test('reference camera reconstruction excludes baked REC dot/text pixels',()=>{const mask=[1390,232,117,24];for(const[x,y,w,h]of[...CAMERA_PHOTO_PATCHES,[1390,208,117,24]]){const[mx,my,mw,mh]=mask;assert.equal(Math.max(0,Math.min(x+w,mx+mw)-Math.max(x,mx))*Math.max(0,Math.min(y+h,my+mh)-Math.max(y,my)),0)}});
