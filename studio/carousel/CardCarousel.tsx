'use client';
import {useCallback,useEffect,useMemo,useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react';
import {carouselMotion,DEMO_LESSON_CARDS,type CarouselMotionId,type LessonCardSpec} from './motions';
import './carousel.css';

export interface CardCarouselProps {
 cards?:LessonCardSpec[];
 locale?:'en'|'zh-CN';
 initialMotion?:CarouselMotionId;
}

export function CardCarousel({cards=DEMO_LESSON_CARDS,locale='en',initialMotion='depth-deck'}:CardCarouselProps){
 const [motionId,setMotionId]=useState<CarouselMotionId>(initialMotion);
 const [index,setIndex]=useState(0);
 const [reduced,setReduced]=useState(false);
 const [dragX,setDragX]=useState(0);
 const [settling,setSettling]=useState(false);
 const [revealed,setRevealed]=useState(true);
 const startX=useRef<number|null>(null);
 const settleTimer=useRef<number|null>(null);
 const profile=carouselMotion(motionId);
 const count=cards.length;
 const clearSettle=()=>{if(settleTimer.current!=null){window.clearTimeout(settleTimer.current);settleTimer.current=null}};
 const go=useCallback((next:number)=>{
  if(!count)return;
  clearSettle();
  setSettling(true);
  setRevealed(reduced||motionId!=='magnetic-reveal');
  setIndex(((next%count)+count)%count);
  setDragX(0);
  const settle=reduced?160:profile.settleMs;
  settleTimer.current=window.setTimeout(()=>{
   setSettling(false);
   setRevealed(true);
   settleTimer.current=null;
  },settle);
 },[count,motionId,profile.settleMs,reduced]);
 useEffect(()=>{
  const mq=window.matchMedia('(prefers-reduced-motion: reduce)');
  const sync=()=>setReduced(mq.matches);
  sync();mq.addEventListener('change',sync);
  return()=>mq.removeEventListener('change',sync);
 },[]);
 useEffect(()=>()=>clearSettle(),[]);
 useEffect(()=>{
  // Switching motion should re-settle active card content for Magnetic Reveal.
  if(motionId==='magnetic-reveal'&&!reduced){
   setRevealed(false);
   clearSettle();
   settleTimer.current=window.setTimeout(()=>{setRevealed(true);setSettling(false)},profile.settleMs);
  }else setRevealed(true);
 },[motionId,profile.settleMs,reduced]);
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{
   if(e.key==='ArrowRight'){e.preventDefault();go(index+1)}
   if(e.key==='ArrowLeft'){e.preventDefault();go(index-1)}
  };
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[go,index]);
 const order=useMemo(()=>cards.map((_,i)=>(i-index+count)%count),[cards,count,index]);
 const onPointerDown=(e:ReactPointerEvent)=>{
  startX.current=e.clientX;setDragX(0);
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
 };
 const onPointerMove=(e:ReactPointerEvent)=>{
  if(startX.current==null)return;
  setDragX(e.clientX-startX.current);
 };
 const onPointerUp=()=>{
  if(startX.current==null)return;
  const dx=dragX;startX.current=null;
  if(Math.abs(dx)>56)go(index+(dx<0?1:-1));
  else setDragX(0);
 };
 return(
  <section className="lt-cards-shell" data-motion={motionId} data-reduced={reduced||undefined} aria-roledescription="carousel">
   <header className="lt-cards-header">
    <div>
     <p className="lt-cards-kicker">{locale==='zh-CN'?'课程卡片':'Lesson cards'}</p>
     <h1>{locale==='zh-CN'?'双动效卡组':'Dual-motion deck'}</h1>
     <p className="lt-cards-lede">{locale==='zh-CN'?'Depth Deck / Magnetic Reveal · 定速 / 听写 / 儿童版 / 咖啡馆定速 · 不改变训练事实':'Depth Deck / Magnetic Reveal · fixed / dictation / kids / cafe fixed · training facts unchanged'}</p>
    </div>
    <nav className="lt-cards-nav" aria-label={locale==='zh-CN'?'动效模式':'Motion mode'}>
     {([['depth-deck','Depth Deck','纵深叠卡'],['magnetic-reveal','Magnetic Reveal','磁力揭示']] as const).map(([id,en,zh])=>(
      <button key={id} type="button" aria-pressed={motionId===id} onClick={()=>setMotionId(id)}>{locale==='zh-CN'?zh:en}</button>
     ))}
     <a className="lt-cards-studio" href="/studio/">{locale==='zh-CN'?'打开 Studio':'Open Studio'}</a>
    </nav>
   </header>
   <div
    className={`lt-card-carousel ${settling?'is-settling':''}`}
    data-motion={motionId}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerUp}
    role="group"
    aria-label={locale==='zh-CN'?'可滑动的课程卡片':'Swipeable lesson cards'}
   >
    {cards.map((card,i)=>{
     const stack=order[i];
     const active=stack===0;
     const style=cardStyle(motionId,stack,dragX,profile,reduced);
     const title=locale==='zh-CN'?card.titleZh:card.title;
     const subtitle=locale==='zh-CN'?card.subtitleZh:card.subtitle;
     const aspectLabel=card.aspect==='portrait'
      ?(locale==='zh-CN'?'竖版':'Portrait')
      :(locale==='zh-CN'?'横版':'Landscape');
     return(
      <article
       key={card.id}
       className={`lt-card ${active?'is-active':''} ${active&&revealed?'is-revealed':''}`}
       data-aspect={card.aspect}
       data-stack={stack}
       style={style}
       aria-hidden={!active}
       tabIndex={active?0:-1}
      >
       <div className="lt-card-media" data-aspect={card.aspect} data-live={active&&!!card.videoSrc&&!reduced||undefined}>
        <span className="lt-card-aspect">{aspectLabel}</span>
        <div className="lt-card-media-frame">
         {card.videoSrc&&active&&!reduced?(
          <video src={card.videoSrc} poster={card.posterSrc} muted playsInline loop autoPlay preload="metadata"/>
         ):(
          <img src={card.posterSrc} alt="" loading={active?'eager':'lazy'}/>
         )}
        </div>
       </div>
       <div className="lt-card-meta">
        <span className="lt-card-kind" data-kind={card.kind}>{kindLabel(card.kind,locale)}</span>
        <strong>{title}</strong>
        <span>{subtitle}</span>
        {card.credit&&<small>{card.credit}</small>}
        {active&&<a className="lt-card-cta" href={card.href}>{locale==='zh-CN'?(card.ctaZh??'进入练习'):(card.cta??'Practice')}</a>}
       </div>
      </article>
     );
    })}
   </div>
   <div className="lt-cards-dots" role="tablist" aria-label={locale==='zh-CN'?'卡片位置':'Card position'}>
    {cards.map((card,i)=>(
     <button key={card.id} type="button" role="tab" aria-selected={i===index} aria-label={`${i+1}`} onClick={()=>go(i)}/>
    ))}
   </div>
   <p className="lt-cards-hint">{locale==='zh-CN'?'左右键或拖拽切换 · 减少动效时改为淡入 · 媒体 contain 不裁切':'Arrow keys or drag · reduced motion uses fade · media uses contain'}</p>
  </section>
 );
}

function kindLabel(kind:LessonCardSpec['kind'],locale:'en'|'zh-CN'){
 const map={
  'fixed-pace':['Fixed pace','定速'],
  dictation:['Dictation','听写'],
  kids:['Kids','儿童版'],
  'cafe':['Cafe fixed','咖啡馆定速'],
  assisted:['Assisted','辅助'],
  follow:['Follow · sentence β','跟音 · 句级 β'],
 } as const;
 return locale==='zh-CN'?map[kind][1]:map[kind][0];
}

function cardStyle(motionId:CarouselMotionId,stack:number,dragX:number,profile:ReturnType<typeof carouselMotion>,reduced:boolean):CSSProperties{
 if(reduced){
  return{opacity:stack===0?1:0,transform:'none',zIndex:20-stack,pointerEvents:stack===0?'auto':'none',transition:`opacity ${profile.settleMs*.4}ms ease`};
 }
 const depth=Math.min(stack,3);
 const x=stack===0?dragX:depth*(motionId==='depth-deck'?10:6);
 const y=depth*profile.stackOffsetY+(motionId==='magnetic-reveal'&&stack===0&&Math.abs(dragX)>8?-profile.snapOvershoot*0.15:0);
 const scale=stack===0?profile.focusScale*(1-Math.min(Math.abs(dragX),120)/2400):Math.max(.72,1-depth*profile.stackScaleStep);
 const opacity=stack===0?1:Math.max(.12,profile.neighborOpacity-depth*.08);
 const rot=stack===0?dragX*.03:depth*(motionId==='depth-deck'?-2.2:-1.4);
 return{
  transform:`translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) rotate(${rot}deg) scale(${scale})`,
  opacity,
  zIndex:40-stack,
  pointerEvents:stack===0?'auto':'none',
  transition:startHeld(dragX)?undefined:`transform ${profile.settleMs}ms cubic-bezier(.2,.85,.2,1), opacity ${profile.settleMs*.8}ms ease`,
 };
}

function startHeld(dragX:number){return dragX!==0}
