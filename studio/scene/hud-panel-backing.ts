import type {Rect} from './layout';
import type {learningGeometry} from './learning-surface';
import {DEFAULT_RECTS} from './transparent-layout';

type Geometry=ReturnType<typeof learningGeometry>;

/** Visible plate bounds, shared by painting and local luminance sampling. */
export function hudBackingRect(content:Rect):Rect{
 return{x:content.x-7,y:content.y-6,w:content.w+14,h:content.h+12};
}

/** Original content bounds still determine the existing decorative gradients. */
export function hudPanelContentRects(geometry:Geometry,camera:Rect):Record<string,Rect>{
 return{goal:geometry.goal,title:geometry.title,trend:geometry.trend,camera,flow:geometry.metrics,typing:geometry.inputCard.card,transport:geometry.player,...geometry.inputCard.keyboard?{keyboard:geometry.inputCard.keyboard}:{}};
}

/** Align the desktop plates without moving their established content/hit anchors.
 * Portrait has a separate stacked title and keeps its existing plate geometry.
 * An explicitly moved flow panel keeps its own horizontal position.
 */
export function hudPanelBackingRects(geometry:Geometry,camera:Rect,contents=hudPanelContentRects(geometry,camera)):Record<string,Rect>{
 const rects=Object.fromEntries(Object.entries(contents).map(([key,content])=>[key,hudBackingRect(content)])),{goal,title,trend,flow}=rects;
 if(!geometry.portrait){
  const top=Math.min(goal.y,title.y,trend.y);
  for(const rect of[goal,title,trend]){rect.h+=rect.y-top;rect.y=top;}
  if(geometry.metrics.x===DEFAULT_RECTS.metrics.x){flow.w+=flow.x-goal.x;flow.x=goal.x;}
 }
 return rects;
}
