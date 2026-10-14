import {translate,translateKnownUi,type MessageKey,type MessageParams} from '../i18n/locale';
import {learningGeometry,inputHeaderControls,containLearningMedia} from './learning-surface';
import {HudContrastController,HUD_CONTRAST_MIN_ALPHA,type HudContrastState} from './hud-contrast';
import {containRect,type SceneMedia,type SceneVisual} from './renderer';
import {validateVideoPalette,type VideoPalette} from './video-palette';
import {type Rect} from './transparent-layout';
import {inputFeedbackLines,applyInputCardLayout,paintInputText,paintPassiveKeyboard,wrapInputText} from './input-card';
import {responsiveLayout,PORTRAIT_HEIGHT,isPortraitPracticeCompact} from './responsive-layout';
import {STUDIO_SANS,STUDIO_MONO,STUDIO_SEMIBOLD} from './fonts';
import {getDraftFeedback} from '../core/draft-feedback';
import {trendSegments} from '../hud-library/metrics';
import type {TrendMetric} from '../hud-library/schema';
import {deriveTransparentPresentation} from './transparent-presentation';
import {monotoneCurve,eventBars} from './hud-traces';
import {knownCueMarkers,timelineMotion} from './transparent-timeline';
import type {TransparentInputFrame} from './transparent-input';
import {materialStageTitle} from './material-title';
import {cameraControlGeometry} from './camera-control';
import {hudPanelBackingRects,hudPanelContentRects} from './hud-panel-backing';
import {editionSurface} from '../theme/kids-cartoon';

export interface TransparentSceneFrame {input:TransparentInputFrame;enteredAt:number;mediaChangedAt:number;mediaLoading:boolean;wallNowMs:number;replay:boolean;restored?:boolean;restoreFailed?:boolean;pageInputStarted:boolean;standbyPaused?:boolean;mediaInteracted?:boolean}
export const TRANSPARENT_VERSION='v27-continuous-input-traces';
const WHITE='#f4f6f5',MUTED='#c8d3d6',AQUA='#42ebda',BLUE='#9bddff',GOLD='#ffc15f';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const format=(n:number)=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
function txt(c:CanvasRenderingContext2D,s:string,x:number,y:number,size:number,color=WHITE,weight=400,align:CanvasTextAlign='left',font=STUDIO_SANS,max?:number){c.save();c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.letterSpacing='0px';c.shadowColor=color==='#102018'?'transparent':'#02090baa';c.shadowBlur=color==='#102018'?0:1.5;c.shadowOffsetY=color==='#102018'?0:1;c.fillText(s,x,y,max);c.restore()}
function centeredText(c:CanvasRenderingContext2D,s:string,x:number,centerY:number,size:number,color=WHITE,weight=400,align:CanvasTextAlign='left'){c.save();c.font=`${weight} ${size}px ${STUDIO_SANS}`;const b=c.measureText(s),baseline=centerY+(b.actualBoundingBoxAscent-b.actualBoundingBoxDescent)/2;c.restore();txt(c,s,x,baseline,size,color,weight,align)}
function line(c:CanvasRenderingContext2D,x:number,y:number,xx:number,yy:number,color:string,width=1){c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.stroke()}
function cross(c:CanvasRenderingContext2D,x:number,y:number,alpha=.5,glow='#c6e1da'){c.save();c.globalAlpha*=alpha*.45;c.shadowColor=glow;c.shadowBlur=4;c.beginPath();c.arc(x,y,1.1,0,Math.PI*2);c.fillStyle='#d9eee7';c.fill();c.restore()}
function frame(c:CanvasRenderingContext2D,r:Rect,alpha=.5,color='#c9e2d8'){c.save();c.globalAlpha*=alpha*.72;c.strokeStyle=color;c.lineWidth=.9;c.lineCap='round';c.lineJoin='round';for(const[x,y,dx,dy]of[[r.x,r.y,1,1],[r.x+r.w,r.y,-1,1],[r.x,r.y+r.h,1,-1],[r.x+r.w,r.y+r.h,-1,-1]]){c.beginPath();c.moveTo(x+dx*16,y);c.lineTo(x+dx*7,y);c.quadraticCurveTo(x,y,x,y+dy*7);c.lineTo(x,y+dy*16);c.stroke()}c.restore()}
function media(c:CanvasRenderingContext2D,m:SceneMedia,v:SceneVisual,r:Rect,camera=false,cssScale=1){let source:CanvasImageSource|undefined,sw=1,sh=1;
 if(camera&&v.camera==='on'&&m.camera.readyState>=2){source=m.camera;sw=m.camera.videoWidth;sh=m.camera.videoHeight}
 else if(!camera&&m.kind==='image'&&m.image.complete&&m.image.naturalWidth){source=m.image;sw=m.image.naturalWidth;sh=m.image.naturalHeight}
 else if(!camera&&m.kind!=='image'&&m.lesson.readyState>=2&&m.lesson.videoWidth){source=m.lesson;sw=m.lesson.videoWidth;sh=m.lesson.videoHeight}
 else if(!camera&&m.kind==='demo'&&m.poster.complete&&m.poster.naturalWidth){source=m.poster;sw=m.poster.naturalWidth;sh=m.poster.naturalHeight}
 // Always aspect-preserving contain/fit (never cover crop). Full frame stays visible.
 if(source){let fit=containRect(sw,sh,r.x,r.y,r.w,r.h);if(!camera&&v.videoSize)fit=containLearningMedia({width:sw,height:sh},r,cssScale,v.videoSize,v.mediaViewport);c.fillStyle='#0b1419';c.fillRect(r.x,r.y,r.w,r.h);try{c.drawImage(source,fit.x,fit.y,fit.w,fit.h);return{source,fit,identity:'currentSrc' in source?source.currentSrc:'src' in source?String(source.src):String(source)}}catch{}}else if(camera){c.fillStyle='#111a2020';c.fillRect(r.x,r.y,r.w,r.h)}
}
const hudContrastControllers=new WeakMap<HTMLCanvasElement,HudContrastController>();
const hudContrastStates=new WeakMap<HTMLCanvasElement,HudContrastState['status']|'letterbox'>();
export function readHudContrastStatus(canvas:HTMLCanvasElement){return hudContrastStates.get(canvas)??'waiting'}
function hudBacking(c:CanvasRenderingContext2D,r:Rect,alpha:number,content:Rect,radius=16,warmLift=0){
 // Premium frosted plate: vertical glass gradient + top specular + soft rim (game HUD / ELSA-class chrome).
 c.save();c.beginPath();c.roundRect(r.x,r.y,r.w,r.h,radius);
 const top=10+Math.round(warmLift*26),mid=16+Math.round(warmLift*20),bot=8+Math.round(warmLift*14);
 const shade=c.createLinearGradient(0,r.y,0,r.y+r.h);
 shade.addColorStop(0,`rgba(${top+6},${mid+8},28,${Math.min(.98,alpha*1.06)})`);
 shade.addColorStop(.42,`rgba(${top},${mid},24,${alpha})`);
 shade.addColorStop(1,`rgba(${bot},${mid-2},20,${alpha*.88})`);
 c.fillStyle=shade;c.fill();
 // Soft outer rim
 c.strokeStyle=`rgba(201,226,216,${.14+alpha*.12})`;c.lineWidth=1;c.stroke();
 // Top specular hairline
 c.beginPath();c.roundRect(r.x+.6,r.y+.6,r.w-1.2,Math.max(1,r.h*.38),Math.max(4,radius-2));
 const spec=c.createLinearGradient(0,r.y,0,r.y+r.h*.4);
 spec.addColorStop(0,`rgba(232,244,238,${.10+alpha*.06})`);spec.addColorStop(1,'rgba(232,244,238,0)');
 c.fillStyle=spec;c.fill();
 c.restore()
}
export function transparentEntrance(now:number,enteredAt:number,changedAt:number,loading:boolean,reduced:boolean){if(reduced)return 1;const age=Math.max(0,now-(changedAt||enteredAt));return loading?1-.62*clamp(age/220):.38+.62*(1-Math.pow(1-clamp(age/720),3))}
function mapRect(c:CanvasRenderingContext2D,source:Rect,target:Rect){c.save();c.translate(target.x,target.y);c.scale(target.w/source.w,target.h/source.h);c.translate(-source.x,-source.y)}
const sceneText=txt;
/** Transparent v6 skin. All observations arrive through the shared live scene frame. */
export function paintTransparentScene(canvas:HTMLCanvasElement,m:SceneMedia,v:SceneVisual,f:TransparentSceneFrame,portrait=false,portraitHeight=PORTRAIT_HEIGHT){if(f.replay){v={...v,listeningDisplay:undefined,inputFocused:false,caret:0,selectionEnd:0,scrollLeft:0,scrollTop:0,nativeInputDisplay:undefined,inputGuide:undefined,referenceGuide:undefined,keyboardFeedback:{visible:v.keyboardFeedback?.visible!==false,codes:[],committedUntil:0,composing:false},gain:0,rewardAttemptId:null};f={...f,input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]}}}const c=canvas.getContext('2d',{alpha:false});if(!c)return;const palette=validateVideoPalette(v.palette)?v.palette:null;const geometry=learningGeometry(responsiveLayout(portrait,v.arrangement,v.layout,portraitHeight),{keyboardVisible:v.keyboardFeedback?.visible!==false,keyboardPlacement:v.keyboardPlacement,intrinsicWidth:v.layout==='camera'?m.camera.videoWidth:m.kind==='image'?m.image.naturalWidth:m.lesson.videoWidth,intrinsicHeight:v.layout==='camera'?m.camera.videoHeight:m.kind==='image'?m.image.naturalHeight:m.lesson.videoHeight,videoSize:v.layout==='camera'?'fit':(portrait&&isPortraitPracticeCompact(portraitHeight)&&(v.videoSize==null||v.videoSize==='native')?'fit':v.videoSize),availableWidth:v.mediaViewport?.width,availableHeight:v.mediaViewport?.height,cssWidth:v.cameraViewport?.width,hud:v.hudPreferences}),projected=portrait||geometry.hudFactor!==1,W=geometry.width,H=geometry.height,zones=geometry.zones,now=v.renderTime,s=v.snapshot,feedback=v.listeningDisplay?.active?null:getDraftFeedback(s,v.draft,v.composition).attempt;
 const listening=v.listeningDisplay?.active?v.listeningDisplay:null,locale=v.locale??'en',t=(key:MessageKey,params?:MessageParams)=>translate(locale,key,params);
 // Secondary labels remain 10 logical pixels; each compact panel explicitly
 // lays out its essential 12px labels. Desktop typography stays untouched.
 const txt:typeof sceneText=portrait?(ctx,text,x,y,size,color,weight,align,font,max)=>{
  const transform=ctx.getTransform(),scale=Math.hypot(transform.a,transform.b)/(canvas.width/W);
  sceneText(ctx,text,x,y,Math.max(size,10/scale),color,weight,align,font,max);
 }:sceneText;
 const presentation=deriveTransparentPresentation(s,{nowMs:now,enteredAtMs:f.enteredAt,reducedMotion:v.reducedMotion,paused:f.pageInputStarted?v.paused:!!f.standbyPaused,pageInputStarted:f.pageInputStarted||!!listening,restoreFailed:f.restoreFailed,restored:!!f.restored,replay:f.replay,scorable:m.kind==='demo'}),standby=presentation.standby,edition=editionSurface(v.visualEdition);let tone=presentation.accent==='mint'?'#c8e4b4':presentation.accent==='amber'?'#efbd78':GOLD,traceTone=presentation.accent==='neutral'?BLUE:tone;if(edition.id==='kids'){tone=edition.tone;traceTone=edition.traceTone}const hudNow=standby?.nowMs??now;
 if(standby)f={...f,input:{commits10s:standby.commits10s,energy:standby.energy,latestRate:null,observedMs:0,frozen:standby.frozen,points:standby.points,pulses:standby.pulses}};
 c.save();c.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);c.clearRect(0,0,W,H);c.fillStyle='#101a20';c.fillRect(0,0,W,H);const primary=geometry.media,picture=media(c,m,v,primary,v.layout==='camera',(v.cameraViewport?.width??W)/W);
 // Soft media plate rim — frames the lesson without covering the picture.
 if(portrait){c.save();c.beginPath();c.roundRect(primary.x+.5,primary.y+.5,primary.w-1,primary.h-1,10);c.strokeStyle='rgba(201,226,216,.18)';c.lineWidth=1;c.stroke();c.restore()}
 const cameraRect=cameraControlGeometry(geometry,v.camera,v.layout,{fixture:v.fixture,cssWidth:v.cameraViewport?.width,cssHeight:v.cameraViewport?.height}).visual,contentRects=hudPanelContentRects(geometry,cameraRect),contrastRects=hudPanelBackingRects(geometry,cameraRect,contentRects);
 let contrast=hudContrastControllers.get(canvas);if(!contrast){contrast=new HudContrastController();hudContrastControllers.set(canvas,contrast)}
 const letterboxed=new Set(Object.entries(contrastRects).filter(([,r])=>picture&&(r.x+r.w<=picture.fit.x||r.x>=picture.fit.x+picture.fit.w||r.y+r.h<=picture.fit.y||r.y>=picture.fit.y+picture.fit.h)).map(([key])=>key));
 const regions=Object.fromEntries(Object.entries(contrastRects).filter(([key])=>!letterboxed.has(key)).map(([key,r])=>[key,picture?{x:(r.x-picture.fit.x)/picture.fit.w,y:(r.y-picture.fit.y)/picture.fit.h,w:r.w/picture.fit.w,h:r.h/picture.fit.h}:{x:0,y:0,w:1,h:1}]));
 const contrastState=contrast.update(picture?.source??null,picture?.identity??'no-media',regions,now,v.reducedMotion);hudContrastStates.set(canvas,picture&&Object.keys(regions).length===0?'letterbox':contrastState.status);
 for(const[key,r]of Object.entries(contrastRects)){hudBacking(c,r,Math.min(.94,(letterboxed.has(key)?HUD_CONTRAST_MIN_ALPHA:contrastState.alpha[key])*edition.plateAlpha),contentRects[key],edition.plateRadius,edition.warmLift);}
 // Below appends only a keyboard; it must not stretch the video HUD shading.
 const shadeBottom=geometry.inputCard.overlayControls?geometry.player.y+geometry.player.h:H;
 const shade=c.createLinearGradient(0,0,0,shadeBottom);shade.addColorStop(0,'#07111a70');shade.addColorStop(.24,'#07111a05');shade.addColorStop(.6,'#07111a00');shade.addColorStop(1,'#07111a35');c.fillStyle=shade;c.fillRect(0,0,W,H);
 if(!v.ready)txt(c,translateKnownUi(locale,v.message)||t('hud.loading'),portrait?W/2:836,portrait?primary.y+primary.h/2:475,24,WHITE,400,'center');
 const entrance=transparentEntrance(now,f.enteredAt,f.mediaChangedAt,f.mediaLoading,v.reducedMotion),breath=(v.reducedMotion?0:.5+.5*Math.sin((now-f.enteredAt)/1200))*edition.breathScale;c.save();c.globalAlpha=entrance;
 // Subtle drafting marks have no measurement meaning and never change geometry.
 if(!portrait){line(c,45,24,45,314,'#b6e9ed28');line(c,45,24,285,24,'#b6e9ed24');line(c,304,91,658,91,'#a9d8df28');line(c,1037,89,1285,89,'#a9d8df2a');[ [45,24],[45,91],[284,185],[304,91],[635,89],[1037,89],[1642,44],[1643,845] ].forEach(([x,y])=>cross(c,x,y,.28+breath*.25,palette?.glow));}else{
  // The original upper-left drafting L follows the goal's uniform scale.
  mapRect(c,{x:32,y:54,w:264,h:264},geometry.goal);
  line(c,45,24,45,314,'#b6e9ed28');line(c,45,24,285,24,'#b6e9ed24');
  [[45,24],[45,91],[284,185]].forEach(([x,y])=>cross(c,x,y,.28+breath*.25,palette?.glow));c.restore();
  // Original two horizontal connectors follow the title's left/right regions.
  const connectorY=geometry.title.y+geometry.title.h-9*geometry.title.w/402,connectorLeft=geometry.goal.x+geometry.goal.w,connectorRight=geometry.trend.x+geometry.trend.w-4.06;
  line(c,connectorLeft,connectorY,205,connectorY,'#a9d8df28');line(c,225,connectorY,connectorRight,connectorY,'#a9d8df2a');
  [[connectorLeft,connectorY],[205,connectorY],[225,connectorY]].forEach(([x,y])=>cross(c,x,y,.28+breath*.25,palette?.glow));
  mapRect(c,{x:1297,y:40,w:352,h:192},geometry.trend);cross(c,1642,44,.28+breath*.25,palette?.glow);c.restore();
  mapRect(c,{x:1575,y:845,w:69,h:65},geometry.counter);cross(c,1643,845,.28+breath*.25,palette?.glow);c.restore();
 }
 // Goal is explicit configuration, not a score fabricated from the reference art.
 if(projected)mapRect(c,{x:32,y:54,w:264,h:264},geometry.goal);
 const earned=standby?.goalWords??s?.earnedWords??0,goal=24,ratio=standby?.goalFraction??Math.min(1,earned/goal),cx=164,cy=186,r=92;const aura=c.createRadialGradient(cx,cy,25,cx,cy,132);aura.addColorStop(0,'#08121799');aura.addColorStop(1,'#08121700');c.fillStyle=aura;c.fillRect(32,54,264,264);c.save();c.shadowColor=tone;c.shadowBlur=v.reducedMotion?5:7+breath*4;line(c,65,62,90,62,tone,5.5);c.restore();txt(c,t('hud.goal').toUpperCase(),portrait?103:109,portrait?Math.max(70,54+9/(geometry.goal.w/264)):70,portrait?11/(geometry.goal.w/264):15,'#d5e4df',500);
 for(let i=0;i<48;i++){const angle=-Math.PI/2+i*Math.PI/24;line(c,cx+Math.cos(angle)*107,cy+Math.sin(angle)*107,cx+Math.cos(angle)*(i%4===0?115:111),cy+Math.sin(angle)*(i%4===0?115:111),'#c9e4e077')}
 c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.strokeStyle='#c5e0dc44';c.lineWidth=3.2;c.stroke();if(ratio>0){c.save();c.shadowColor=tone;c.shadowBlur=10+breath*4;c.beginPath();c.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+Math.PI*2*ratio);c.lineWidth=6.2;c.lineCap='round';c.strokeStyle=tone;c.stroke();const theta=-Math.PI/2+Math.PI*2*ratio;c.beginPath();c.arc(cx+Math.cos(theta)*r,cy+Math.sin(theta)*r,4.2,0,Math.PI*2);c.fillStyle='#fff6d4';c.fill();c.restore()}
 txt(c,f.restoreFailed?'—':`${Math.round(ratio*100)}%`,cx,192,42,WHITE,700,'center');txt(c,f.restoreFailed?'':`${earned} / ${goal}`,cx,220,15,'#d2ddd9',500,'center');if(!standby)txt(c,t('scene.confirmedWords'),cx,244,11,tone,500,'center');if(standby&&!standby.frozen){c.save();c.globalAlpha=.42;c.strokeStyle=tone;c.lineWidth=1.5;c.beginPath();const angle=-Math.PI/2+standby.sweep*Math.PI*2;c.arc(cx,cy,r+8,angle,angle+.45);c.stroke();c.restore()}
 // Kids edition: soft decorative orbs only — freeze under reduced-motion; never affect geometry/facts.
 if(edition.id==='kids'){c.save();const orbs=[[cx-78,cy-62,.55],[cx+86,cy-48,.4],[cx-54,cy+78,.35],[cx+72,cy+70,.48]];for(const[ox,oy,a]of orbs){const pulse=v.reducedMotion?a:a*(.72+.28*Math.sin((now-f.enteredAt)/900+ox*.01));c.globalAlpha=pulse;c.fillStyle=tone;c.beginPath();c.arc(ox,oy,v.reducedMotion?3.2:3.2+breath*1.6,0,Math.PI*2);c.fill()}c.restore()}
 if(projected){c.restore();mapRect(c,{x:568,y:38,w:536,h:352/3},geometry.title)}
 {
 const titleText=m.kind==='demo'?materialStageTitle(s):t('scene.localMedia').toUpperCase();
 const statusText=f.restoreFailed?t('scene.restoreFailed'):f.replay?t('scene.replay'):v.paused?t('hud.paused'):standby?t('scene.standby').toUpperCase():'30 MIN';
 // Soft title band — letter-spaced product chrome, not a loud pill.
 c.save();c.font=`500 29px ${STUDIO_SANS}`;const tw=Math.min(480,c.measureText(titleText).width+48);c.restore();
 const band={x:836-tw/2,y:48,w:tw,h:68};
 c.save();c.beginPath();c.roundRect(band.x,band.y,band.w,band.h,14);
 const tg=c.createLinearGradient(0,band.y,0,band.y+band.h);
 tg.addColorStop(0,'rgba(14,22,28,.55)');tg.addColorStop(1,'rgba(10,16,22,.28)');
 c.fillStyle=tg;c.fill();c.strokeStyle='rgba(201,226,216,.22)';c.lineWidth=1;c.stroke();c.restore();
 txt(c,titleText,836,70,26,WHITE,500,'center');
 line(c,836-Math.min(72,tw*.28),84,836+Math.min(72,tw*.28),84,'#c9e2d838',1);
 txt(c,statusText,836,104,12,'#b8c6c4',500,'center');
 if(f.restoreFailed)txt(c,t('scene.restoreDetail'),836,129,14,'#ffd4b7',400,'center');
}
 if(projected){c.restore();mapRect(c,{x:1297,y:40,w:352,h:192},geometry.trend)}
 // Cadence is a separate ephemeral reference projection. It never becomes f.input.
 const cadence=listening&&!listening.hidden&&!v.reducedMotion?listening.cadence:null;
 const cadencePoints=cadence?.status==='active'?cadence.points:[];
 const displayedPoints=listening?cadencePoints:f.input.points;
 // Library trend segmentation preserves every pause/missing interval of real input.
 const panel={x:1297,y:40,w:352,h:192};frame(c,panel,.34+breath*.12,palette?.frame);line(c,1321,59,1342,59,traceTone,5.5);txt(c,(listening?t('scene.referencePace'):t('hud.trend')).toUpperCase(),1358,64,portrait?11/(geometry.trend.w/352):14,'#d8e6e1',500);txt(c,listening?t('scene.estimated').toUpperCase():standby?'':t('scene.graphemes').toUpperCase(),1625,portrait?86:63,portrait?10/(geometry.trend.w/352):10,'#aebcba',500,'right');
 const windowMs=standby?.historyWindowMs??30000,end=Math.max(windowMs,listening?(cadencePoints.length?cadence!.endMs:0):hudNow),start=end-windowMs,max=Math.max(6,Math.ceil(Math.max(0,...displayedPoints.map(p=>p.value??0))/2)*2);const meta={schemaVersion:1 as const,metricId:'live-input-gps',metricVersion:1 as const,unit:'graphemes/second' as const,source:standby?'fixture' as const:'input-event' as const,quality:standby?'estimated' as const:'measured' as const,observedAtMs:now,sourceEventIds:[],state:{status:'ready' as const}};
 const trend:TrendMetric={...meta,kind:'trend',domain:{startMs:start,endMs:end,min:0,max},points:f.input.points.map(p=>({atMs:p.atMs,value:p.value,quality:p.value===null?'unmeasured':standby?'estimated':'measured',sourceEventIds:[],state:p.value===null?'missing':'active'}))};
 const plotTop=portrait?104:90,plotBottom=portrait?198:200,plotHeight=portrait?94:110;
 for(let i=0;i<3;i++){const y=plotTop+i*(portrait?47:55);c.setLineDash(i<2?[4,5]:[]);line(c,1344,y,1627,y,'#d2e6e485');c.setLineDash([])}line(c,1344,portrait?104:87,1344,plotBottom,'#ddf6f2aa');txt(c,String(max),1328,portrait?110:96,16,WHITE,400,'right');txt(c,'0',1328,201,16,WHITE,400,'right');txt(c,`${Math.round(start/1000)}s`,1344,220,13);txt(c,`${Math.round(end/1000)}s`,1627,220,13,WHITE,400,'right');
 c.save();c.beginPath();c.rect(1343,portrait?103:86,285,portrait?96:115);c.clip();
 for(const segment of listening?(cadencePoints.length?[cadencePoints]:[]):trendSegments(trend,1500)){
   const points=segment.map(p=>({x:1344+(p.atMs-start)/windowMs*283,y:plotBottom-p.value!/max*plotHeight}));
   c.beginPath();for(const curve of monotoneCurve(points)){c.moveTo(curve.from.x,curve.from.y);c.bezierCurveTo(curve.c1.x,curve.c1.y,curve.c2.x,curve.c2.y,curve.to.x,curve.to.y)}
   c.strokeStyle=traceTone;c.lineWidth=2.3;c.lineCap='round';c.lineJoin='round';c.shadowColor=traceTone;c.shadowBlur=3;c.stroke();
   const last=points.at(-1);if(last){c.beginPath();c.arc(last.x,last.y,2.5,0,Math.PI*2);c.fillStyle=traceTone;c.fill()}
 }c.restore();
 if(!displayedPoints.some(p=>p.value!==null))txt(c,listening?(listening.hidden?t('scene.hidden'):v.reducedMotion?t('scene.reducedMotion'):cadence?.status==='paused'?t('hud.paused'):t('scene.awaitingPlayback')):f.replay?t('scene.replayPaused'):t('scene.typeToTrace'),1485,portrait?159:153,15,'#e0e9e7c9',400,'center');
 if(projected)c.restore();
 // Compact camera entry is presentation-only; enabled/split/course inset stays original.
 const cameraControl=cameraControlGeometry(geometry,v.camera,v.layout,{fixture:v.fixture,cssWidth:v.cameraViewport?.width,cssHeight:v.cameraViewport?.height});
 if(cameraControl.compact){
  // Bare camera line-art — same 20px / 1.5 stroke peer as keyboard/settings/Enter.
  const r=cameraControl.visual;c.save();c.translate(r.x,r.y);c.scale(r.w/20,r.h/20);
  c.strokeStyle='#edf4ef';c.lineWidth=1.5;c.lineCap='round';c.lineJoin='round';c.shadowColor='#06101699';c.shadowBlur=2;
  c.beginPath();c.roundRect(2,5,11,10,2);c.stroke();
  c.beginPath();c.moveTo(13,7);c.lineTo(18,4);c.lineTo(18,16);c.lineTo(13,13);c.closePath();c.stroke();
  if(v.camera==='requesting')txt(c,'…',10,3,7,WHITE,600,'center');
  else if(v.camera==='error')txt(c,'!',17,4,7,'#ffd2bb',600,'center');
  c.restore();
  // The Canvas REC clock remains at its original inset footer even when the
  // unused camera frame is collapsed. DOM-only status is not a recording.
  if(v.recording){if(portrait)mapRect(c,{x:1374,y:292,w:240,h:152},geometry.inset);const inset=portrait?{x:1374,y:292,w:240,h:152}:geometry.inset;const sec=Math.max(0,(f.wallNowMs-(v.recordingStarted??f.wallNowMs))/1000);txt(c,`● REC ${format(sec)}`,inset.x+12,inset.y+inset.h-6,12,'#ffb3a2');if(portrait)c.restore()}
 }else{
 // Camera icon is transparent until explicit permission and a real stream exist.
 if(portrait)mapRect(c,{x:1374,y:292,w:240,h:152},geometry.inset);const inset=portrait?{x:1374,y:292,w:240,h:152}:geometry.inset;if(v.layout==='camera')media(c,m,v,{...inset,h:inset.h-25},false,(v.cameraViewport?.width??W)/W);else if(v.camera==='on'){media(c,m,v,{...inset,h:inset.h-25},true)}else{const x=inset.x+inset.w/2,y=inset.y+inset.h*.45;c.strokeStyle='#edf2ee';c.lineWidth=2;c.beginPath();c.roundRect(x-27,y-20,43,37,8);c.stroke();c.beginPath();c.moveTo(x+17,y-12);c.lineTo(x+34,y-19);c.lineTo(x+34,y+16);c.lineTo(x+17,y+10);c.stroke();txt(c,v.camera==='requesting'?t('scene.cameraPermission'):v.camera==='error'?t('hud.cameraError'):t('hud.cameraOff'),x,y+51,portrait?Math.max(21,12/(geometry.inset.w/240)):21,WHITE,400,'center')}
 frame(c,inset,.7,palette?.frame);if(v.recording||v.camera==='on'||v.layout==='camera'){const sec=Math.max(0,(f.wallNowMs-(v.recordingStarted??f.wallNowMs))/1000);txt(c,v.recording?`● REC ${format(sec)}`:t('scene.localOnly'),inset.x+12,inset.y+inset.h-6,12,v.recording?'#ffb3a2':WHITE)}
 if(portrait)c.restore();
 }
 // Each genuine input event keeps a stable height and flows left with its timestamp.
 const pulseRect=geometry.metrics;const dockedFlow=!!geometry.practiceCompact&&portrait;c.save();c.translate(pulseRect.x,pulseRect.y);c.scale(pulseRect.w/309,pulseRect.h/168);frame(c,{x:0,y:0,w:309,h:168},.34,palette?.frame);line(c,14,27,34,27,tone,5.5);txt(c,t('hud.flow').toUpperCase(),49,32,portrait?11/(pulseRect.w/309):15,'#d8e6e1',500);const count=f.replay||f.restoreFailed?'—':String(f.input.commits10s),countSize=Math.min(dockedFlow?32:36,92/(count.length*.62));c.save();c.font=`600 ${countSize}px ${STUDIO_SEMIBOLD}`;const countW=c.measureText(count).width,labelX=Math.min(220,Math.max(dockedFlow?64:75,16+countW+10));c.restore();txt(c,count,16,dockedFlow?78:75,countSize,WHITE,600,'left',STUDIO_SEMIBOLD);if(portrait&&!standby&&count.length<=3){const unit=10/(pulseRect.w/309);txt(c,t('scene.committedEvents').toUpperCase(),labelX,64,unit,WHITE,400,'left',STUDIO_SANS,298-labelX);txt(c,'/ 10s',labelX,84,unit,WHITE,400,'left',STUDIO_SANS,298-labelX)}else txt(c,standby?'':count.length>3?t('scene.events'):`${t('scene.committedEvents').toUpperCase()} / 10s`,labelX,73,15,WHITE,400,'left',STUDIO_SANS,298-labelX);line(c,12,138,300,138,'#9debe655');
 const bars=eventBars(f.input.pulses,hudNow,10000);c.save();c.beginPath();c.rect(12,92,288,56);c.clip();
 for(const bar of bars){const x=12+bar.position*288,height=5+bar.amplitude*35;c.globalAlpha=.2+.65*bar.position;c.fillStyle=tone;c.beginPath();c.roundRect(x-1.2,138-height,2.4,height,1.2);c.fill();if(!v.reducedMotion&&!f.input.frozen&&bar.ageMs<450){c.save();c.globalAlpha*=.45*(1-bar.ageMs/450);c.shadowColor=tone;c.shadowBlur=6;c.beginPath();c.roundRect(x-2,138-height-1,4,height+2,2);c.fill();c.restore()}}
 c.restore();c.restore();

 // No video-overlay caption capsule. Assisted reference lives only in the typing card
 // (Assisted · Show → pale remainder + word rails). Dictation clears referenceGuide.
 // `showSubtitle` stays fixture/legacy for paintScene — never a transparent-stage path.
 // One complete native editing card; the recording uses its browser-measured
 // lines, selection and scroll offsets. No wrapping alters the actual draft.
 const card=geometry.inputCard,header=inputHeaderControls(card);
 const activeReward=feedback&&feedback.attemptId===v.rewardAttemptId&&now-v.rewardAt>=0&&now-v.rewardAt<1300;
 // Mode controls use native DOM; the recorded scene carries the same concise label.
 if(!v.listeningDisplay?.active)txt(c,v.referenceGuideUnavailable?t('scene.referenceUnavailable'):v.referenceGuide?t('scene.referenceActionCompact'):t('scene.dictationActionCompact'),header.reference.x,card.helper.y+card.helper.h*.75,Math.max(12,12/card.cssScale),'#c8d8d2');
 if(listening){if(!listening.hidden)paintInputText(c,card,{...v,draft:listening.text,caret:listening.text.length,selectionEnd:listening.text.length,inputFocused:false,composition:false,nativeInputDisplay:undefined,inputGuide:undefined,referenceGuide:undefined,scrollLeft:0,scrollTop:0});paintPassiveKeyboard(c,card,{visible:v.keyboardFeedback?.visible!==false,codes:listening.hidden||!listening.targetKey?[]:[listening.targetKey],committedUntil:0,composing:false},now,v.reducedMotion)}else{paintInputText(c,card,{...v,checkedAttempt:feedback});paintPassiveKeyboard(c,card,v.keyboardFeedback,now,v.reducedMotion)}
 const status=m.kind!=='demo'?`${t('hud.localPreview')} · ${t('hud.noReference')}`:v.paused?t('hud.paused'):'';
 const button=card.submit;if(!listening){
  // Bare line-art Enter/Return — same weight as keyboard/settings HudGlyph (no plate/circle).
  const cx=button.x+button.w/2,cy=button.y+button.h/2,icon=Math.min(button.w,button.h)*20/44,sw=1.5*icon/20;
  c.save();c.strokeStyle='#edf4ef';c.lineWidth=sw;c.lineCap='round';c.lineJoin='round';c.shadowColor='#06101699';c.shadowBlur=2;c.beginPath();
  if(feedback?.errors===0){c.moveTo(cx-icon*.28,cy);c.lineTo(cx+icon*.28,cy);c.moveTo(cx+icon*.08,cy-icon*.24);c.lineTo(cx+icon*.28,cy);c.lineTo(cx+icon*.08,cy+icon*.24)}
  else{c.moveTo(cx+icon*.26,cy-icon*.34);c.lineTo(cx+icon*.26,cy+icon*.14);c.lineTo(cx-icon*.30,cy+icon*.14);c.moveTo(cx-icon*.12,cy+icon*.14-icon*.16);c.lineTo(cx-icon*.30,cy+icon*.14);c.lineTo(cx-icon*.12,cy+icon*.14+icon*.16)}
  c.stroke();c.restore();
 };
 const statusSize=Math.max(portrait?12:14,12/card.cssScale),statusLineHeight=Math.max(portrait?16:18,16/card.cssScale);
 const feedbackLines=feedback?inputFeedbackLines(feedback,locale):[];
 if(activeReward&&feedback){const old=s?.attempts.filter(item=>item.cueId===feedback.cueId&&item.attemptId!==feedback.attemptId).at(-1),improved=old&&feedback.errors<old.errors;const message=feedback.gain>0?t('scene.confirmedGain',{count:feedback.gain}):improved?t('scene.fewerErrors',{count:old.errors-feedback.errors}):feedback.errors===0?t('scene.complete'):t('scene.checked');
  // Keep errors first; transient reward shares the bounded status line, never the reference control.
  feedbackLines[1]=feedback.errors>0?`${feedbackLines[1]} · ${message}`:message;
 }
 c.save();c.font=`400 ${statusSize}px ${STUDIO_SANS}`;const statusLines=feedback?feedbackLines.map(text=>{while(text.length&&c.measureText(text).width>card.status.w)text=text.slice(0,-1);return{text}}):wrapInputText(status,card.status.w,value=>c.measureText(value).width);c.restore();
 statusLines.slice(0,2).forEach((part,index)=>txt(c,part.text,card.status.x,card.status.y+statusSize+index*statusLineHeight,statusSize,feedback&&feedback.errors>0?'#ff858b':index===1&&activeReward?'#dcffc2':'#eef0e8'));
 // Thin timeline shares the input width. Decoration never touches media time.
 const transportCueIndex=v.listeningDisplay?.active&&Number.isInteger(v.transportCueIndex)?v.transportCueIndex!:(s?.cueIndex??0);
 const duration=v.ready&&Number.isFinite(m.lesson.duration)&&m.lesson.duration>0?m.lesson.duration:0;
 const markers=knownCueMarkers(s?.material.cues??[],duration,m.kind==='demo'&&v.ready);
 const idleTimeline=!!standby&&!f.mediaInteracted&&m.lesson.paused;
 const movement=timelineMotion(now,f.enteredAt,v.reducedMotion||!!f.standbyPaused,idleTimeline,!!f.mediaInteracted);
 const iconScale=Math.max(1,16/(18*card.cssScale)),railScale=(portrait||card.cssScale<1)?1/card.cssScale:1;
 const playX=zones.play.x+zones.play.w/2+movement.playOffsetPx,centerY=zones.play.y+zones.play.h/2;
 c.fillStyle=idleTimeline?tone:WHITE;
 if(!m.lesson.paused&&m.kind!=='image'){c.fillRect(playX-7*iconScale,centerY-9*iconScale,4*iconScale,18*iconScale);c.fillRect(playX+3*iconScale,centerY-9*iconScale,4*iconScale,18*iconScale)}else{c.beginPath();c.moveTo(playX-5*iconScale,centerY-9*iconScale);c.lineTo(playX+9*iconScale,centerY);c.lineTo(playX-5*iconScale,centerY+9*iconScale);c.closePath();c.fill()}
 for(const [z,direction,enabled] of[[zones.previous,-1,markers.some(p=>p.cueIndex===transportCueIndex-1)],[zones.next,1,markers.some(p=>p.cueIndex===transportCueIndex+1)]] as const){const x=z.x+z.w/2;c.save();c.translate(x,centerY);c.scale(iconScale,iconScale);c.translate(-x,-centerY);c.globalAlpha*=enabled?1:.35;line(c,x-direction*4,centerY-7,x+direction*3,centerY,WHITE,1.7);line(c,x+direction*3,centerY,x-direction*4,centerY+7,WHITE,1.7);line(c,x-direction*8,centerY-7,x-direction*8,centerY+7,WHITE,1.4);c.restore()}
 const railLeft=zones.seek.x+geometry.railInset,railWidth=zones.seek.w-geometry.railInset*2,railY=zones.seek.y+(portrait?34:26)*railScale;
 {
  // Premium timeline track (rounded capsule + filled progress).
  const trackH=Math.max(3,3.2*railScale);
  c.save();c.beginPath();c.roundRect(railLeft,railY-trackH/2,railWidth,trackH,trackH);
  c.fillStyle='#d4e7e328';c.fill();c.restore();
  const progress=idleTimeline?movement.progressFraction:duration?clamp(v.playbackTime/duration):0,headX=railLeft+railWidth*progress;
  if(progress>0){c.save();c.beginPath();c.roundRect(railLeft,railY-trackH/2,Math.max(trackH,railWidth*progress),trackH,trackH);c.fillStyle=traceTone;c.globalAlpha=.92;c.fill();c.restore()}
  for(const marker of markers){const x=railLeft+marker.ratio*railWidth,selected=marker.cueIndex===transportCueIndex;line(c,x,railY-(selected?5:3.5),x,railY+(selected?5:3.5),selected?tone:'#d8e6e088',selected?2:1);txt(c,String(marker.cueIndex+1).padStart(2,'0'),x,zones.seek.y+(portrait?53:45)*railScale,Math.max(10,10/card.cssScale),selected?tone:'#c5d2cda0',400,'center')}
  c.save();c.shadowBlur=idleTimeline&&!v.reducedMotion?8:2;c.shadowColor=tone;c.beginPath();c.arc(headX,railY,3.6,0,Math.PI*2);c.fillStyle=idleTimeline?tone:WHITE;c.fill();c.restore();
  const timeLabel=m.kind==='image'?t('scene.imageNoTimeline'):duration?`${format(v.playbackTime)} / ${format(duration)}`:t('scene.mediaWaiting');
  txt(c,timeLabel,railLeft,zones.seek.y+(portrait?13:12)*railScale,Math.max(11,10.5/card.cssScale),'#e8efec',500);txt(c,m.kind!=='demo'?t('scene.noCueMarkers'):'',railLeft+railWidth,zones.seek.y+(portrait?-2:12)*railScale,Math.max(11,10/card.cssScale),MUTED,400,'right');
}
 const speaker=zones.mute.x+zones.mute.w/2;c.save();c.translate(speaker,centerY);c.scale(iconScale,iconScale);c.translate(-speaker,-centerY);c.strokeStyle=WHITE;c.lineWidth=1.7;c.beginPath();c.moveTo(speaker-10,centerY-4);c.lineTo(speaker-5,centerY-4);c.lineTo(speaker+1,centerY-9);c.lineTo(speaker+1,centerY+9);c.lineTo(speaker-5,centerY+4);c.lineTo(speaker-10,centerY+4);c.closePath();c.stroke();if(!v.muted){c.beginPath();c.arc(speaker+1,centerY,8,-.85,.85);c.stroke()}else line(c,speaker-8,centerY-9,speaker+11,centerY+9,WHITE,1.7);c.restore();

 if(projected)mapRect(c,{x:1575,y:845,w:69,h:65},geometry.counter);
 txt(c,String(transportCueIndex+1).padStart(2,'0'),1610,891,28,'#c6d6d5a0',400,'center');frame(c,{x:1575,y:845,w:69,h:65},.25,palette?.frame);if(projected)c.restore();c.restore();c.restore();return presentation.mode;
}
