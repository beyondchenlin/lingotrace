/** Use only the native browser API. Never emulate a successful transition. */
export async function toggleElementFullscreen(doc:Pick<Document,'fullscreenElement'|'fullscreenEnabled'|'exitFullscreen'>,element:HTMLElement|null):Promise<boolean>{
 if(doc.fullscreenElement){
  if(typeof doc.exitFullscreen!=='function')throw Error('Fullscreen exit is unavailable.');
  await doc.exitFullscreen();
  if(doc.fullscreenElement)throw Error('The browser did not exit fullscreen.');
  return false;
 }
 if(!element||doc.fullscreenEnabled===false||typeof element.requestFullscreen!=='function')throw Error('Fullscreen is unavailable in this browser.');
 await element.requestFullscreen();
 if(doc.fullscreenElement!==element)throw Error('The browser did not enter fullscreen.');
 return true;
}
