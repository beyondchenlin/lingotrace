'use client';
import{useEffect,useRef,useState,type PointerEvent}from'react';
import{useStudioLocale}from'../i18n/react';
import type{MessageKey}from'../i18n/locale';
import{layoutSurfaceStyle,layoutSurfaceDelta}from'../scene/layout-surface';
import{DEFAULT_RECTS,LAYOUT_NAMES,constrainRect,scaleRect,dockRect,keyboardRect,rectFor,type Arrangement,type Movable,type Rect}from'../scene/transparent-layout';
import{constrainPortraitRect,scalePortraitRect,dockPortraitRect,keyboardPortraitRect,portraitRectFor}from'../scene/responsive-editor';
type Props={initial:Arrangement;base?:Arrangement;portrait?:boolean;portraitHeight?:number;surfaceHeight?:number;onChange:(a:Arrangement)=>void;onClose:()=>void;onCancel:()=>void;onResetAll:()=>void};
const nameKeys:Record<Movable,MessageKey>={media:'layoutEditor.media',inset:'layoutEditor.inset',subtitle:'layoutEditor.subtitle',metrics:'layoutEditor.metrics'};
const dockKeys=['layoutEditor.dockTopLeft','layoutEditor.dockTopRight','layoutEditor.dockBottomLeft','layoutEditor.dockBottomRight'] as const;
export default function LayoutEditor({initial,base={},portrait=false,portraitHeight=1080,surfaceHeight,onChange,onClose,onCancel,onResetAll}:Props){
 const {t}=useStudioLocale();
 const label=(key:Movable)=>t(nameKeys[key]);
 const displayWidth=portrait?430:1672,displayHeight=surfaceHeight??(portrait?portraitHeight:941);
 const[a,setA]=useState<Arrangement>(initial),[selected,setSelected]=useState<Movable>('inset'),[announcement,setAnnouncement]=useState('');
 const editorRef=useRef<HTMLDivElement>(null);useEffect(()=>{const frame=requestAnimationFrame(()=>editorRef.current?.querySelector<HTMLSelectElement>('select')?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame)},[]);
 const current=useRef(a),gesture=useRef<{key:Movable;kind:'move'|'resize';x:number;y:number;rect:Rect;width:number;height:number;before:Arrangement}|null>(null);
 function cancelGesture(){if(gesture.current){const before=gesture.current.before;gesture.current=null;current.current=before;setA(before);onChange(before);setAnnouncement(t('layoutEditor.viewportCancel'))}}
 useEffect(()=>{const cancel=()=>cancelGesture();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>{const g=gesture.current,rect=editorRef.current?.closest('.studio-stage')?.getBoundingClientRect();if(g&&rect&&(Math.abs(rect.width-g.width)>.01||Math.abs(rect.height-g.height)>.01))cancel()}):null;const stage=editorRef.current?.closest('.studio-stage');if(stage)observer?.observe(stage);window.addEventListener('resize',cancel);window.visualViewport?.addEventListener('resize',cancel);return()=>{observer?.disconnect();window.removeEventListener('resize',cancel);window.visualViewport?.removeEventListener('resize',cancel)}},[onChange,t]);
 useEffect(()=>{cancelGesture()},[portrait,portraitHeight,surfaceHeight]);
 function update(next:Arrangement){current.current=next;setA(next);onChange(next)}
 function visibleRect(key:Movable,values:Arrangement){const merged={...base,...values};return portrait?portraitRectFor(key,merged,portraitHeight):rectFor(key,merged)}
 const constrain=(key:Movable,r:Rect)=>portrait?constrainPortraitRect(key,r,portraitHeight):constrainRect(key,r);
 const scale=(key:Movable,r:Rect,d:number)=>portrait?scalePortraitRect(key,r,d,portraitHeight):scaleRect(key,r,d);
 const keyboard=(key:Movable,r:Rect,code:string,shift:boolean)=>portrait?keyboardPortraitRect(key,r,code,shift,portraitHeight):keyboardRect(key,r,code,shift);
 function setRect(key:Movable,r:Rect){update({...current.current,[key]:r})}
 function start(e:PointerEvent<HTMLButtonElement>,key:Movable,kind:'move'|'resize'){
  const stage=e.currentTarget.closest('.studio-stage')?.getBoundingClientRect();if(!stage)return;e.preventDefault();e.stopPropagation();setSelected(key);const r=constrain(key,visibleRect(key,current.current));gesture.current={key,kind,x:e.clientX,y:e.clientY,rect:r,width:stage.width,height:stage.height,before:{...current.current}};setRect(key,r);e.currentTarget.setPointerCapture(e.pointerId);
 }
 function move(e:PointerEvent<HTMLButtonElement>){const g=gesture.current;if(!g)return;const bounds=e.currentTarget.closest('.studio-stage')?.getBoundingClientRect();if(bounds&&(Math.abs(bounds.width-g.width)>.01||Math.abs(bounds.height-g.height)>.01)){cancelGesture();return;}const{dx,dy}=layoutSurfaceDelta(e.clientX-g.x,e.clientY-g.y,g.width,g.height,displayWidth,displayHeight);const delta=Math.abs(dx)>=Math.abs(dy*g.rect.w/g.rect.h)?dx:dy*g.rect.w/g.rect.h;setRect(g.key,g.kind==='move'?constrain(g.key,{...g.rect,x:g.rect.x+dx,y:g.rect.y+dy}):scale(g.key,g.rect,delta))}
 function finish(e:PointerEvent<HTMLButtonElement>){if(!gesture.current)return;gesture.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);const r=visibleRect(selected,current.current);setAnnouncement(t('layoutEditor.positionStatus',{name:label(selected),x:String(Math.round(r.x)),y:String(Math.round(r.y)),w:String(Math.round(r.w)),h:String(Math.round(r.h))}))}
 function reset(key:Movable){const next={...current.current};delete next[key];update(next)}
 return <div ref={editorRef} className="layout-editor" aria-label={t('layoutEditor.title')} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();if(gesture.current){update(gesture.current.before);gesture.current=null;setAnnouncement(t('layoutEditor.gestureCancel'))}else onCancel()}}}>
  <div className="layout-edit-toolbar"><label>{t('layoutEditor.adjust')}<select value={selected} onChange={e=>setSelected(e.target.value as Movable)}>{(Object.keys(LAYOUT_NAMES) as Movable[]).map(key=><option key={key} value={key}>{label(key)}</option>)}</select></label><div className="dock-buttons" aria-label={t('layoutEditor.dock')}>{(['top-left','top-right','bottom-left','bottom-right']as const).map((d,i)=><button key={d} onClick={()=>setRect(selected,(portrait?dockPortraitRect(selected,visibleRect(selected,a),d,portraitHeight):dockRect(selected,visibleRect(selected,a),d)))}>{t(dockKeys[i])}</button>)}</div><button onClick={()=>reset(selected)}>{t('layoutEditor.resetItem')}</button><button onClick={()=>{update({});onResetAll()}}>{t('layoutEditor.resetAll')}</button><button onClick={onCancel}>{t('layout.cancel')}</button><button className="done" onClick={onClose}>{t('layout.apply')}</button><p>{t('layoutEditor.hint')}{!portrait&&t('layoutEditor.hintLandscape')}</p></div>
  {(Object.keys(DEFAULT_RECTS)as Movable[]).map(key=>{const r=visibleRect(key,a);return <div key={key} className={`layout-frame ${selected===key?'selected':''}`} style={layoutSurfaceStyle(r,displayWidth,displayHeight)} data-layout-item={key}>
   <button className="layout-drag" aria-label={t('layoutEditor.moveAria',{name:label(key)})} onFocus={()=>setSelected(key)} onPointerDown={e=>start(e,key,'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={e=>{if(gesture.current)update(gesture.current.before);finish(e)}} onLostPointerCapture={()=>{gesture.current=null}} onKeyDown={e=>{if(e.key==='Home'){e.preventDefault();reset(key);return}const next=keyboard(key,visibleRect(key,current.current),e.key,e.shiftKey);if(next){e.preventDefault();setRect(key,next)}}}>⠿ {label(key)}</button>
   <button className="layout-resize" aria-label={t('layoutEditor.resizeAria',{name:label(key)})} onFocus={()=>setSelected(key)} onPointerDown={e=>start(e,key,'resize')} onPointerMove={move} onPointerUp={finish} onPointerCancel={e=>{if(gesture.current)update(gesture.current.before);finish(e)}} onLostPointerCapture={()=>{gesture.current=null}} onKeyDown={e=>{let code=e.key;if(code==='ArrowRight'||code==='ArrowDown')code='+';if(code==='ArrowLeft'||code==='ArrowUp')code='-';const next=keyboard(key,visibleRect(key,current.current),code,e.shiftKey);if(next){e.preventDefault();setRect(key,next)}}}>↘</button>
  </div>})}<span className="sr-only" role="status">{announcement}</span>
 </div>
}
