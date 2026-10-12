export type PreviewInfo = Readonly<{status:'loading'|'unknown'|'known'|'error'; message:string}>;
export const INITIAL_PREVIEW_INFO:PreviewInfo=Object.freeze({status:'loading',message:'正在读取录像信息…'});

/** Read only the browser's duration. Never infer it from currentTime or wall time. */
export function recordingPreviewInfo(duration:number,ended=false,failed=false):PreviewInfo{
  if(failed)return{status:'error',message:'此浏览器未能预览录像。仍可尝试下载检查文件，不能仅凭预览失败判断文件损坏。'};
  if(Number.isFinite(duration)&&duration>=0)return{status:'known',message:`总时长：${duration.toFixed(2)} 秒（浏览器报告）。`};
  return{status:'unknown',message:ended
    ?'播放已结束，浏览器仍未提供总时长。可下载后在支持的播放器中检查。'
    :'浏览器暂未识别录像总时长。可点击播放查看；播放到结尾后，总时长可能更新。仅凭总时长未知，不能判断文件是否损坏。'};
}
