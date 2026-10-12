import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {NPS_MATERIAL,NPS_COURSE_MEDIA} from './builtin-material';
import {NPS_PLAYBACK_MEDIA} from '../media/nps-playback';
import {createOriginalCourseMediaPool} from '../media/context-bookmark-media';
import {setup,learning,HOST_MEDIA_ORIGIN} from './studio-host-test-fixture';
import {exportStudioSession} from './session-export';

for(const [name,patch] of [
 ['original actual hash presented as variant',{actualSha256:NPS_COURSE_MEDIA.mediaSha256}],
 ['missing playback identity',{playbackVariant:undefined}],
 ['altered playback identity',{playbackVariant:{...NPS_PLAYBACK_MEDIA.playbackVariant,mediaId:'unregistered-variant'}}],
 ['altered playback URL',{playbackVariant:{...NPS_PLAYBACK_MEDIA.playbackVariant,url:'/studio-assets/06-cafe.mp4'}}],
 ['altered expected playback hash',{playbackVariant:{...NPS_PLAYBACK_MEDIA.playbackVariant,mediaSha256:'0'.repeat(64)}}],
] as const)test(`actual NPS host rejects ${name} without changing the saved round`,async t=>{
 const f=await setup(t,{courseSources:true}),old=f.engine.getSnapshot(),bytes=exportStudioSession(old,old.createdAt);
 f.setNpsLease(patch);await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL));
 assert.deepEqual(learning(f.engine.getSnapshot()),learning(old));
 assert.deepEqual(exportStudioSession((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old.createdAt),bytes);
 assert.equal(f.npsAcquired,f.npsReleased);assert.equal(f.video.plays,0);
});

test('actual default source binding and export remain official while playback verifies the independently identified bytes',async t=>{
 const f=await setup(t,{courseSources:true});await f.ctx.startBuiltinPractice(NPS_MATERIAL);
 const lease=f.ctx.originalMediaLease.current;
 assert.equal(lease.mediaId,NPS_COURSE_MEDIA.mediaId);assert.equal(lease.mediaSha256,NPS_COURSE_MEDIA.mediaSha256);
 assert.equal(lease.actualSha256,NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256);
 assert.notEqual(lease.actualSha256,lease.mediaSha256);assert.deepEqual(lease.playbackVariant,NPS_PLAYBACK_MEDIA.playbackVariant);
 const snapshot=f.engine.getSnapshot();assert.deepEqual(snapshot.material,NPS_MATERIAL);
 const exported=exportStudioSession(snapshot,snapshot.createdAt);
 assert.match(exported.json,new RegExp(NPS_COURSE_MEDIA.mediaSha256));
 assert.equal(exported.json.includes(NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256),false,'Material export claims only the original reference, not which representation was played');
});

test('original bytes returned at the registered variant URL cannot silently pass the variant hash or reset the old round',async t=>{
 const f=await setup(t,{courseSources:true}),old=learning(f.engine.getSnapshot()),urls:string[]=[],revoked:string[]=[];
 const blob=new Blob([await readFile(new URL('../../public/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',import.meta.url))],{type:'video/mp4'});
 f.ctx.npsMediaPool=createOriginalCourseMediaPool({origin:HOST_MEDIA_ORIGIN,fetch:async url=>{urls.push(url);return{ok:true,url:HOST_MEDIA_ORIGIN+NPS_PLAYBACK_MEDIA.playbackVariant.url,redirected:false,type:'basic' as const,headers:new Headers({'Content-Type':'video/mp4'}),blob:async()=>blob}},
 digest:bytes=>webcrypto.subtle.digest('SHA-256',bytes),createObjectURL:()=> 'blob:wrong-original',revokeObjectURL:url=>revoked.push(url)},NPS_PLAYBACK_MEDIA);
 await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL),/校验不匹配/);
 assert.deepEqual(urls,[HOST_MEDIA_ORIGIN+NPS_PLAYBACK_MEDIA.playbackVariant.url]);assert.deepEqual(revoked,['blob:wrong-original']);
 assert.deepEqual(learning(f.engine.getSnapshot()),old);assert.equal(f.video.plays,0);
});
