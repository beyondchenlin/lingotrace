import {fixtureScene,FIXTURE_CLOCK} from '@lingotrace/studio/hud-library/showcase/fixtures.ts';
import type {HudScene} from '@lingotrace/studio/hud-library/schema.ts';
export {FIXTURE_CLOCK};
export function previewScene(type:'progress-ring'|'trend-line'):HudScene{
 const scene=fixtureScene(type),goal=type==='progress-ring',width=goal?260:380,height=250;
 const key=Object.keys(scene.metrics)[0],metric=scene.metrics[key];
 return {...scene,size:{width,height},safeBounds:{x:0,y:0,width,height},nodes:[{...scene.nodes[0],size:{width,height},label:goal?'TARGET':'INPUT TREND',description:goal?'PREVIEW / NOT A RECORD':'PREVIEW / SAMPLE INPUT',style:{colors:{accent:'#c6e9a5',text:'#e7efea',muted:'#a2b6aa',track:'#33483e',guide:'#435447'},font:{family:'Arial',labelSize:14}}}],metrics:{[key]:metric.kind==='progress'?{...metric,numerator:3}:metric}};
}
