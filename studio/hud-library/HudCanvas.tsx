'use client';
import { useLayoutEffect, useRef } from 'react';
import type { HudScene, RenderClock } from './schema.ts';
import { renderHudScene } from './renderer.ts';
/** React owns only the canvas element. The host must supply its explicit clock. */
export function HudCanvas({scene,clock,pixelRatio=1,className}:{scene:HudScene;clock:RenderClock;pixelRatio?:number;className?:string}) {
  const ref=useRef<HTMLCanvasElement>(null);
  useLayoutEffect(()=>{
    if(!Number.isFinite(pixelRatio)||pixelRatio<=0||pixelRatio>4)throw new RangeError('pixelRatio must be within (0,4]');
    const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    canvas.width=Math.round(scene.size.width*pixelRatio);canvas.height=Math.round(scene.size.height*pixelRatio);
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    const rendered=renderHudScene(ctx,scene,clock,{clear:true});
    canvas.setAttribute('aria-label',rendered.map(n=>n.accessibleText).join(' '));
  },[scene,clock,pixelRatio]);
  return <canvas ref={ref} className={className} role="img" aria-label="Loading display component" style={{width:'100%',height:'auto',aspectRatio:`${scene.size.width} / ${scene.size.height}`}} />;
}
