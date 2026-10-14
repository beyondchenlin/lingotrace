'use client';
import {useStudioLocale} from '../i18n/react';
import {useEffect,useRef,type CSSProperties,type ReactNode} from 'react';
export type HudGlyphName='listen'|'history'|'keyboard'|'settings'|'close'|'display'|'pace';
/** Small, unfilled visuals; the shared button still supplies a 44px target. */
export function HudGlyph({name}:{name:HudGlyphName}){
 const paths:Record<HudGlyphName,ReactNode>={
  listen:<><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="11" width="4" height="8" rx="2"/><rect x="17" y="11" width="4" height="8" rx="2"/></>,
  history:<><path d="M3 10a9 9 0 1 1 1 8M3 4v6h6M12 7v5l3 2"/></>,
  keyboard:<><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h2M5 12h1m3 0h1m3 0h1m3 0h2M7 16h10"/></>,
  settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>,
  close:<path d="m6 6 12 12M6 18 18 6"/>,
  display:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>,
  // Metronome: fixed-pace / adaptive-assist toggle (pressed = active).
  pace:<><path d="M9 21h6L13.2 9H10.8L9 21z"/><path d="M12 9V5"/><path d="M12 9l4.5-2.5"/><circle cx="12" cy="17.5" r="1.2"/></>,
 };
 return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
export function HudPopover({label,onClose,children,className='',style}:{label:string;onClose:()=>void;children:ReactNode;className?:string;style?:CSSProperties}){
 const {t}=useStudioLocale();
 const ref=useRef<HTMLElement>(null),closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,panel=ref.current;ref.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRef.current();previous?.focus({preventScroll:true})}};const outside=(event:PointerEvent)=>{const target=event.target as Node|null;if(target&&!panel?.contains(target)&&!previous?.contains(target))closeRef.current()};document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',outside,true);return()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',outside,true);if(document.activeElement===document.body||panel?.contains(document.activeElement))previous?.focus({preventScroll:true})}},[]);
 return <section ref={ref} role="region" aria-label={label} className={`hud-popover ${className}`} style={style}><header><span>{label}</span><button className="hud-glyph" type="button" aria-label={t('common.closeNamed',{label})} onClick={onClose}><HudGlyph name="close"/></button></header>{children}</section>;
}
