export type EstimateReader=()=>Promise<{usage?:number;quota?:number}>;
export interface CapacityAssessment{
 readonly status:'unknown'|'ok'|'low';readonly reason:'not-checked'|'unsupported'|'failed'|'timeout'|'invalid'|null;
 readonly checking:boolean;readonly checkedAt:number|null;readonly remainingBytes:number|null;readonly remainingRatio:number|null;readonly estimatedSeconds:number|null;readonly message:string;
}
export const INITIAL_CAPACITY:CapacityAssessment=Object.freeze({status:'unknown',reason:'not-checked',checking:false,checkedAt:null,remainingBytes:null,remainingRatio:null,estimatedSeconds:null,message:'尚未估算本机容量。'});
export interface CapacityConfig{reader?:EstimateReader|null;lowRatio?:number;lowSeconds?:number;timeoutMs?:number;now?:()=>number;onChange?:(value:CapacityAssessment)=>void}
function unavailable(reason:CapacityAssessment['reason'],now:number):CapacityAssessment{return Object.freeze({...INITIAL_CAPACITY,reason,checkedAt:now,message:reason==='unsupported'?'浏览器未提供容量估算，无法提前判断空间。仍可录制；实际写入失败时会停止并保留已有数据。':'当前无法取得可靠容量估算。仍可录制；实际写入失败时会停止并保留已有数据。'})}
export function assessCapacity(value:unknown,bytesPerSecond:number,now:number,lowRatio=.1,lowSeconds=120):CapacityAssessment{
 const{usage,quota}=value&&typeof value==='object'?value as {usage?:unknown;quota?:unknown}:{};if(typeof usage!=='number'||typeof quota!=='number'||!Number.isFinite(usage)||!Number.isFinite(quota)||usage<0||quota<=0||!Number.isFinite(bytesPerSecond)||bytesPerSecond<=0)return unavailable('invalid',now);
 const remainingBytes=Math.max(0,quota-usage),remainingRatio=remainingBytes/quota,estimatedSeconds=remainingBytes/bytesPerSecond,low=remainingRatio<lowRatio||estimatedSeconds<lowSeconds;
 const amount=(remainingBytes/1_000_000).toFixed(1);return Object.freeze({status:low?'low':'ok',reason:null,checking:false,checkedAt:now,remainingBytes,remainingRatio,estimatedSeconds,message:low?`空间估计偏低：约剩${amount} MB。可继续录制，或停止并保存；估计不保证实际可用空间。`:`估计剩余约${amount} MB。浏览器可能调整配额，这不是保存成功或保留七天的保证。`});
}
/** Read-only estimates. Never requests persistence, removes records or stops recording. */
export class CapacityMonitor{
 private readonly reader:EstimateReader|null;private readonly lowRatio:number;private readonly lowSeconds:number;private readonly timeoutMs:number;private readonly now:()=>number;private readonly onChange:(value:CapacityAssessment)=>void;
 private snapshot=INITIAL_CAPACITY;private generation=0;private disposed=false;private inFlight:Promise<CapacityAssessment>|null=null;
 constructor(config:CapacityConfig={}){const storage=globalThis.navigator?.storage;this.reader=config.reader===undefined?(storage?.estimate?()=>storage.estimate():null):config.reader;this.lowRatio=config.lowRatio??.1;this.lowSeconds=config.lowSeconds??120;this.timeoutMs=config.timeoutMs??1500;this.now=config.now??Date.now;this.onChange=config.onChange??(()=>{});if(!(this.lowRatio>0&&this.lowRatio<=1)||!Number.isFinite(this.lowSeconds)||this.lowSeconds<=0||!Number.isFinite(this.timeoutMs)||this.timeoutMs<=0)throw new TypeError('Invalid capacity thresholds')}
 getSnapshot=()=>this.snapshot;
 private publish(value:CapacityAssessment){this.snapshot=Object.freeze(value);try{this.onChange(this.snapshot)}catch{/* UI observers cannot interrupt recording. */}}
 invalidate(){this.generation++;this.inFlight=null;if(this.snapshot.checking&&!this.disposed)this.publish({...this.snapshot,checking:false})}
 dispose(){this.disposed=true;this.invalidate()}
 refresh(bytesPerSecond:number):Promise<CapacityAssessment>{
  if(this.disposed)return Promise.resolve(this.snapshot);if(this.inFlight)return this.inFlight;
  if(!this.reader){this.publish(unavailable('unsupported',this.now()));return Promise.resolve(this.snapshot)}
  const generation=this.generation;this.publish({...this.snapshot,checking:true});let timer:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('estimate-timeout')),this.timeoutMs)});
  const operation=Promise.race([Promise.resolve().then(()=>this.reader!()),timeout]).then(value=>assessCapacity(value,bytesPerSecond,this.now(),this.lowRatio,this.lowSeconds)).catch(error=>unavailable(error instanceof Error&&error.message==='estimate-timeout'?'timeout':'failed',this.now())).then(result=>{if(!this.disposed&&generation===this.generation)this.publish(result);return this.snapshot}).finally(()=>{clearTimeout(timer);if(this.inFlight===operation)this.inFlight=null});
  this.inFlight=operation;return operation;
 }
}
