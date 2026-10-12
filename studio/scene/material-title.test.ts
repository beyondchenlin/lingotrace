import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {TrainingEngine, type TrainingSnapshot} from '../core/training';
import {NPS_MATERIAL} from '../core/builtin-material';
import {materialStageTitle} from './material-title';
import {paintScene, type SceneMedia, type SceneVisual} from './renderer';
import {paintTransparentScene, type TransparentSceneFrame} from './transparent-renderer';
import {STUDIO_SANS} from './fonts';

const coffee = new TrainingEngine().getSnapshot();
const nps = new TrainingEngine({material:NPS_MATERIAL}).getSnapshot();
const media = {lesson:{readyState:0,paused:true,duration:72},camera:{readyState:0},poster:{complete:false},
  image:{complete:false},reference:{complete:false},kind:'demo',name:'fixture'} as unknown as SceneMedia;
const frame: TransparentSceneFrame = {input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},
  enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:false};
function view(snapshot: TrainingSnapshot | null, renderTime: number): SceneVisual {
  return {layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',
    recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,
    caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,
    ready:true,playbackTime:0,playbackDuration:72,renderTime,snapshot};
}

test('title identifies only the exact registered NPS profile and retains the coffee/default text', () => {
  assert.equal(materialStageTitle(nps), 'NPS · CONNIE LAU');
  assert.equal(materialStageTitle(structuredClone(nps)), 'NPS · CONNIE LAU');
  for (const snapshot of [coffee, null, undefined,
    {...nps,schemaVersion:coffee.schemaVersion},
    {...nps,material:{...nps.material,id:'nps-another-material'}},
    {...coffee,material:{...coffee.material,title:'NPS · CONNIE LAU'}},
  ]) assert.equal(materialStageTitle(snapshot), 'CAFE CONVERSATION');
});

type Skin = 'classic' | 'transparent' | 'portrait';
function captureTitle(skin: Skin, snapshot: TrainingSnapshot | null, renderTime = 1200, kind: SceneMedia['kind'] = 'demo') {
  const canvas = createCanvas(skin === 'portrait' ? 430 : 1672, skin === 'portrait' ? 1080 : 941);
  const ctx = canvas.getContext('2d'), original = ctx.fillText.bind(ctx);
  const titles: {text:string;paint:object}[] = [];
  ctx.fillText = ((text:string,x:number,y:number,maxWidth?:number) => {
    if (['NPS · CONNIE LAU','CAFE CONVERSATION','LOCAL MEDIA'].includes(text)) {
      const t = ctx.getTransform();
      titles.push({text,paint:{x,y,maxWidth,font:ctx.font,fill:ctx.fillStyle,align:ctx.textAlign,
        baseline:ctx.textBaseline,tracking:ctx.letterSpacing,alpha:ctx.globalAlpha,
        shadow:[ctx.shadowColor,ctx.shadowBlur,ctx.shadowOffsetX,ctx.shadowOffsetY],
        transform:[t.a,t.b,t.c,t.d,t.e,t.f]}});
    }
    original(text,x,y,maxWidth);
  }) as typeof ctx.fillText;
  const state = view(snapshot, renderTime), sources = {...media,kind};
  const before = JSON.stringify({state,sources,frame});
  if (skin === 'classic') paintScene(canvas as unknown as HTMLCanvasElement, sources, state);
  else paintTransparentScene(canvas as unknown as HTMLCanvasElement, sources, state, frame, skin === 'portrait');
  assert.equal(JSON.stringify({state,sources,frame}), before, 'painting does not change learning, media or frame state');
  assert.equal(titles.length, 1);
  return titles[0];
}

for (const skin of ['classic','transparent','portrait'] as const) {
  test(`${skin} paints the NPS title using the unchanged coffee font, position, anchor and entrance`, () => {
    for (const time of [0,220,1200]) {
      const original = captureTitle(skin, coffee, time), actual = captureTitle(skin, nps, time);
      assert.equal(original.text, 'CAFE CONVERSATION');
      assert.equal(actual.text, 'NPS · CONNIE LAU');
      assert.deepEqual(actual.paint, original.paint);
      assert.equal((actual.paint as {x:number}).x, skin === 'classic' ? 835 : 836);
      assert.equal((actual.paint as {y:number}).y, skin === 'classic' ? 31 : 70);
      assert.equal((actual.paint as {font:string}).font, `400 ${skin === 'classic' ? 15 : 29}px ${STUDIO_SANS}`);
      assert.equal((actual.paint as {align:string}).align, 'center');
    }
  });
  test(`${skin} retains existing null-snapshot and unbound-local titles`, () => {
    assert.equal(captureTitle(skin, null).text, 'CAFE CONVERSATION');
    for (const kind of ['video','image'] as const) {
      assert.equal(captureTitle(skin, nps, 1200, kind).text, skin === 'classic' ? 'CAFE CONVERSATION' : 'LOCAL MEDIA');
    }
  });
}
