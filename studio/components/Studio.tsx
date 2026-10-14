'use client';
import {FixedPaceFinishObserver,type FixedPaceFinishIdentity} from '../core/fixed-pace-finish';
import {TypingFollowHost} from '../media/typing-follow-host';
import {TypingFollowInput} from '../core/typing-follow-input';
import {CAFE_FIXED_PACE_COURSE,createTypingFollowState,qualifyingTypingFollowAppend,typingFollowCourseIdentity,type TypingFollowAppend,type TypingFollowEnvironment,type TypingFollowIntent,type TypingFollowInterrupt,typingFollowAdmission} from '../core/typing-follow-policy';
import {parseCourseQueryParam,parseFollowQueryParam,resolveCourseDeepLink,stripCourseQueryParam,type StudioCourseKind} from '../core/course-deep-link';
import {followStatusNeedsVisibleSurface,resolveFollowDeepLinkSurface} from '../core/follow-recover';
import CheckedAnswerReview from './CheckedAnswerReview';
import {startSceneFrameLoop,resetSceneContext,sceneRenderFailureCode,type SceneRenderPhase} from '../scene/frame-loop';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {StudioLocaleProvider, InterfaceLanguageSettings, useStudioLocale} from '../i18n/react';
import {syncNativeFeedback,applyInputCardLayout,inputCardTextareaStyle,inputGuideMask,inputGuideSummary,defaultKeyboardVisible,type InputUnderlineMode,syncInputViewport,captureNativeInputDisplay,releaseNativeInputDisplay,invalidateNativeInputDisplay} from '../scene/input-card';
import {AnimatePresence,motion} from 'motion/react';
import LayoutEditor from './LayoutEditor';
import ListeningControls from './ListeningControls';
import {HudGlyph,HudPopover} from './HudControls';
import {learningGeometry,fitLearningSurface,inputHeaderControls,learningFocusScroll,DEFAULT_HUD,parseKeyboardPlacement,KEYBOARD_PLACEMENT_STORAGE_KEY,type KeyboardPlacement,type VideoSize,type HudPreferences} from '../scene/learning-surface';
import {editionSurface,readVisualEdition,writeVisualEdition,type StudioVisualEdition} from '../theme/kids-cartoon';
import {toggleElementFullscreen} from '../scene/fullscreen';
import {ReferenceGuideExposure} from '../scene/reference-guide';
import ListeningSessionHistory from './ListeningSessionHistory';
import {useListening} from './useListening';
import {exportListeningPage,listeningAssistanceLabel} from '../core/listening-export';
import LayoutPlanFiles from './LayoutPlanFiles';
import {LayoutTransactions,type LayoutConfiguration} from '../scene/layout-transactions';
import PaceTimeline from './PaceTimeline';
import LegacyHistoryPanel from './LegacyHistoryPanel';
import SegmentHistoryPanel from './SegmentHistoryPanel';
import MutedRecordingCopy from './MutedRecordingCopy';
import WhiteNoiseSettings,{useWhiteNoiseAudio} from './WhiteNoiseSettings';
import VideoPaletteSettings,{useVideoPalette} from './VideoPaletteSettings';
import SubmissionSoundSettings,{useSubmissionAudio} from './SubmissionSoundSettings';
import TypingErrorSettings,{useTypingErrorFeedback} from './TypingErrorSettings';
import {hasNewTypingError} from '../scene/typing-error-cues';
import {CourseAudioRouting} from '../media/course-audio-routing';
import RecordCalendarPanel from './RecordCalendarPanel';
import RoundReview from './RoundReview';
import ReviewTaskComposer from './ReviewTaskComposer';
import ReviewTaskPanel,{type ReviewTaskRow} from './ReviewTaskPanel';
import {buildReviewTarget,reviewSame,type ReviewTarget,type ReviewSessionBinding} from '../core/review-tasks';
import type {ReviewDueTime} from '../core/review-due-time';
import {reviewAttemptSource} from '../core/review-task-source';
import ContextBookmarkComposer from './ContextBookmarkComposer';
import ContextBookmarkLibrary from './ContextBookmarkLibrary';
import MaterialCorrectionPanel,{type MaterialCorrectionTarget,type MaterialCorrectionSaveInput} from './MaterialCorrectionPanel';
import {IndexedDBLocalReferenceRepository} from '../core/local-reference-repository';
import {buildLocalReferenceStructureProposal,buildLocalReferenceProposal,canonicalLocalReferenceJSON,LOCAL_REFERENCE_MEDIA_ID,LOCAL_REFERENCE_MEDIA_SHA256,type LocalReferenceReceipt} from '../core/local-reference';
import {flushReferenceTransition,assertReferenceTransitionBoundary} from '../core/reference-transition';
import {correctedReferenceMediaError} from '../media/corrected-reference-media';
import {fixedReviewDurationMatches,fixedReviewTargetMatches,reviewMediaDiagnostic,reviewDurationDiagnostic,reviewRangeDiagnostic,type PreparedReviewMedia} from '../media/fixed-review-media';
import {projectAttemptReferenceExposure} from '../core/reference-exposure';
import {getBookmarkReference} from '../core/context-bookmark';
import {IndexedDBContextBookmarkRepository} from '../core/context-bookmark-repository';
import {createOriginalCourseMediaPool,createContextBookmarkPreviewController,isExactNativeAACError,isVerifiedCourseMediaLease,ORIGINAL_COURSE_MEDIA,type OriginalCourseMediaLease} from '../media/context-bookmark-media';
import {NPS_PLAYBACK_MEDIA} from '../media/nps-playback';
import {roundReviewCueIndex} from '../core/round-review';
import {TrainingHistoryRecorder,type TrainingHistoryRecorderStatus} from '../core/training-history-recorder';
import {readDefaultCourseBootstrap} from '../core/default-course-bootstrap';
import {bindTrainingTabRecovery,readReferenceVisibility,saveReferenceVisibility} from '../core/training-tab-recovery';
import {CompositionInputTail} from '../core/native-input-evidence';
import {isPracticePaused,setWholePracticePaused} from '../core/practice-pause';
import{exportStudioSession as exportSession}from'../core/session-export';
import{parseArrangement,rectStyle,insetRect,SPLIT_INSET,type Arrangement}from'../scene/transparent-layout';
import{getDraftFeedback}from'../core/draft-feedback';
import {TrainingEngine,hasScorableReference,getCurrentResult,getDraft,deriveCurves,replay,type TrainingSnapshot,type Attempt,type Material,CAFE_MATERIAL} from '../core/training';
import {NPS_MATERIAL,NPS_COURSE_MEDIA,builtinCourseForMaterial,isBuiltinMaterial} from '../core/builtin-material';
import {IndexedDBTrainingRepository,type PersistenceStatus} from '../core/repository';
import {paintScene as paintReferenceScene,DESIGN,ZONES as LEGACY_ZONES,type SceneMedia,type SceneVisual,type SceneLayout} from '../scene/renderer';
import {insetRect as legacyInsetRect} from '../scene/layout';
import {paintTransparentScene,readHudContrastStatus,TRANSPARENT_VERSION} from '../scene/transparent-renderer';
import {ZONES as TRANSPARENT_ZONES,cueMarkerRect,timelinePointerProgress} from '../scene/transparent-layout';
import {TransparentInputProjector} from '../scene/transparent-input';
import {PageInputGate} from '../scene/transparent-presentation';
import {sampleStandbyEnergy} from '../scene/standby-energy';
import {StandbyAudio} from '../media/standby-audio';
import {responsiveLayout,resolvePortraitHeight} from '../scene/responsive-layout';
import {cameraControlGeometry} from '../scene/camera-control';
import {parsePortraitArrangement} from '../scene/responsive-editor';
import {resolveStudioViewport,type StudioViewportState} from '../scene/studio-viewport';
import {knownCueMarkers,nearestCueMarker,mediaShortcut} from '../scene/transparent-timeline';
import {SceneRecorder,isNewRecordingTerminal,type RecordMeta,type SceneRecorderSnapshot} from '../media/scene-recorder';
import{INITIAL_CAPACITY}from'../media/storage-capacity';
import{recordingFailureMessage}from'../media/recording-error-message';
import{INITIAL_PREVIEW_INFO,recordingPreviewInfo}from'../media/recording-preview-status';
import{RecordingInputResources,RecordingPreparationCanceled}from'../media/recording-input-resources';
const icons={play:'m8 4 12 8-12 8Z',pause:'M8 4v16M16 4v16',folder:'M3 5h7l3 3h8v12H3Z',layout:'M3 3h18v18H3ZM3 9h18M14 9v12',chart:'M3 3v18h18M7 15l5-6 4 3 5-7',record:'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM9 9h6v6H9Z',camera:'M3 7h13v13H3ZM16 11l5-3v11l-5-3',caption:'M3 5h18v14H3ZM6 10h4M6 14h4M14 10h4M14 14h4',full:'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',volume:'M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8',close:'m5 5 14 14M19 5 5 19',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',replay:'M4 9a8 8 0 1 1 0 6M4 3v6h6',more:'M5 12h.1M12 12h.1M19 12h.1',hint:'M9 18h6M10 21h4M12 3a6 6 0 0 1 3.6 10.8c-.9.7-1.4 1.5-1.5 2.7h-4.2c-.1-1.2-.6-2-1.5-2.7A6 6 0 0 1 12 3Z'};
function Icon({name}:{name:keyof typeof icons}){return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]}/></svg>}
const initialRecorder:SceneRecorderSnapshot={state:'idle',recordingId:null,startedAt:null,bytes:0,error:null,warning:null,audioLabel:'无音频',capacity:INITIAL_CAPACITY};
function download(name:string,blob:Blob){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}
function fmt(ms:number){return `${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`}
// UI-only provenance: never stored on the underlying Attempt or history snapshot.
type SubmissionFeedback=Attempt&{announcement?:{kind:'firstCompletion'|'correct'|'correction';total:number;locale:string}};
type Panel='media'|'layout'|'camera'|'record'|'library'|'review'|'data'|'settings'|'history'|'bookmarks'|'references'|'reference-confirm'|'review-tasks'|'hint'|null;
export default function Studio({responsive=false}:{responsive?:boolean}){
 return <StudioLocaleProvider><StudioContent responsive={responsive}/></StudioLocaleProvider>;
}
function StudioContent({responsive=false}:{responsive?:boolean}){
 const {locale,t,ui}=useStudioLocale();
 const localeRef=useRef(locale);localeRef.current=locale;
 const [originalMediaPool]=useState(()=>createOriginalCourseMediaPool());
 const [npsMediaPool]=useState(()=>createOriginalCourseMediaPool({},NPS_PLAYBACK_MEDIA));
 const [courseChoice,setCourseChoice]=useState<'nps'|'cafe'|null>(null),[courseIntent,setCourseIntent]=useState<StudioCourseKind|null>(null),[courseError,setCourseError]=useState(''),[builtinMediaReady,setBuiltinMediaReady]=useState(false);
 const [followDeepLink,setFollowDeepLink]=useState(false),[followDeepLinkDismissed,setFollowDeepLinkDismissed]=useState(false);
 const courseLoadRequest=useRef(0),courseSwitchRef=useRef<{action:number;committed:boolean;abort:AbortController}|null>(null);
 function coursePool(material:Material){return builtinCourseForMaterial(material)?npsMediaPool:originalMediaPool}
 function strictCourse(material:Material){return !!material.localReference||!!material.builtinReference}
 function prepareCoursePoster(material:Material){const media=mediaRef.current;if(!media)return;const poster=new Image();if(!material.builtinReference)poster.src='/studio-assets/06-cafe-poster.jpg';media.poster=poster}
 const originalMediaLease=useRef<OriginalCourseMediaLease|null>(null),originalMediaRequest=useRef<AbortController|null>(null);
 const bookmarkRepository=useRef<IndexedDBContextBookmarkRepository|null>(null),bookmarkPreviewRef=useRef<ReturnType<typeof createContextBookmarkPreviewController>|null>(null);
 const[bookmarkMediaReady,setBookmarkMediaReady]=useState(false);
 const referenceRepositoryRef=useRef<IndexedDBLocalReferenceRepository|null>(null),referencePreviewRef=useRef<ReturnType<typeof createContextBookmarkPreviewController>|null>(null),referenceVerificationRef=useRef<ReturnType<typeof createContextBookmarkPreviewController>|null>(null);
 const referenceTransitionRef=useRef(false),referenceActionRef=useRef(0),referencePanelRef=useRef(false);
 const reviewTransitionRef=useRef(false),reviewActionRef=useRef(0),reviewListRequest=useRef(0),reviewVerifyRequestRef=useRef(0),reviewResultBusy=useRef(false);
 const reviewBindingRef=useRef<ReviewSessionBinding|null>(null),reviewPendingRef=useRef(new Map<string,{attemptId:string;binding:ReviewSessionBinding;action:number}>());
 const reviewVerificationRef=useRef<ReturnType<typeof createContextBookmarkPreviewController>|null>(null),reviewMediaRequestRef=useRef<AbortController|null>(null);
 const reviewMediaRef=useRef<{sessionId:string;materialDigest:string;url:string;target:ReviewTarget}|null>(null);
 const[reviewRows,setReviewRows]=useState<readonly ReviewTaskRow[]>([]),[reviewUnreadable,setReviewUnreadable]=useState(0),[reviewLoading,setReviewLoading]=useState(false),[reviewError,setReviewError]=useState(''),[reviewBusy,setReviewBusy]=useState(false),[reviewTrackingMessage,setReviewTrackingMessage]=useState(''),[reviewPendingCount,setReviewPendingCount]=useState(0),[reviewStartFailure,setReviewStartFailure]=useState('');
 const reviewStartFailureRef=useRef('');reviewStartFailureRef.current=reviewStartFailure;

 const correctedMediaRef=useRef<{identity:string;url:string}|null>(null),correctedPlayRequest=useRef(0),correctedPlayOwner=useRef<{token:number;identity:string;url:string}|null>(null);
 const[referenceEntries,setReferenceEntries]=useState<readonly LocalReferenceReceipt[]>([]),[referenceUnreadable,setReferenceUnreadable]=useState(0),[referenceError,setReferenceError]=useState(''),[referenceBusy,setReferenceBusy]=useState(false);
 const referenceTargetRef=useRef<MaterialCorrectionTarget|null>(null),[referenceTarget,setReferenceTarget]=useState<MaterialCorrectionTarget|null>(null);
 type ReferenceConfirmation={sessionId:string;materialVersion:string;cueId:string;text:string;start:number;end:number;exposed:boolean;message:string};
 const referenceConfirmationRef=useRef<ReferenceConfirmation|null>(null),[referenceConfirmation,setReferenceConfirmation]=useState<ReferenceConfirmation|null>(null);
 function referenceRepository(){return referenceRepositoryRef.current??=new IndexedDBLocalReferenceRepository({original:CAFE_MATERIAL})}
 function referenceBlocked(){return referenceTransitionRef.current||!!referenceConfirmationRef.current||reviewTransitionRef.current||!!reviewStartFailureRef.current}
 function sameMaterial(a:Material,b:Material){return canonicalLocalReferenceJSON(a)===canonicalLocalReferenceJSON(b)}
 function currentCorrectedMediaError(){const material=engineRef.current?.getSnapshot().material,video=lessonRef.current;if(material?.builtinReference)return reviewMediaRef.current?reviewMediaError(reviewMediaRef.current.target):'所选真人课程尚未按固定来源核验。';if(!material?.localReference)return null;if(!video||correctedMediaRef.current?.identity!==JSON.stringify(material))return '校正版本的本机引用或原片尚未核验。';return correctedReferenceMediaError(material,originalMediaLease.current,video)}

 function builtinAnswerBlocked(){return !!engineRef.current?.getSnapshot().material.builtinReference&&!!currentCorrectedMediaError()}

 function contextRepository(){return bookmarkRepository.current??=new IndexedDBContextBookmarkRepository()}
 function bookmarkRecordingBlocked(){return recordPreparing.current||['recording','stopping'].includes(recorderRef.current?.getSnapshot().state??'idle')}
 function releaseOriginalMedia(){cancelFollow('course-change',true);if(!disposed.current)setBuiltinMediaReady(false);reviewMediaRef.current=null;correctedMediaRef.current=null;correctedPlayRequest.current++;correctedPlayOwner.current=null;originalMediaRequest.current?.abort();originalMediaRequest.current=null;originalMediaLease.current?.release();originalMediaLease.current=null;if(!disposed.current)setBookmarkMediaReady(false)}
 const [pacingStrategy,setPacingStrategy]=useState<'fixed'|'adaptive'>('fixed'),pacingStrategyRef=useRef<'fixed'|'adaptive'>('fixed');
 const [fixedRate,setFixedRate]=useState(1),fixedRateRef=useRef(1);
 const fixedPaceObserverRef=useRef(new FixedPaceFinishObserver()),fixedPaceInputRef=useRef(new TypingFollowInput()),fixedPaceScopeRef=useRef<FixedPaceFinishIdentity|null>(null);
 const [fixedPaceResult,setFixedPaceResult]=useState<FixedPaceFinishObserver['snapshot']['result']>(null);
 const followNativeEventsRef=useRef(new WeakSet<Event>()),followPauseClickRef=useRef(false);
 const followRef=useRef<TypingFollowHost|null>(null),followInputRef=useRef(new TypingFollowInput());
 // Page-local, one opportunity per deliberately entered cue. Never restored or persisted.
 const followAutoSessionRef=useRef<{engine:TrainingEngine;sessionId:string;offered:Set<string>}|null>(null);
 const followAutoEntryRef=useRef<{engine:TrainingEngine;sessionId:string;cueKey:string;source:string;owner:number;rate:number;position:number;pendingSeek:boolean}|null>(null),followAutoEpochRef=useRef(0);
 const [followAutoArmed,setFollowAutoArmed]=useState(false);
 const [followReady,setFollowReady]=useState(false),followReadyRef=useRef(false);
 const [followView,setFollowView]=useState<{state:ReturnType<typeof createTypingFollowState>;rate:number|null}>({state:createTypingFollowState(),rate:null});
 useEffect(()=>{if(followView.state.active)setFollowDeepLinkDismissed(true)},[followView.state.active]);
 function disarmFollowAutoEntry(){followAutoEntryRef.current=null;if(!disposed.current)setFollowAutoArmed(false)}
 function cancelFollow(reason:TypingFollowInterrupt,internalBoundary=false){
  invalidateFixedPace(reason,reason==='check');
  disarmFollowAutoEntry();
  if(!internalBoundary){
   followAutoEpochRef.current++;
   const engine=engineRef.current,session=followAutoSessionRef.current,snapshot=engine?.getSnapshot();
   if(engine&&snapshot&&session?.engine===engine&&session.sessionId===snapshot.sessionId)session.offered.add(JSON.stringify([snapshot.material.id,snapshot.material.version,engine.cue.id,engine.cue.start,engine.cue.end]));
  }
  followRef.current?.stop(reason);
 }
 const compositionTailRef=useRef(new CompositionInputTail()),interruptedCompositionRef=useRef(false);
 const recordStopRef=useRef<{recorder:SceneRecorder;promise:Promise<void>}|null>(null);
 const[portraitHeight,setPortraitHeight]=useState(1080),portraitHeightRef=useRef(1080);
 const[portrait,setPortrait]=useState(false),[viewportMode,setViewportMode]=useState<'auto'|'portrait'|'landscape'>('auto');
 const viewportStateRef=useRef<StudioViewportState|undefined>(undefined);
 const portraitRef=useRef(false),layoutEditingRef=useRef(false),layoutCacheRef=useRef<{portrait:Arrangement|null;landscape:Arrangement|null}>({portrait:null,landscape:null});
 const layoutStorageKey=(isPortrait:boolean)=>isPortrait?'lingotrace-studio-layout-transparent-v6-portrait':'lingotrace-studio-layout-transparent-v6';
 const canvasRef=useRef<HTMLCanvasElement>(null),lessonRef=useRef<HTMLVideoElement>(null),cameraRef=useRef<HTMLVideoElement>(null),inputRef=useRef<HTMLTextAreaElement>(null),inputViewportRef=useRef<HTMLDivElement>(null),inputCaretPendingRef=useRef(false),seekRef=useRef<HTMLInputElement>(null),stageRef=useRef<HTMLDivElement>(null),dialogRef=useRef<HTMLDialogElement>(null);
 const cameraRequestRef=useRef(false),cameraVideoOwnerRef=useRef<HTMLVideoElement|null>(null),cameraViewportRef=useRef<{width:number;height:number}|undefined>(undefined);
 const[cameraViewport,setCameraViewport]=useState<{width:number;height:number}|undefined>(undefined);
 const engineRef=useRef<TrainingEngine|null>(null),repoRef=useRef<IndexedDBTrainingRepository|null>(null),recorderRef=useRef<SceneRecorder|null>(null),mediaRef=useRef<SceneMedia|null>(null),visualRef=useRef<SceneVisual|null>(null),recordInputRef=useRef<RecordingInputResources|null>(null),activeRecordInputRef=useRef<RecordingInputResources|null>(null),cameraStreamRef=useRef<MediaStream|null>(null),cameraToken=useRef(0),audioRef=useRef<AudioContext|null>(null),courseRoutingRef=useRef<CourseAudioRouting|null>(null),localURL=useRef<string|null>(null),previewURL=useRef<string|null>(null),mediaToken=useRef(0),pendingSeek=useRef<number|null>(null),recordPreparing=useRef(false),recordRequestToken=useRef(0),disposed=useRef(false),life=useRef(0),composing=useRef(false),pasting=useRef(false),saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null),exportRef=useRef<ReturnType<typeof exportSession>|null>(null),lastFocus=useRef<HTMLElement|null>(null),replaySnapshot=useRef<TrainingSnapshot|null>(null);
 const restoredSessionRef=useRef<string|null|undefined>(undefined),presentationStatusRef=useRef<HTMLSpanElement>(null),pageInputGateRef=useRef(new PageInputGate()),restoreFailedRef=useRef(false),mediaInteractedRef=useRef(false),standbyPausedRef=useRef(false),cueDragRef=useRef<{pointerId:number;startX:number;dragging:boolean}|null>(null),suppressCueClickRef=useRef(false),standbyAudioRef=useRef<StandbyAudio|null>(null),soundRequestRef=useRef(0);
 const[soundEnabled,setSoundEnabled]=useState(false);
 const historyRef=useRef<TrainingHistoryRecorder|null>(null),historyBindingPausedRef=useRef(false),historyActionRef=useRef(0),historyPageInactiveRef=useRef(false),historyChannelRef=useRef<BroadcastChannel|null>(null),historyReconcileRef=useRef<()=>Promise<void>>(async()=>{});
 const[historyStatus,setHistoryStatus]=useState<TrainingHistoryRecorderStatus|null>(null),[temporaryHistory,setTemporaryHistory]=useState(false),[historyKind,setHistoryKind]=useState<'complete'|'segments'|'calendar'>('complete'),[newRoundBusy,setNewRoundBusy]=useState(false);
 const recordingPreviewRequest=useRef(0);
 const[mutedRecord,setMutedRecord]=useState<RecordMeta|null>(null);
 const[restoreFailed,setRestoreFailed]=useState(false),[mediaDuration,setMediaDuration]=useState(0),[currentCue,setCurrentCue]=useState(0);
 const inputProjectorRef=useRef<TransparentInputProjector|null>(null),sceneMotionRef=useRef({enteredAt:0,mediaChangedAt:0,mediaLoading:true});
 const layoutImportBusyRef=useRef(false);const[layoutImportBusy,setLayoutImportBusy]=useState(false);
 const layoutTransactionsRef=useRef(new LayoutTransactions()),layoutReturnFocusRef=useRef(false);const[layoutPreview,setLayoutPreview]=useState(false),[layoutUndoAvailable,setLayoutUndoAvailable]=useState(false);
 const arrangementRef=useRef<Arrangement>({});const[arrangement,setArrangement]=useState<Arrangement>({}),[editingLayout,setEditingLayout]=useState(false);
 const sceneFallbackRef=useRef<HTMLDialogElement>(null);
 const[sceneFailure,setSceneFailure]=useState<'recovering'|'failed'|null>(null),[sceneFailureCode,setSceneFailureCode]=useState(''),sceneRenderPhaseRef=useRef<SceneRenderPhase>('context'),sceneFailureRef=useRef(false),frameLoopRef=useRef<ReturnType<typeof startSceneFrameLoop>|null>(null);
 useEffect(()=>{const dialog=sceneFallbackRef.current;if(!dialog)return;if(sceneFailure&&!dialog.open)dialog.showModal();else if(!sceneFailure&&dialog.open)dialog.close()},[sceneFailure]);
 function failSceneRendering(error:unknown,terminal:boolean){cancelFollow('media-error');cancelTypingErrorFeedback();submissionSound.audio.current?.cancel();const code=sceneRenderFailureCode(error,sceneRenderPhaseRef.current);sceneFailureRef.current=true;setSceneFailure(terminal?'failed':'recovering');setSceneFailureCode(code);if(stageRef.current)stageRef.current.dataset.renderError=code;cancelRecordingPreparation();if(['recording','stopping'].includes(recorderRef.current?.getSnapshot().state??''))void stopRecording('画面渲染中断')}
 function recoverSceneRendering(){sceneFailureRef.current=false;setSceneFailure(null);setSceneFailureCode('');if(stageRef.current)delete stageRef.current.dataset.renderError}
 const[fontsReady,setFontsReady]=useState(false);
 useEffect(()=>{if(inputRef.current)invalidateNativeInputDisplay(inputRef.current)},[fontsReady]);
 useEffect(()=>{const invalidate=()=>{if(inputRef.current)invalidateNativeInputDisplay(inputRef.current)};document.fonts.addEventListener('loadingdone',invalidate);return()=>document.fonts.removeEventListener('loadingdone',invalidate)},[]);
 const[keyboardVisible,setKeyboardVisible]=useState(false),keyboardVisibleRef=useRef(false);
 const [inputGuideDescription,setInputGuideDescription]=useState('下划线只根据自己输入的内容显示。');
 const [inputStyle,setInputStyle]=useState('words'),inputStyleRef=useRef('words'),inputGuideOwnerRef=useRef<string|null>(null);
 const keyboardChoiceRef=useRef(false);
 const[recoveryStorageError,setRecoveryStorageError]=useState(false);
 const[referenceVisible,setReferenceVisible]=useState(true),referenceVisibleRef=useRef(true),referenceExposureRef=useRef(new ReferenceGuideExposure());
 const[guideStorageError,setGuideStorageError]=useState(false),guideStorageErrorRef=useRef(false);
 function setReferenceGuideVisible(visible:boolean){
  if(visible){if(followRef.current?.active||fixedPaceScopeRef.current)cancelFollow('show-reference')}
  else cancelFollow('hide-reference');
  try{saveReferenceVisibility(window.sessionStorage,visible)}catch{setRecoveryStorageError(true)}cancelTypingErrorFeedback();referenceVisibleRef.current=visible;setReferenceVisible(visible);setShowSubtitle(visible);if(visualRef.current)visualRef.current.showSubtitle=visible;if(!visible){if(visualRef.current){visualRef.current.referenceGuide=undefined;visualRef.current.inputGuide=undefined;visualRef.current.showSubtitle=false}inputGuideOwnerRef.current=null;if(inputRef.current&&engineRef.current)syncNativeFeedback(inputRef.current,getDraftFeedback(engineRef.current.getSnapshot(),inputRef.current.value,composing.current).attempt,undefined,composing.current);setInputGuideDescription('Reference hidden. Your input only.')}}
 useEffect(()=>{
  try{
    const params=new URLSearchParams(window.location.search);
    const wantDictation=params.get('dictation')==='1';
    const wantKids=params.get('edition')==='kids';
    const wantFollow=parseFollowQueryParam(params.get('follow'));
    // course=cafe|nps is resolved after history bootstrap (fresh auto-start or restored prompt).
    let visible=readReferenceVisibility(window.sessionStorage);
    if(wantDictation)visible=false;
    else if(wantFollow)visible=true;
    referenceVisibleRef.current=visible;setReferenceVisible(visible);setShowSubtitle(visible);
    if(visualRef.current)visualRef.current.showSubtitle=visible;
    if(wantDictation){try{saveReferenceVisibility(window.sessionStorage,false)}catch{setRecoveryStorageError(true)}}
    else if(wantFollow){try{saveReferenceVisibility(window.sessionStorage,true)}catch{setRecoveryStorageError(true)}}
    if(wantKids){setVisualEdition('kids');writeVisualEdition(window.localStorage,'kids')}
    if(wantFollow){
      pacingStrategyRef.current='adaptive';setPacingStrategy('adaptive');
      setPaceSheetOpen(true);setInputSettingsOpen(false);
      setFollowDeepLink(true);setFollowDeepLinkDismissed(false);
    }
  }catch{referenceVisibleRef.current=false;setReferenceVisible(false);setShowSubtitle(false);if(visualRef.current)visualRef.current.showSubtitle=false;setRecoveryStorageError(true)}
  try{referenceExposureRef.current.attach(window.sessionStorage)}catch{referenceExposureRef.current.attach(null)}
 },[]);
 useEffect(()=>{if(historyStatus&&historyStatus.mode!=='unprepared'&&historyStatus.mode!=='enabling')referenceExposureRef.current.setPersistence(historyStatus.mode==='legacy'||historyStatus.mode==='segment')},[historyStatus?.mode]);
 function applyReferenceGuideExposure(){const e=engineRef.current;if(e)referenceExposureRef.current.apply(e,getDraft(e.getSnapshot()).revealed,getDraft(e.getSnapshot()).hinted)}
 const[inputSettingsOpen,setInputSettingsOpen]=useState(false),[paceSheetOpen,setPaceSheetOpen]=useState(false),[chartExpanded,setChartExpanded]=useState(false),[videoSize,setVideoSize]=useState<VideoSize>('native'),[hudPreferences,setHudPreferences]=useState<HudPreferences>(DEFAULT_HUD),[visualEdition,setVisualEdition]=useState<StudioVisualEdition>('pro'),[softwareKeyboardOpen,setSoftwareKeyboardOpen]=useState(false);
 const[keyboardPlacement,setKeyboardPlacement]=useState<KeyboardPlacement>('inside'),keyboardPlacementRef=useRef<KeyboardPlacement>('inside');
 const[learningViewport,setLearningViewport]=useState<{width:number;height:number}>(),[mediaIntrinsic,setMediaIntrinsic]=useState<{width:number;height:number}>();
 useEffect(()=>{try{const value=parseKeyboardPlacement(localStorage.getItem(KEYBOARD_PLACEMENT_STORAGE_KEY));keyboardPlacementRef.current=value;setKeyboardPlacement(value)}catch{}},[]);
 function chooseKeyboardPlacement(value:string){const next=parseKeyboardPlacement(value);keyboardPlacementRef.current=next;setKeyboardPlacement(next);try{localStorage.setItem(KEYBOARD_PLACEMENT_STORAGE_KEY,next)}catch{notify(t('settings.keyboardNotSaved'))}}
 const softwareKeyboardRef=useRef(false);
 const[fullscreenActive,setFullscreenActive]=useState(false);
 const[contrastStatus,setContrastStatus]=useState<'adaptive'|'fallback'|'waiting'|'letterbox'>('waiting'),contrastStatusRef=useRef(contrastStatus);
 useEffect(()=>{const update=()=>setFullscreenActive(document.fullscreenElement===stageRef.current?.parentElement);document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update)},[]);
 useEffect(()=>{if(visualRef.current){visualRef.current.hudPreferences=hudPreferences;visualRef.current.videoSize=videoSize;visualRef.current.visualEdition=visualEdition}},[hudPreferences,videoSize,visualEdition]);
 useEffect(()=>{setVisualEdition(readVisualEdition(typeof localStorage==='undefined'?null:localStorage))},[]);
 function inputGuideOwner(){const e=engineRef.current;if(!e)return '';const snapshot=e.getSnapshot();return JSON.stringify([snapshot.sessionId,snapshot.material.id,snapshot.material.version,e.cue.id,e.cue.text])}
 function chooseInputStyle(value:string){
  if(!['letters','words','hint-letters','hint-words'].includes(value))return;
  const e=engineRef.current;
  if(value.startsWith('hint-')){if(!referenceVisibleRef.current||!e||referenceBlocked()||builtinAnswerBlocked()||fixture||replaySnapshot.current||mediaKind!=='demo'||paused||composing.current)return;e.exposeHint('hint');if(!getDraft(e.getSnapshot()).hinted)return;inputGuideOwnerRef.current=inputGuideOwner();setInputGuideDescription(inputGuideSummary(inputGuideMask(e.cue.text),localeRef.current));notify(t('notice.guideShown'))}
  else inputGuideOwnerRef.current=null;
  inputStyleRef.current=value;setInputStyle(value);
 }
 function resetExpiredInputGuide(){if(inputGuideOwnerRef.current&&inputGuideOwnerRef.current!==inputGuideOwner()){inputGuideOwnerRef.current=null;const value=inputStyleRef.current.endsWith('words')?'words':'letters';inputStyleRef.current=value;setInputStyle(value)}}
 useEffect(()=>{const input=inputRef.current;if(!input)return;const edited=()=>{inputCaretPendingRef.current=true},selected=()=>{if(document.activeElement===input)edited()};for(const event of ['input','compositionend','focus','select'])input.addEventListener(event,edited);document.addEventListener('selectionchange',selected);return()=>{for(const event of ['input','compositionend','focus','select'])input.removeEventListener(event,edited);document.removeEventListener('selectionchange',selected)}},[]);
 const pressedKeysRef=useRef(new Map<string,number>()),committedUntilRef=useRef(0),compositionEnterRef=useRef(-Infinity),enterIntentRef=useRef({at:-Infinity,shift:false,handled:false});
 function clearKeyboardFeedback(){pressedKeysRef.current.clear();committedUntilRef.current=0}
 function showCommittedInput(){committedUntilRef.current=performance.now()+160;listening.playerRef.current?.nativeInput()}
 function resumePracticeForTyping(){
  // Paused practice used to leave the textarea disabled, so phone OS keyboard / taps
  // could not type. Typing intent resumes practice (timer/recording stay under pauseTraining).
  const engine=engineRef.current;if(!engine||!isPracticePaused(engine)||referenceBlocked())return false;
  setWholePracticePaused(engine,false,{pauseLesson:()=>{},interruptRecording:()=>{}});
  standbyPausedRef.current=false;setPaused(false);if(visualRef.current)visualRef.current.paused=false;engine.activatePractice();
  return true;
 }
 function focusPracticeInput(){
  resumePracticeForTyping();
  const input=inputRef.current;if(!input||input.disabled)return false;
  if(document.activeElement!==input)input.focus({preventScroll:true});
  if(responsive)requestAnimationFrame(()=>ensureInputReachable());
  return document.activeElement===input;
 }
 function toggleKeyboard(){
  // Phone/portrait: native OS keyboard only (focus/blur textarea) — never the in-app QWERTY overlay.
  if(portraitRef.current&&!fixture){
   keyboardChoiceRef.current=true;keyboardVisibleRef.current=false;setKeyboardVisible(false);clearKeyboardFeedback();
   try{localStorage.setItem('lingotrace-input-keyboard-visible','0')}catch{}
   resumePracticeForTyping();
   const input=inputRef.current;if(!input)return;
   if(input.disabled){notify(t('studio.typeEnglish'));return}
   if(softwareKeyboardRef.current||document.activeElement===input){input.blur();return}
   focusPracticeInput();
   return;
  }
  keyboardChoiceRef.current=true;const visible=!keyboardVisibleRef.current;keyboardVisibleRef.current=visible;setKeyboardVisible(visible);clearKeyboardFeedback();try{localStorage.setItem('lingotrace-input-keyboard-visible',visible?'1':'0')}catch{}
 }
 function handleAnswerKeyDown(e:React.KeyboardEvent<HTMLTextAreaElement>){
  prepareTypingErrorFeedback(e.nativeEvent);
  // Only observed native key events can illuminate a keycap. Text input
  // events never invent hardware key order, modifiers, or speed.
  const now=performance.now();
  if(e.nativeEvent.isTrusted&&!e.nativeEvent.isComposing&&!composing.current&&e.code&&e.key!=='Process'&&e.key!=='Unidentified')pressedKeysRef.current.set(e.code,now);
  if(e.key!=='Enter')return;
  enterIntentRef.current={at:now,shift:e.shiftKey,handled:false};
  if(e.nativeEvent.isComposing||composing.current||e.keyCode===229){compositionEnterRef.current=now;return}
  // Some IMEs dispatch compositionend before their confirming Enter keydown.
  if(now-compositionEnterRef.current<80){e.preventDefault();return;}
  if(!e.shiftKey){e.preventDefault();enterIntentRef.current.handled=true;if(!e.repeat)submit(e.nativeEvent.isTrusted)}
 }
 function handleAnswerBeforeInput(native:InputEvent){
  if(native.defaultPrevented||!['insertLineBreak','insertParagraph'].includes(native.inputType)||native.isComposing||composing.current)return;
  const now=performance.now(),intent=enterIntentRef.current;
  if(now-intent.at<250&&intent.shift)return; // Native Shift+Enter keeps its real inputType.
  if(!native.cancelable)return; // Intent never becomes a fabricated committed edit.
  native.preventDefault();
  if(now-compositionEnterRef.current<80||now-intent.at<250&&intent.handled)return;
  enterIntentRef.current={at:now,shift:false,handled:true};submit(native.isTrusted);
 }
 useEffect(()=>{const input=inputRef.current;if(!input)return;const listener=(event:Event)=>{const native=event as InputEvent;handleAnswerBeforeInput(native);captureFixedPaceInput(native,input);if(!native.defaultPrevented&&!native.isComposing&&!composing.current&&prepareFollowInput())followInputRef.current.capture(input.value,{start:input.selectionStart,end:input.selectionEnd},native)};input.addEventListener('beforeinput',listener);return()=>input.removeEventListener('beforeinput',listener)});
 useEffect(()=>{const update=()=>{const isPortrait=portrait||readViewport('auto').portrait;if(isPortrait){keyboardVisibleRef.current=false;setKeyboardVisible(false);try{localStorage.setItem('lingotrace-input-keyboard-visible','0')}catch{}return}if(keyboardChoiceRef.current)return;let stored:string|null=null;try{stored=localStorage.getItem('lingotrace-input-keyboard-visible')}catch{}const visible=defaultKeyboardVisible(matchMedia('(pointer: coarse)').matches||window.innerWidth<=640,false,stored);keyboardVisibleRef.current=visible;setKeyboardVisible(visible)};update();window.addEventListener('orientationchange',update);window.addEventListener('resize',update);return()=>{window.removeEventListener('orientationchange',update);window.removeEventListener('resize',update)}},[portrait]);

 useEffect(()=>{let alive=true;Promise.all(['400 36px "Lingo Studio Mono"','400 45.5px "Lingo Studio Sans"','700 28px "Lingo Studio Sans"','600 90px "Lingo Studio Semibold"'].map(font=>document.fonts.load(font))).then(()=>{if(alive)setFontsReady(true)}).catch(()=>{if(alive){setFontsReady(true);notify('参考字体未完整加载，当前使用替代字体。')}});return()=>{alive=false}},[]);
 const [toolsOpen,setToolsOpen]=useState(false),[ready,setReady]=useState(false),[panel,setPanel]=useState<Panel>(null),[toast,setToast]=useState(''),[layout,setLayout]=useState<SceneLayout>('lesson'),[cameraState,setCameraState]=useState<SceneVisual['camera']>('off'),[cameraDevices,setCameraDevices]=useState<MediaDeviceInfo[]>([]),[selectedCamera,setSelectedCamera]=useState(''),[fixture,setFixture]=useState(false),[reducedMotion,setReducedMotion]=useState(false),[showSubtitle,setShowSubtitle]=useState(true),[paused,setPaused]=useState(false),[result,setResult]=useState<SubmissionFeedback|null>(null),[mediaName,setMediaName]=useState('NPS 真人英语 · 固定参考课程'),[mediaKind,setMediaKind]=useState<'demo'|'video'|'image'>('demo'),[recordState,setRecordState]=useState<SceneRecorderSnapshot>(initialRecorder),[storageReady,setStorageReady]=useState(false),[persistence,setPersistence]=useState<PersistenceStatus|null>(null),[recordings,setRecordings]=useState<RecordMeta[]>([]),[preview,setPreview]=useState<string|null>(null),[previewInfo,setPreviewInfo]=useState(INITIAL_PREVIEW_INFO),[lessonAudio,setLessonAudio]=useState(false),[micAudio,setMicAudio]=useState(false),[startingRecord,setStartingRecord]=useState(false),[reviewSnapshot,setReviewSnapshot]=useState<TrainingSnapshot|null>(null),[replayIndex,setReplayIndex]=useState<number|null>(null),[cameraMessage,setCameraMessage]=useState(''),[storageError,setStorageError]=useState(''),[deleteId,setDeleteId]=useState<string|null>(null),[resetPrompt,setResetPrompt]=useState(false);
 // Entering or leaving a passive presentation must not revive a submitted announcement.
 useEffect(()=>{setResult(current=>current?.announcement?{...current,announcement:undefined}:current)},[fixture,replayIndex,locale]);
 const videoPalette=useVideoPalette(lessonRef,visualRef,reducedMotion);
 const whiteNoise=useWhiteNoiseAudio(reducedMotion);
 const submissionSound=useSubmissionAudio(reducedMotion);
 const[promptAudio,setPromptAudio]=useState(false),[monitorMuted,setMonitorMuted]=useState(false),[courseVolume,setCourseVolume]=useState(.8),[courseMuted,setCourseMuted]=useState(false);
 const monitorPrefs=useRef({allMuted:false,courseMuted:false,volume:.8});
 const typingErrorFeedback=useTypingErrorFeedback(at=>{if(visualRef.current)visualRef.current.typingErrorAt=at},{muted:monitorMuted,reduced:reducedMotion,recording:startingRecord||recordState.state==='recording'||recordState.state==='stopping'});
 function cancelTypingErrorFeedback(){typingErrorFeedback.control.current?.cancel()}
 function typingErrorEligible(){const e=engineRef.current;return !!e&&!document.hidden&&!fixture&&!replaySnapshot.current&&!isPracticePaused(e)&&!referenceBlocked()&&!builtinAnswerBlocked()&&!restoreFailedRef.current&&!layoutEditingRef.current&&!dialogRef.current?.open&&mediaRef.current?.kind==='demo'&&visualRef.current?.ready&&listening.playerRef.current?.getState().mode!=='listen'}
 function prepareTypingErrorFeedback(native:Event){if(native.isTrusted&&typingErrorEligible())typingErrorFeedback.control.current?.prepare(true)}
 function observeTypingError(native:InputEvent|CompositionEvent,before:string,kind:'input'|'compositionend',pasted=false){
  cancelTypingErrorFeedback();const e=engineRef.current;if(!e||!typingErrorEligible()||!referenceVisibleRef.current||visualRef.current?.referenceGuide!==e.cue.text)return;
  if(hasNewTypingError({before,after:e.draft,reference:e.cue.text,trusted:native.isTrusted,kind,inputType:kind==='input'?(native as InputEvent).inputType:null,composing:composing.current||(kind==='input'&&(native as InputEvent).isComposing),pasted}))typingErrorFeedback.control.current?.pulse();
 }

 const listening=useListening({engine:()=>engineRef.current,repository:()=>repoRef.current,lease:()=>originalMediaLease.current,descriptor:()=>engineRef.current?.getSnapshot().material.builtinReference?NPS_PLAYBACK_MEDIA:ORIGINAL_COURSE_MEDIA,
  canEnter:()=>!ready||!fontsReady||restoreFailedRef.current?'请先完成素材和历史准备。':referenceBlocked()||bookmarkRecordingBlocked()||editingLayout||fixture||replaySnapshot.current||composing.current?'请先完成当前编辑、录制或参考操作。':mediaRef.current?.kind!=='demo'?'请选择带固定来源的课程。':currentCorrectedMediaError(),
  beforeListen:(native)=>{cancelFollow('manual-play');correctedPlayRequest.current++;correctedPlayOwner.current=null;lessonRef.current?.pause();inputRef.current?.blur();cancelTypingErrorFeedback();submissionSound.audio.current?.cancel();standbyAudioRef.current?.disable();engineRef.current?.setFrozen('listening',true);setShowSubtitle(false);if(mediaRef.current)mediaRef.current.lesson=native;clearKeyboardFeedback()},
  afterListen:()=>{if(mediaRef.current&&lessonRef.current)mediaRef.current.lesson=lessonRef.current;engineRef.current?.setFrozen('listening',false);if(visualRef.current)visualRef.current.listeningDisplay=undefined},
  monitor:()=>({volume:monitorPrefs.current.volume,muted:monitorPrefs.current.allMuted||monitorPrefs.current.courseMuted}),blocked:()=>isPracticePaused(engineRef.current)||!!dialogRef.current?.open,reducedMotion:()=>visualRef.current?.reducedMotion??false,
  partialSegmentId:()=>{const source=historyRef.current?.getCommittedReviewSession();return source?.kind==='partial'?source.segmentId:null},
  beforeReferenceScope:async()=>{if(saveTimer.current)clearTimeout(saveTimer.current);await historyRef.current?.flush()},
  enterTyping:(index)=>{if(index!==null)changeCue(index,false);engineRef.current?.setFrozen('listening',false);syncDraft()},
 });
 const followRenderRef=useRef({ready,fontsReady});followRenderRef.current={ready,fontsReady};
 function followSourceQualified(){const material=engineRef.current?.getSnapshot().material;try{return !!material&&isBuiltinMaterial(material)&&mediaRef.current?.kind==='demo'&&!currentCorrectedMediaError()}catch{return false}}
 function cafeFixedPaceSourceQualified(){
  const material=engineRef.current?.getSnapshot().material;
  try{
   if(!material||!sameMaterial(material,CAFE_MATERIAL)||mediaRef.current?.kind!=='demo'||currentCorrectedMediaError())return false;
   const lease=originalMediaLease.current;
   return !!lease&&lease.verified===true&&lease.mediaId===CAFE_FIXED_PACE_COURSE.mediaId&&lease.mediaSha256===CAFE_FIXED_PACE_COURSE.mediaSha256&&lease.actualSha256===CAFE_FIXED_PACE_COURSE.mediaSha256;
  }catch{return false}
 }
 function fixedPaceSourceQualified(){return followSourceQualified()||(pacingStrategyRef.current==='fixed'&&cafeFixedPaceSourceQualified())}
 function followReferenceShown(){const engine=engineRef.current;return !!engine&&referenceVisibleRef.current&&!referenceExposureRef.current.unavailable&&referenceExposureRef.current.has(engine.getSnapshot())&&visualRef.current?.referenceGuide===engine.cue.text}
 function followEnvironment():Omit<TypingFollowEnvironment,'rateWriteOwner'>{
  const engine=engineRef.current,snapshot=engine?.getSnapshot(),material=snapshot?.material,cue=engine?.cue;
  const video=lessonRef.current,recording=recorderRef.current?.getSnapshot().state;
  const shown=followReferenceShown();
  const sourceVerified=fixedPaceSourceQualified();
  const identity=typingFollowCourseIdentity(material,cue)??{courseId:material?.id??'',courseVersion:material?.version??'',mediaId:'',mediaSha256:'',sentenceMapVersion:'',sentenceMapSha256:'',cueId:cue?.id??'',cueStartSeconds:cue?.start??NaN,cueEndSeconds:cue?.end??NaN};
  return {nowMs:performance.now(),identity,playbackOwnerId:String(correctedPlayRequest.current),referenceShown:shown,pacingStrategy:pacingStrategyRef.current,fixedRate:fixedRateRef.current,
   mode:replaySnapshot.current?'replay':reviewBindingRef.current?'review':!referenceVisibleRef.current?'dictation':'legacy-typing',listeningPlayerActive:!!listening.playerRef.current?.getState().active,
   recording:recordPreparing.current?'preparing':recording==='recording'||recording==='stopping'?recording:'idle',composing:composing.current,
   focused:document.activeElement===inputRef.current&&document.hasFocus(),visible:!document.hidden,
   practiceActive:!!engine&&!isPracticePaused(engine)&&!engine.isPassiveRestored&&restoredSessionRef.current!==undefined,
   blocked:sceneFailureRef.current||!!followRef.current?.active&&!composing.current&&!followInputRef.current.matches(inputRef.current?.value??'')||disposed.current||!followRenderRef.current.ready||!followRenderRef.current.fontsReady||restoreFailedRef.current||referenceBlocked()||!!dialogRef.current?.open||!!visualRef.current?.fixture||!!replaySnapshot.current||layoutEditingRef.current||layoutTransactionsRef.current.active||!!snapshot?.frozenReasons.some(reason=>['modal','checking','review'].includes(reason)),
   sourceVerified,inputProvenanceAvailable:!!inputRef.current&&'onbeforeinput' in inputRef.current,mediaReady:!!video&&video.readyState>=2&&!video.error,
   mediaDurationSeconds:video?.duration??NaN,mediaPositionSeconds:video?.currentTime??NaN,mediaRate:video?.playbackRate??NaN,draftRevision:followInputRef.current.revision};
 }
 const followContextRef=useRef(followEnvironment);followContextRef.current=followEnvironment;
 const followPlayRef=useRef(toggleCorrectedPlay);followPlayRef.current=toggleCorrectedPlay;
 useEffect(()=>{
  const lesson=lessonRef.current;if(!lesson)return;
  const host=new TypingFollowHost({media:()=>lessonRef.current,context:()=>followContextRef.current(),
   claim:()=>{correctedPlayRequest.current++;correctedPlayOwner.current=null},
   play:(intent,current,prepare,issued,pause)=>followPlayRef.current(false,{intent,current,prepare,issued,pause}),
   release:scope=>{if(String(correctedPlayRequest.current)===scope.ownerId)correctedPlayOwner.current=null;followInputRef.current.clear()},
   changed:(state,rate)=>{observeFixedPaceFollow(state);if(!disposed.current)setFollowView({state,rate})},
   schedule:(callback,ms)=>setTimeout(()=>{observeFixedPaceMedia();callback()},ms),unschedule:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)});
  followRef.current=host;
  const ended=()=>{observeFixedPaceMedia();host.boundary()};lesson.addEventListener('ended',ended);
  const events=['play','playing','pause','seeking','ratechange','waiting','stalled','error','emptied'] as const;
  const listeners=events.map(kind=>{const listener=(event:Event)=>handleFollowNative(kind,event,host);lesson.addEventListener(kind,listener);return()=>lesson.removeEventListener(kind,listener)});
  return()=>{host.dispose();lesson.removeEventListener('ended',ended);listeners.forEach(remove=>remove());if(followRef.current===host)followRef.current=null};
 },[]);
 function armFollowAutoEntry(expectedEpoch:number,newPractice=false){
  const engine=engineRef.current,input=inputRef.current;
  if(expectedEpoch!==followAutoEpochRef.current||!engine||!input||disposed.current||document.hidden||restoreFailedRef.current||restoredSessionRef.current!==null||engine.isPassiveRestored)return;
  const snapshot=engine.getSnapshot(),cueKey=JSON.stringify([snapshot.material.id,snapshot.material.version,engine.cue.id,engine.cue.start,engine.cue.end]);
  if(newPractice)followAutoSessionRef.current={engine,sessionId:snapshot.sessionId,offered:new Set()};
  const session=followAutoSessionRef.current;
  if(!session||session.engine!==engine||session.sessionId!==snapshot.sessionId||session.offered.has(cueKey))return;
  session.offered.add(cueKey);
  const video=lessonRef.current;
  const fixedDictation=pacingStrategyRef.current==='fixed'&&!referenceVisibleRef.current;
  if(!video||!video.paused||!fixedPaceSourceQualified()||(!referenceVisibleRef.current&&!fixedDictation)||reviewBindingRef.current||listening.playerRef.current?.getState().active||isPracticePaused(engine)||input.value!==engine.draft)return;
  followAutoEntryRef.current={engine,sessionId:snapshot.sessionId,cueKey,source:video.currentSrc,owner:correctedPlayRequest.current,rate:video.playbackRate,position:video.currentTime,pendingSeek:video.seeking};
  followInputRef.current.reset(input.value);setFollowAutoArmed(true);
 }
 function followAutoEntryMatches(){
  const token=followAutoEntryRef.current,engine=engineRef.current;if(!token||!engine||engine!==token.engine||engine.isPassiveRestored||restoredSessionRef.current!==null)return false;
  const snapshot=engine.getSnapshot(),video=lessonRef.current;return token.sessionId===snapshot.sessionId&&token.cueKey===JSON.stringify([snapshot.material.id,snapshot.material.version,engine.cue.id,engine.cue.start,engine.cue.end])&&token.source===video?.currentSrc&&token.owner===correctedPlayRequest.current&&!!video.paused&&token.rate===video.playbackRate&&token.position===video.currentTime;
 }
 function handleFollowNative(kind:Parameters<TypingFollowHost['native']>[0],event:Event,host=followRef.current){
  if(!host)return;
  // The actual end of the media can pause before the scheduled cue boundary.
  // Consume only this verified, already-observed terminal owner, never a manual pause.
  const video=lessonRef.current;
  if(kind==='pause'&&video?.ended&&video.paused){observeFixedPaceMedia();if(fixedPaceObserverRef.current.snapshot.phase==='ended'&&fixedPaceFrame()?.eligible&&host.boundary()&&host.snapshot.phase==='ended'){followNativeEventsRef.current.add(event);return}}
  if(['waiting','stalled','error','emptied'].includes(kind))invalidateFixedPace(kind);
  const attributed=host.native(kind,(_scope,currentOwner)=>{if(currentOwner||host.active||!correctedPlayOwner.current)followNativeEventsRef.current.add(event)}),token=followAutoEntryRef.current;
  if(!attributed&&!['waiting','stalled'].includes(kind))invalidateFixedPace('native-'+kind);
  if(!token||attributed||kind==='waiting'||kind==='stalled')return;
  // A deliberately entered cue can still have its own native seek notification queued.
  if(kind==='seeking'&&token.pendingSeek&&followAutoEntryMatches()){token.pendingSeek=false;return}
  cancelFollow(kind==='ratechange'?'manual-rate':kind==='seeking'?'manual-seek':kind==='error'||kind==='emptied'?'media-error':'unattributed-native-event');
 }
 function prepareFollowInput(){
  if(followRef.current?.active)return true;
  if(!followAutoEntryRef.current)return false;
  const environment=followEnvironment();
  if(!followAutoEntryMatches()||!inputRef.current||inputRef.current.disabled||!environment.sourceVerified||!!typingFollowAdmission(environment)||!environment.mediaReady||environment.listeningPlayerActive||environment.recording!=='idle'||environment.composing||!environment.focused||!environment.visible||!environment.practiceActive||environment.blocked||!environment.inputProvenanceAvailable){cancelFollow('unattributed-native-event');return false}
  return true;
 }
 function commitFollowInput(edit:TypingFollowAppend){
  if(followRef.current?.active){followRef.current.input(edit);return}
  const eligible=followAutoEntryMatches();disarmFollowAutoEntry();
  if(eligible&&qualifyingTypingFollowAppend(edit)!==null&&engineRef.current?.draft===edit.after)startFollow(true,edit);
 }
 function startFollow(gesture:boolean,initialEdit?:TypingFollowAppend){
  if(!gesture||!inputRef.current||inputRef.current.disabled)return;
  const environment=followEnvironment();
  if(!environment.sourceVerified||!!typingFollowAdmission(environment)||!environment.mediaReady||environment.listeningPlayerActive||environment.recording!=='idle'||environment.composing||!environment.visible||!environment.practiceActive||environment.blocked||!environment.inputProvenanceAvailable||initialEdit&&!environment.focused)return;
  // This focus is the explicit Start Follow action only; no timer or media event focuses input.
  // Explicitly transfer an ordinary playback timing owner once. The host pauses synchronously
  // and attributes its queued native event before any async source admission.
  if(!followRef.current?.active&&!lessonRef.current?.paused){engineRef.current?.setFrozen('listening',false);engineRef.current?.setFrozen('idle',true)}
  disarmFollowAutoEntry();
  if(!initialEdit){inputRef.current.focus({preventScroll:true});setInputSettingsOpen(false)}
  if(followRef.current?.active)cancelFollow('manual-pause');
  clearFixedPace();
  if(!initialEdit)followInputRef.current.reset(inputRef.current.value);followRef.current?.start(gesture,initialEdit);
  if(pacingStrategyRef.current==='fixed'&&followRef.current?.active)beginFixedPace(initialEdit);
 }
 function fixedPaceFrame(checkedAttempt?:Attempt){
  const engine=engineRef.current,video=lessonRef.current;if(!engine||!video)return null;
  const snapshot=engine.getSnapshot(),env=followEnvironment();
  const identity:FixedPaceFinishIdentity={...env.identity,engine,sessionId:snapshot.sessionId,roundId:snapshot.roundId,ownerId:env.playbackOwnerId,sourceUrl:video.currentSrc};
  const monitor=monitorPrefs.current;
  // Only the exact synchronous Check result may cross its own review freeze.
  // Every other live source/visibility/focus/modal/recording guard stays fresh.
  const checked=!!checkedAttempt&&engine.currentResult===checkedAttempt;
  const blocked=checked?sceneFailureRef.current||disposed.current||!followRenderRef.current.ready||!followRenderRef.current.fontsReady||restoreFailedRef.current||referenceBlocked()||!!dialogRef.current?.open||!!visualRef.current?.fixture||!!replaySnapshot.current||layoutEditingRef.current||layoutTransactionsRef.current.active||inputRef.current?.value!==engine.draft||snapshot.frozenReasons.some(reason=>['modal','checking'].includes(reason)):env.blocked;
  const admitted=!typingFollowAdmission({mode:env.mode,referenceShown:env.referenceShown,pacingStrategy:pacingStrategyRef.current});
  return {identity,nowMs:performance.now(),referenceShown:env.referenceShown,eligible:pacingStrategyRef.current==='fixed'&&admitted&&env.sourceVerified&&!env.listeningPlayerActive&&env.recording==='idle'&&!env.composing&&env.focused&&env.visible&&env.practiceActive&&!blocked&&env.inputProvenanceAvailable&&!monitor.allMuted&&!monitor.courseMuted&&monitor.volume>0&&(!courseRoutingRef.current||audioRef.current?.state==='running')};
 }
 function clearFixedPace(){fixedPaceObserverRef.current.clear();fixedPaceInputRef.current.clear();fixedPaceScopeRef.current=null;if(!disposed.current)setFixedPaceResult(null)}
 function invalidateFixedPace(reason:string,checking=false){
  const observer=fixedPaceObserverRef.current;
  // A checked receipt is immutable until a new draft/mode/run replaces it.
  if(observer.snapshot.phase==='checked'){if(['cue-change','course-change','version-change','unmount','replay','next','composition'].includes(reason))clearFixedPace();return}
  observer.invalidate(checking?'check':reason);
 }
 function beginFixedPace(initialEdit?:TypingFollowAppend){
  const frame=fixedPaceFrame(),engine=engineRef.current,input=inputRef.current;if(!frame||!engine||!input)return;
  const edit=initialEdit?{...initialEdit,beforeRevision:0,afterRevision:1}:undefined;
  fixedPaceInputRef.current.reset(input.value);fixedPaceInputRef.current.revision=edit?1:0;
  fixedPaceScopeRef.current=frame.identity;
  fixedPaceObserverRef.current.begin({...frame,rate:fixedRateRef.current,draft:engine.draft,draftRevision:edit?1:0,inputVersion:getDraft(engine.getSnapshot()).version,...(edit?{initialEdit:edit}:{})});
  observeFixedPaceMedia();
 }
 function captureFixedPaceInput(native:InputEvent,input:HTMLTextAreaElement){
  if(!fixedPaceScopeRef.current||native.defaultPrevented||native.isComposing||composing.current)return;
  fixedPaceInputRef.current.capture(input.value,{start:input.selectionStart,end:input.selectionEnd},native);
 }
 function observeFixedPaceInput(native:InputEvent){
  if(!fixedPaceScopeRef.current)return;
  const frame=fixedPaceFrame(),engine=engineRef.current,input=inputRef.current;if(!frame||!engine||!input){invalidateFixedPace('input-unavailable');return}
  const edit=fixedPaceInputRef.current.commit(input.value,native);
  fixedPaceObserverRef.current.append({...frame,inputVersion:getDraft(engine.getSnapshot()).version,edit});
  if(!disposed.current)setFixedPaceResult(null);
 }
 function observeFixedPaceMedia(){
  const observer=fixedPaceObserverRef.current;if(observer.snapshot.phase!=='observing'&&observer.snapshot.phase!=='ended')return;
  const frame=fixedPaceFrame(),video=lessonRef.current,host=followRef.current;if(!frame||!video||!host){invalidateFixedPace('media-unavailable');return}
  // Initial seek and guarded play settlement are not observed playback yet.
  if(host.snapshot.phase==='starting')return;
  observer.observeMedia({...frame,rate:video.playbackRate,positionSeconds:video.currentTime,paused:video.paused,ended:video.ended,seeking:video.seeking,ready:video.readyState>=2&&!video.error,successfullyPlaying:host.snapshot.phase==='following'});
 }
 function observeFixedPaceFollow(state:ReturnType<typeof createTypingFollowState>){
  const phase=fixedPaceObserverRef.current.snapshot.phase;if(phase!=='observing'&&phase!=='ended')return;
  if(state.phase==='following')observeFixedPaceMedia();
  else if(state.phase==='off')invalidateFixedPace(state.reason??'playback-unavailable');
  else if(state.phase==='ended'&&phase!=='ended')invalidateFixedPace('cue-end-unobserved');
 }
 function checkFixedPace(attempt:Attempt,admission:ReturnType<typeof fixedPaceFrame>){
  if(!fixedPaceScopeRef.current||!admission?.eligible)return;
  const frame=fixedPaceFrame(attempt),engine=engineRef.current;if(!frame||!engine)return;
  const receipt=fixedPaceObserverRef.current.check({...frame,explicit:true,currentAnswer:engine.draft,draftRevision:fixedPaceInputRef.current.revision,inputVersion:getDraft(engine.getSnapshot()).version,attempt});
  if(!disposed.current){setFixedPaceResult(receipt);if(receipt)notify(t('fixed.resultAccuracy',{accuracy:receipt.accuracy,rate:receipt.rate})+' · '+fixedPaceDeltaLabel(receipt));}
 }
 function choosePacingStrategy(value:string){if(value!=='fixed'&&value!=='adaptive')return;cancelFollow('manual-rate');clearFixedPace();pacingStrategyRef.current=value;setPacingStrategy(value)}
 function chooseFixedRate(value:number){if(![.5,.8,1,1.25,1.5].includes(value))return;cancelFollow('manual-rate');clearFixedPace();fixedRateRef.current=value;setFixedRate(value)}
 function fixedPaceDeltaLabel(receipt:NonNullable<FixedPaceFinishObserver['snapshot']['result']>){
  if(receipt.deltaMs!==null)return t(receipt.deltaMs<0?'fixed.resultEarly':'fixed.resultLate',{seconds:Math.abs(receipt.deltaMs/1000).toFixed(1)});
  const reason=receipt.reason??'';
  return t(reason==='answer-incomplete'?'fixed.unknownAnswer':reason==='checked-before-cue-end'||reason==='cue-end-unobserved'?'fixed.unknownEnd':reason.includes('composition')?'fixed.unknownComposition':/input|draft|untrusted|nonempty|edited/.test(reason)?'fixed.unknownInput':/media|play|position|rate|native|waiting|stalled/.test(reason)?'fixed.unknownPlayback':'fixed.unknownInterruption');
 }
 function renderFixedPaceResult(){
  const engine=engineRef.current,scope=fixedPaceScopeRef.current,current=engine?.currentResult;
  if(!fixedPaceResult||fixture||replayIndex!==null||!engine||!scope||scope.engine!==engine||scope.sessionId!==engine.getSnapshot().sessionId||scope.roundId!==engine.getSnapshot().roundId||scope.courseId!==engine.getSnapshot().material.id||scope.courseVersion!==engine.getSnapshot().material.version||scope.cueId!==engine.cue.id||current?.attemptId!==fixedPaceResult.attemptId)return null;
  return <section className="notice" aria-label={t('fixed.resultTitle')}><h3>{t('fixed.resultTitle')}</h3><p>{t(fixedPaceResult.referenceAssisted?'fixed.resultAccuracy':'fixed.resultAccuracyDictation',{accuracy:fixedPaceResult.accuracy,rate:fixedPaceResult.rate})}</p><p>{fixedPaceDeltaLabel(fixedPaceResult)}</p><p className="note">{t('fixed.resultLimits')}</p></section>;
 }
 function applyMonitor(){const currentMonitor=monitorPrefs.current;listening.playerRef.current?.monitor(currentMonitor.volume,currentMonitor.allMuted||currentMonitor.courseMuted);const prefs=monitorPrefs.current,routing=courseRoutingRef.current,video=lessonRef.current;if(routing){routing.setVolume(prefs.volume);routing.setCourseMuted(prefs.courseMuted);routing.setAllMonitorMuted(prefs.allMuted)}else if(video){video.volume=prefs.volume;video.muted=prefs.allMuted||prefs.courseMuted}submissionSound.audio.current?.setMonitorMuted(prefs.allMuted);typingErrorFeedback.control.current?.audio.setMonitorMuted(prefs.allMuted);if(prefs.allMuted)cancelTypingErrorFeedback();whiteNoise.setMonitorMuted(prefs.allMuted);bookmarkPreviewRef.current?.setMonitor(prefs);referencePreviewRef.current?.setMonitor(prefs)}
 function changeMonitorMuted(muted:boolean){monitorPrefs.current.allMuted=muted;setMonitorMuted(muted);applyMonitor()}
 function changeCourseVolume(volume:number){const value=Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):0;monitorPrefs.current.volume=value;monitorPrefs.current.courseMuted=false;setCourseVolume(value);setCourseMuted(false);applyMonitor()}
 function toggleCourseMute(){const muted=!monitorPrefs.current.courseMuted;monitorPrefs.current.courseMuted=muted;setCourseMuted(muted);applyMonitor()}
 async function prepareCourseRouting(){if(!lessonRef.current)throw Error('课程音频尚未准备。');audioRef.current??=new AudioContext();const ac=audioRef.current;courseRoutingRef.current??=new CourseAudioRouting({context:ac,element:lessonRef.current,volume:monitorPrefs.current.volume,courseMuted:monitorPrefs.current.courseMuted,allMonitorMuted:monitorPrefs.current.allMuted});await courseRoutingRef.current.enableFromGesture();return courseRoutingRef.current;}

 function readViewport(mode:'auto'|'portrait'|'landscape'){
  const stage=stageRef.current,page=stage?.parentElement,vv=window.visualViewport;
  const css=page?getComputedStyle(page):null;
  const horizontal=(parseFloat(css?.paddingLeft??'0')||0)+(parseFloat(css?.paddingRight??'0')||0),vertical=(parseFloat(css?.paddingTop??'0')||0)+(parseFloat(css?.paddingBottom??'0')||0),reserved=vertical;
  const focused=document.activeElement instanceof HTMLElement&&!!document.activeElement.closest('input,textarea,select,[contenteditable=true]');
  const next=resolveStudioViewport({layoutViewport:{width:window.innerWidth,height:Math.max(1,window.innerHeight-reserved)},containerWidth:page?Math.max(1,page.clientWidth-horizontal):undefined,visualViewport:vv?{width:vv.width,height:Math.max(1,vv.height-reserved),scale:vv.scale}:undefined,editableFocused:focused,orientationAngle:window.screen.orientation?.angle,previous:viewportStateRef.current,manualMode:mode});viewportStateRef.current=next;softwareKeyboardRef.current=next.keyboardSuppressed;setSoftwareKeyboardOpen(previous=>previous===next.keyboardSuppressed?previous:next.keyboardSuppressed);
  // Only safe-area padding occupies the product shell. Layout controls live in settings.
  const fitBounds={stableWidth:next.stableWidth,stableHeight:next.stableHeight},height=resolvePortraitHeight(Math.round(next.stableHeight*430/next.stableWidth));
  if(height!==portraitHeightRef.current){portraitHeightRef.current=height;setPortraitHeight(height)}
  if(page){const values={'--studio-stable-height':`${fitBounds.stableHeight}px`,'--studio-portrait-width':`${fitBounds.stableWidth}px`};for(const[key,value]of Object.entries(values))if(page.style.getPropertyValue(key)!==value)page.style.setProperty(key,value)}
  if(stage){stage.dataset.availableViewport=`${next.usableWidth.toFixed(2)}x${next.usableHeight.toFixed(2)}`;stage.dataset.layoutViewport=`${next.stableWidth.toFixed(2)}x${next.stableHeight.toFixed(2)}`;stage.dataset.keyboardSuppressed=String(next.keyboardSuppressed)}
  return next;
 }
 const notify=(message:string)=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),4800)};
 const queueSave=()=>{const current=engineRef.current;if(current&&!historyBindingPausedRef.current&&restoredSessionRef.current!==undefined&&!restoreFailedRef.current&&typeof window!=='undefined'&&window.history){const url=new URL(window.location.href),resume=url.searchParams.get('resume');if(resume&&(resume!==current.getSnapshot().sessionId||url.searchParams.has('resumeSequence'))){if(resume!==current.getSnapshot().sessionId)url.searchParams.delete('resume');url.searchParams.delete('resumeSequence');window.history.replaceState(window.history.state,'',url.href)}}if(current){inputProjectorRef.current?.observe(current.getSnapshot(),performance.now());pageInputGateRef.current.observe(current.getSnapshot())}if(!current||historyBindingPausedRef.current||historyPageInactiveRef.current||restoredSessionRef.current===undefined||restoreFailedRef.current)return;if(listening.observe(current.getSnapshot()))return;historyRef.current?.observe(current.getSnapshot());if(saveTimer.current)clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>{void historyRef.current?.flush();},300)};
 async function changeHistoryRecording(enabled:boolean){if(referenceTransitionRef.current||(enabled&&reviewTransitionRef.current))return;if(!enabled){referenceExposureRef.current.setPersistence(false);listening.stopCapture();stopReviewTracking('历史记录已关闭，本轮不再提交复习关联或排期。');}const history=historyRef.current;if(!history||restoreFailedRef.current)return;const request=++historyActionRef.current;if(saveTimer.current)clearTimeout(saveTimer.current);try{if(enabled){if(engineRef.current)history.observe(engineRef.current.getSnapshot());await history.turnOn()}else{const stopping=history.turnOff();if(engineRef.current)history.observe(engineRef.current.getSnapshot());await stopping}if(disposed.current||historyRef.current!==history||request!==historyActionRef.current)return;historyChannelRef.current?.postMessage({type:'settings-changed'});if(history.getSnapshot().error)notify(history.getSnapshot().error!);else if(enabled&&history.getSnapshot().mode==='segment'){notify('已从现在开始记录。当前作答与成绩不变；关闭期间内容不会补录。');queueSave();await listening.readmit()}else notify('本页已停止记录，关闭设置已保存。此浏览器的旧版写入已隔离；旧页面请刷新。录像不受影响。')}catch{if(disposed.current||request!==historyActionRef.current)return;notify('练习历史设置未完成；当前练习仍可继续，请刷新设置后重试。')}}
 async function retryHistorySave(){if(listening.hasScope()){await listening.retry();return}const history=historyRef.current;if(!history)return;await history.flush();const state=history.getSnapshot();notify(state.error??(history.isFreshPreview?'尚未输入，未生成练习记录。':state.mode==='legacy'||state.mode==='segment'?'已保存当前允许记录的内容。':'当前是临时练习，没有补录。'))}
 async function continueSavedHistory(snapshot:TrainingSnapshot){
  const e=engineRef.current,history=historyRef.current,repo=repoRef.current;
  if(!e||!history||!repo||referenceBlocked()||restoreFailedRef.current||composing.current||fixture||replaySnapshot.current||bookmarkRecordingBlocked()||document.hidden){notify('请先结束当前操作，再继续已保存练习。');return}
  if(history.getSnapshot().control?.state!=='legacy-default'||history.getSnapshot().mode!=='legacy'){notify('历史许可已有缺口，不能恢复成完整旧轮。当前临时内容仍保留，可先导出；旧记录仍可查看。');return}
  referenceTransitionRef.current=true;setReferenceBusy(true);const owner=life.current;let navigated=false;
  const current=()=>!disposed.current&&owner===life.current&&engineRef.current===e&&!document.hidden&&!bookmarkRecordingBlocked();
  try{
   await listening.saveScope();const boundary=await flushReferenceTransition({snapshot:e.getSnapshot,history,readControl:()=>repo.readAutomaticHistoryControl(),isCurrent:current,verifyTarget:async()=>{
    const selected=await repo.loadHistorySession(snapshot.sessionId);
    if(!selected||JSON.stringify(selected.snapshot)!==JSON.stringify(snapshot))throw Error('所选记录已变化。请刷新历史后重新选择；当前练习未离开。');
   }});
   assertReferenceTransitionBoundary(boundary,e.getSnapshot(),history.getSnapshot());
   if(!current()||history.getSnapshot().dirty||history.getSnapshot().pendingWrites||history.getSnapshot().error)throw Error('当前练习尚未完成保存，未离开当前轮。请重试保存或主动导出。');
   const url=new URL(window.location.href);url.searchParams.set('resume',snapshot.sessionId);url.searchParams.set('resumeSequence',String(snapshot.sequence));
   window.location.assign(url.href);navigated=true;
  }catch(error){notify(error instanceof Error?error.message:'本次未能继续旧练习，当前轮保留。')}
  finally{if(!navigated){referenceTransitionRef.current=false;if(!disposed.current)setReferenceBusy(false)}}
 }
 async function beginNewRound(gesture=false){if(referenceBlocked()||newRoundBusy)return;cancelFollow('course-change');const followAdmission=followAutoEpochRef.current;try{await listening.beforeTransition()}catch{notify('听力条件尚未保存，请先重试或导出。');return}const selected=engineRef.current?.getSnapshot().material;if(selected?.builtinReference){try{await startBuiltinPractice(selected,gesture,followAdmission)}catch(error){notify(error instanceof Error?error.message:'新轮未能准备。')}return}cancelTypingErrorFeedback();submissionSound.audio.current?.cancel();if(restoreFailedRef.current||historyRef.current?.getSnapshot().mode==='unprepared'||!historyRef.current?.getSnapshot().control){notify('请先重试恢复历史设置，避免覆盖尚未读出的旧记录。');return}setNewRoundBusy(true);const history=historyRef.current,owner=life.current;try{await history?.flush();if(disposed.current||owner!==life.current)return;const status=history?.getSnapshot();if(status?.dirty&&status.error){notify('当前记录尚未保存，请先重试或导出，再开始新一轮。');return}stopReviewTracking();restoredSessionRef.current=null;restoreFailedRef.current=false;setRestoreFailed(false);lessonRef.current?.pause();historyBindingPausedRef.current=true;try{engineRef.current?.resetSession();}finally{historyBindingPausedRef.current=false}if(engineRef.current){pageInputGateRef.current.begin(engineRef.current.getSnapshot());if(status?.control){history?.connect(engineRef.current.getSnapshot(),status.control);if(status.mode==='segment')await history?.turnOn()}}if(disposed.current||owner!==life.current)return;setTemporaryHistory(status?.mode!=='legacy');mediaInteractedRef.current=false;standbyPausedRef.current=false;sceneMotionRef.current.enteredAt=performance.now();sceneMotionRef.current.mediaChangedAt=performance.now();setPaused(false);setShowSubtitle(false);syncDraft();seekTo(0);closePanel();queueSave();if(gesture)armFollowAutoEntry(followAdmission,true)}finally{if(!disposed.current&&owner===life.current)setNewRoundBusy(false)}}

 const syncDraft=()=>{cancelFollow('cue-change',true);cancelTypingErrorFeedback();const e=engineRef.current;if(!e)return;resetExpiredInputGuide();setCurrentCue(e.getSnapshot().cueIndex);if(inputRef.current)inputRef.current.value=e.draft;setResult(getDraftFeedback(e.getSnapshot(),e.draft).attempt);if(visualRef.current){visualRef.current.draft=e.draft;visualRef.current.lastResult=e.currentResult;visualRef.current.gain=0;visualRef.current.rewardAttemptId=null;visualRef.current.message=''}};
 async function setStandbySound(enabled:boolean){const request=++soundRequestRef.current;setSoundEnabled(enabled);if(!enabled){standbyAudioRef.current?.disable();return}try{standbyAudioRef.current??=new StandbyAudio();await standbyAudioRef.current.enable();if(disposed.current||request!==soundRequestRef.current)return;notify('待机声效已开启，仅本机播放；进入真实输入后停止。')}catch(error){if(request!==soundRequestRef.current||disposed.current)return;setSoundEnabled(false);notify(error instanceof Error?`待机声效未开启：${error.message}`:'此浏览器未能开启声效。')}}
 function syncFeedback(){const e=engineRef.current;if(!e)return;const draft=inputRef.current?.value??e.draft;const feedback=getDraftFeedback(e.getSnapshot(),draft,composing.current);setResult(feedback.attempt);if(composing.current&&inputRef.current)syncNativeFeedback(inputRef.current,null,undefined,true);if(visualRef.current){visualRef.current.lastResult=feedback.attempt;visualRef.current.gain=0;visualRef.current.rewardAttemptId=null;visualRef.current.message=''}}
 function seekTo(seconds:number){const video=lessonRef.current;if(!video)return false;for(let i=0;i<video.seekable.length;i++){if(seconds>=video.seekable.start(i)&&seconds<=video.seekable.end(i)){pendingSeek.current=null;video.currentTime=seconds;return true}}pendingSeek.current=seconds;return false}
 function dragTimeline(clientX:number){cancelFollow('manual-seek');const stage=stageRef.current?.getBoundingClientRect(),player=listening.playerRef.current,state=player?.getState(),video=lessonRef.current,duration=state?.active?state.duration:video?.duration;if(!stage||!Number.isFinite(duration)||!duration||duration<=0)return;mediaInteractedRef.current=true;const seconds=geometry.timelineProgress(clientX,stage.left,stage.width)*duration;if(state?.active){player!.seek(seconds);return}seekTo(seconds)}
 function loadDemo(){setCourseError('');const selected=engineRef.current?.getSnapshot().material;if(selected)prepareCoursePoster(selected);if(selected?.builtinReference||selected?.id===NPS_MATERIAL.id)return loadBuiltinMaterial(selected);if(engineRef.current?.getSnapshot().material.localReference){void loadCorrectedMaterial(engineRef.current.getSnapshot().material);return}releaseOriginalMedia();setMediaDuration(0);const media=mediaRef.current,video=lessonRef.current;if(!media||!video)return;videoPalette.sourceChanged('demo');const token=++mediaToken.current;video.pause();engineRef.current?.setFrozen('listening',false);engineRef.current?.setFrozen('idle',true);if(localURL.current)URL.revokeObjectURL(localURL.current);localURL.current=null;media.kind='demo';media.name='咖啡馆会话 · 原创图像视频';setMediaKind('demo');setMediaName(media.name);setShowSubtitle(false);if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='正在加载原创素材…'}let fallback=false;video.onerror=()=>{if(token!==mediaToken.current)return;if(!fallback&&(video.currentSrc||video.src).startsWith('blob:')){fallback=true;releaseOriginalMedia();if(localURL.current)URL.revokeObjectURL(localURL.current);localURL.current=null;videoPalette.sourceChanged('demo');video.src='/studio-assets/06-cafe.mp4';notify('已切换兼容播放方式；跳转以浏览器实际可用范围为准。')}else{if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='视频暂不可用，请重新加载'}setMediaDuration(0);notify('当前浏览器未能播放该素材，可重新选择本机媒体。')}};video.onloadedmetadata=()=>{if(token!==mediaToken.current)return;setMediaDuration(Number.isFinite(video.duration)?video.duration:0);pendingSeek.current=engineRef.current?.cue.start??0;seekTo(pendingSeek.current);if(visualRef.current){visualRef.current.ready=true;visualRef.current.message=''}};const request=new AbortController();originalMediaRequest.current=request;void originalMediaPool.acquire({signal:request.signal}).then(lease=>{if(token!==mediaToken.current||disposed.current||request.signal.aborted){lease.release();return}originalMediaLease.current=lease;setBookmarkMediaReady(lease.verified);video.src=lease.url}).catch(()=>{if(!disposed.current&&token===mediaToken.current&&!request.signal.aborted){if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='视频暂不可用，请重新加载'}notify('素材未能加载，请在素材面板重试。')}})}

 async function loadBuiltinMaterial(material:Material){
  const e=engineRef.current,owner=life.current,request=++courseLoadRequest.current,session=e?.getSnapshot().sessionId;
  setBuiltinMediaReady(false);setMediaDuration(0);setCourseError('');setShowSubtitle(false);prepareCoursePoster(material);releaseOriginalMedia();mediaToken.current++;const video=lessonRef.current;if(video){video.pause();video.onerror=null;video.onloadedmetadata=null;video.removeAttribute('src');video.load()}
  if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='正在核验课程视频…'}
  const current=()=>!disposed.current&&owner===life.current&&request===courseLoadRequest.current&&engineRef.current===e&&!!e&&e.getSnapshot().sessionId===session&&sameMaterial(e.getSnapshot().material,material);
  const prepared:PreparedReviewMedia={lease:null};
  try{
   if(!isBuiltinMaterial(material))throw Error('真人素材声明无法核验，未加载其他课程。');
   const target=await verifyReviewMedia(material,e!.cue.id,undefined,prepared);if(!current())return;await loadReviewMaterial(target,prepared);
   if(!current())return;setCourseError('');
  }catch(error){if(current()){lessonRef.current?.pause();releaseOriginalMedia();lessonRef.current?.removeAttribute('src');lessonRef.current?.load();const message=error instanceof Error?error.message:'真人课程未能核验。';if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='视频暂不可用，请重新加载'}setCourseError(message);notify(message)}}finally{prepared.lease?.release();prepared.lease=null}
 }
 function cancelCourseSelection(){
  const pending=courseSwitchRef.current;if(pending?.committed)return;pending?.abort.abort();
  courseLoadRequest.current++;referenceActionRef.current++;reviewVerifyRequestRef.current++;reviewVerificationRef.current?.dispose();
  courseSwitchRef.current=null;referenceTransitionRef.current=false;setReferenceBusy(false);setCourseChoice(null);setCourseError('');
 }
 async function startBuiltinPractice(material:Material,gesture=false,inheritedAdmission?:number){
  const allowAuto=gesture&&(inheritedAdmission===undefined||inheritedAdmission===followAutoEpochRef.current);
  cancelFollow('course-change');const followAdmission=followAutoEpochRef.current;
  await listening.beforeTransition();
  const e=engineRef.current,history=historyRef.current,repo=repoRef.current;
  if(!e||!history||!repo||referenceBlocked()||restoreFailedRef.current||fixture||replaySnapshot.current||composing.current||bookmarkRecordingBlocked()||document.hidden)throw Error('当前状态不能切换课程，请先结束录制、输入法或其他切换。');
  if(!isBuiltinMaterial(material)&&!sameMaterial(material,CAFE_MATERIAL))throw Error('所选课程不在固定来源目录中。');
  referenceTransitionRef.current=true;setReferenceBusy(true);setCourseError('');const action=++referenceActionRef.current,owner=life.current,pending={action,committed:false,abort:new AbortController()};courseSwitchRef.current=pending;
  lessonRef.current?.pause();e.setFrozen('listening',false);e.setFrozen('idle',true);
  const current=()=>!disposed.current&&owner===life.current&&action===referenceActionRef.current&&courseSwitchRef.current===pending&&!pending.abort.signal.aborted&&!document.hidden&&!bookmarkRecordingBlocked()&&engineRef.current===e;
  const prepared:PreparedReviewMedia={lease:null};let mediaFailed=false;
  try{
   let target:ReviewTarget|null=null;
   await listening.saveScope();const boundary=await flushReferenceTransition({snapshot:e.getSnapshot,history,readControl:()=>repo.readAutomaticHistoryControl(),isCurrent:current,verifyTarget:async()=>{target=await verifyReviewMedia(material,material.cues[0].id,undefined,prepared)}});
   if(!target||!current())throw Error('选材准备已取消，当前轮保留。');
   const status=history.getSnapshot();assertReferenceTransitionBoundary(boundary,e.getSnapshot(),status);if(status.error||status.dirty||status.pendingWrites)throw Error('当前轮还有未保存内容，本次没有切换。');
   stopReviewTracking();pending.committed=true;historyBindingPausedRef.current=true;try{e.startReferenceSession(material,0)}finally{historyBindingPausedRef.current=false}
   history.connect(e.getSnapshot(),boundary.control);if(boundary.mode==='segment')await history.turnOn();
   if(!current()||history.getSnapshot().error||history.getSnapshot().mode!==boundary.mode)throw Error('新课程的历史许可未能确认，请重新打开恢复；原已存记录保留。');
   e.setFrozen('modal',true);try{await loadReviewMaterial(target,prepared)}catch(error){mediaFailed=true;throw error}if(!current())throw Error('新课程准备已中断，请重新打开恢复；原已存记录保留。');
   const assertAdmission=await history.flushForTransition(current,()=>repo.readAutomaticHistoryControl(),pending.abort.signal);assertAdmission();const admitted=history.getSnapshot();if(!current()||admitted.error||admitted.dirty||admitted.pendingWrites)throw Error('新课程尚未完成允许内容的保存，请重新打开恢复；原已存记录保留。');
   restoredSessionRef.current=null;pageInputGateRef.current.begin(e.getSnapshot());setTemporaryHistory(admitted.mode!=='legacy');mediaInteractedRef.current=false;standbyPausedRef.current=false;sceneMotionRef.current.enteredAt=performance.now();sceneMotionRef.current.mediaChangedAt=performance.now();setPaused(false);setShowSubtitle(false);syncDraft();
   courseSwitchRef.current=null;referenceTransitionRef.current=false;setReferenceBusy(false);setCourseChoice(null);setCourseIntent(null);if(typeof window!=='undefined'&&window.history){const cleaned=stripCourseQueryParam(window.location.href);if(cleaned!==window.location.pathname+window.location.search+window.location.hash)window.history.replaceState(window.history.state,'',cleaned)}closePanel();queueSave();if(allowAuto)armFollowAutoEntry(followAdmission,true);notify('已结束上一轮并新开所选课程。参考显示遵循你的“显示/隐藏”选择；展示参考计入辅助练习，旧记录不会追改。');
  }catch(error){
   if(!disposed.current&&owner===life.current&&courseSwitchRef.current===pending){const message=error instanceof Error?error.message:'课程准备未完成。';setCourseError(message);if(pending.committed){if(!mediaFailed){restoreFailedRef.current=true;setRestoreFailed(true)}setShowSubtitle(false);syncDraft();if(mediaFailed&&visualRef.current)visualRef.current.message='视频暂不可用，请重新加载';lessonRef.current?.pause()}}
   throw error;
  }finally{pending.abort.abort();prepared.lease?.release();prepared.lease=null;if(courseSwitchRef.current===pending){courseSwitchRef.current=null;referenceTransitionRef.current=false;if(!disposed.current&&owner===life.current)setReferenceBusy(false)}}
 }

 // Review tasks consume only real saved Training facts; they never score answers.
 function stopReviewTracking(message=''){
  reviewActionRef.current++;reviewBindingRef.current=null;reviewPendingRef.current.clear();repoRef.current?.revokeReviewSessionBindings();reviewMediaRequestRef.current?.abort();reviewVerificationRef.current?.dispose();
  if(!disposed.current){setReviewTrackingMessage(message);setReviewPendingCount(0)}
 }
 async function refreshReviewTasks(){
  const repo=repoRef.current;if(!repo)throw Error('本机练习库尚未准备。');const request=++reviewListRequest.current;setReviewLoading(true);setReviewError('');
  try{
   const list=await repo.listReviewTasks();const rows:ReviewTaskRow[]=[];
   let library:Awaited<ReturnType<IndexedDBLocalReferenceRepository['list']>>|null=null;
   try{library=await referenceRepository().list()}catch{/* Task history remains visible when the reference library is unavailable. */}
   for(const task of list.entries){
    const instance=await repo.loadReviewInstance(task.currentInstanceId);const cueIndex=task.target.material.cues.findIndex(c=>c.id===task.target.cueId);
    let referenceStatus='固定原版；不会自动采用新参考。',canStart=!!instance&&instance.status==='pending'&&task.status==='active';
    if(task.target.material.builtinReference){try{isBuiltinMaterial(task.target.material);referenceStatus='固定 NPS 官方素材与字幕派生版本；开始前核验原片。'}catch{canStart=false;referenceStatus='真人素材来源声明无法核验，不能开始复测。'}}
    if(task.target.material.localReference){
     let known=false;try{known=await isKnownReference(task.target.material)}catch{}
     if(!known){referenceStatus='本机版本或祖先链缺失／不符，不能开始复测；原任务仍保留。';canStart=false}else referenceStatus='固定本机校正版；开始前仍核验实际原片。';
    }
    if(library?.entries.some(entry=>entry.parent.version===task.target.material.version&&entry.parent.digest===task.target.materialDigest))referenceStatus+=' 来源已有新版本，本任务继续固定原版；开始表示明确选择原版。';
    if(!instance)referenceStatus+=' 当前复测实例缺失，不能开始。';
    let resultSummary='暂无已关联的实际复测结果；待办和到期不代表学习完成。';
    try{
     const exported=await repo.exportReviewTask(task.taskId);
     if(exported.evidence[0]?.availability!=='available'){canStart=false;referenceStatus+=' 原提交证据不可用，不能开始；未将缺失记录视为零分。';}
     const latest=[...exported.relations].sort((a,b)=>a.committedAt.localeCompare(b.committedAt)||a.relationId.localeCompare(b.relationId)).at(-1);
     if(latest){const evidence=exported.evidence.find(value=>reviewSame(value.source,latest.source));
      resultSummary=evidence?.availability==='available'&&evidence.result?`最近关联提交 ${latest.source.attemptId}：参考词数 ${evidence.result.words}，错误 ${evidence.result.errors}；${latest.disposition==='winner'?'该实例首个已保存有效提交':'同一实例的后续真实提交'}。${evidence.coverage==='partial'?'部分记录，辅助与参考来源未知。':'辅助条件见原完整记录。'}可导出核对会话、事件与实例。`:'最近关联的原作答证据不可用；未显示零分或推断已掌握。';
     }
    }catch{canStart=false;resultSummary='关联证据暂时无法读取，未推断无记录或零分。请刷新重试。';}
    rows.push({taskId:task.taskId,revision:task.revision,status:task.status,materialTitle:task.target.material.title,materialVersion:task.target.material.version,cueNumber:cueIndex+1,due:task.due,nextDue:instance?.nextDue??null,sourceCoverage:task.source.kind==='full'?'complete':'partial',referenceStatus,resultSummary,canStart});
   }
   if(disposed.current||request!==reviewListRequest.current)return;setReviewRows(rows);setReviewUnreadable(list.unreadableCount);
  }catch(error){if(!disposed.current&&request===reviewListRequest.current)setReviewError(error instanceof Error?error.message:'复习任务未能读取。');throw error}
  finally{if(!disposed.current&&request===reviewListRequest.current)setReviewLoading(false)}
 }
 async function verifyReviewMedia(material:Material,cueId:string,expected?:ReviewTarget,prepared?:PreparedReviewMedia):Promise<ReviewTarget>{
  const owner=life.current,action=reviewActionRef.current,request=++reviewVerifyRequestRef.current,e=engineRef.current,session=e?.getSnapshot().sessionId;
  const current=()=>!disposed.current&&!document.hidden&&!bookmarkRecordingBlocked()&&owner===life.current&&action===reviewActionRef.current&&request===reviewVerifyRequestRef.current&&e===engineRef.current&&e?.getSnapshot().sessionId===session;
  if(!current())throw Error('复习媒体核验已取消。');
  if(!await isKnownReference(material))throw Error('固定参考版本或祖先链无法核验，不能创建或开始复习。');
  if(!current())throw Error('复习媒体核验已取消。');
  const cue=material.cues.find(c=>c.id===cueId);if(!cue)throw Error('固定目标句已不可核验。');
  const descriptor=builtinCourseForMaterial(material)?NPS_PLAYBACK_MEDIA:null,media=material.builtinReference?.media??material.localReference?.media??{id:LOCAL_REFERENCE_MEDIA_ID,sha256:LOCAL_REFERENCE_MEDIA_SHA256,durationSeconds:0};
  const controller=createContextBookmarkPreviewController({video:document.createElement('video'),pool:coursePool(material),...(descriptor?{media:descriptor}:{}),isRecordingBlocked:()=>!current(),validateReference:()=>null});
  reviewVerificationRef.current?.dispose();reviewVerificationRef.current=controller;
  try{
   controller.select({materialId:material.id,materialVersion:material.version,cueId,text:cue.text,startSeconds:cue.start,endSeconds:cue.end,mediaId:media.id,mediaSha256:media.sha256});await controller.load();
   if(!current())throw Error('复习媒体核验已取消。');
   const state=controller.getState();if(state.phase!=='ready'||!state.duration)throw Error(state.error??'实际原片尚未核验。');
   if(material.builtinReference&&Math.abs(state.duration-media.durationSeconds)>.001)throw Error(`实际真人片段时长与固定来源不一致。 ${reviewDurationDiagnostic(state.duration,media.durationSeconds,.001)}`);
   if(material.localReference&&state.duration!==media.durationSeconds)throw Error(`实际原片时长与固定校正版不一致。 ${reviewDurationDiagnostic(state.duration,media.durationSeconds,0)}`);
   const target=await buildReviewTarget(material,cueId,{id:media.id,sha256:media.sha256,durationSeconds:state.duration});
   if(!current())throw Error('复习媒体核验已取消。');
   if(expected&&!fixedReviewTargetMatches(target,expected))throw Error('固定版本、完整摘要、目标句或原片时长已改变。');
   if(!fixedReviewDurationMatches(target,state.duration))throw Error(`实际原片时长或句子边界与固定来源不符。 ${reviewDurationDiagnostic(state.duration,target.media.durationSeconds,material.builtinReference?.media ? .001 : 0)}`);
   if(prepared&&material.builtinReference){
    const transport=controller.getPlaybackTransport();if(!transport)throw Error('预检原片已失效，不能交接。');
    let retained:OriginalCourseMediaLease|null=await coursePool(material).acquire();
    try{
     const descriptor=builtinCourseForMaterial(target.material)?NPS_PLAYBACK_MEDIA:ORIGINAL_COURSE_MEDIA;
     if(!current()||controller.getPlaybackTransport()!==transport||!isVerifiedCourseMediaLease(retained,descriptor)||retained.mediaSha256!==target.media.sha256||retained.mediaId!==target.media.id)throw Error('已核验原片的临时交接已取消或来源不符。');
     if(transport==='verified-direct'){
      if(!retained.toVerifiedDirect)throw Error('当前原片没有已核验同源播放许可。');
      retained=retained.toVerifiedDirect();
     }
     if(!current()||controller.getPlaybackTransport()!==transport||!isVerifiedCourseMediaLease(retained,descriptor))throw Error('原片交接的实际播放来源已失效。');
     prepared.lease?.release();prepared.lease=retained;retained=null;
    }finally{retained?.release()}
   }
   return target;
  }finally{controller.dispose();if(reviewVerificationRef.current===controller)reviewVerificationRef.current=null}
 }
 async function saveReviewTask(cueId:string,due:ReviewDueTime,requestId:string){
  const e=engineRef.current,history=historyRef.current,repo=repoRef.current;
  if(!e||!history||!repo||referenceBlocked()||fixture||replaySnapshot.current||mediaKind!=='demo'||document.hidden||bookmarkRecordingBlocked())throw Error('请先返回可用真实练习并结束录制，再安排复习。');
  const snapshot=e.getSnapshot(),attempt=[...snapshot.attempts].reverse().find(a=>a.cueId===cueId);
  if(!attempt)throw Error('本句尚无真实提交，不能建立来源任务。');
  const owner=life.current;reviewTransitionRef.current=true;setReviewBusy(true);setReviewError('');
  try{
   const target=await verifyReviewMedia(snapshot.material,cueId);await history.flush();
   if(disposed.current||owner!==life.current||document.hidden||e!==engineRef.current||e.getSnapshot()!==snapshot)throw Error('当前练习已改变，请刷新复盘后重新安排。');
   const session=history.getCommittedReviewSession();if(!session)throw Error('这次允许记录的提交尚未保存，不能借复习任务保存临时答案。请先重试本机保存。');
   const saved=await repo.createReviewTask({requestId,source:reviewAttemptSource(snapshot,attempt,session),target,due});
   return {disposition:saved.disposition==='created'?'saved' as const:'already-present' as const};
  }finally{reviewTransitionRef.current=false;if(!disposed.current&&owner===life.current)setReviewBusy(false)}
 }
 function reviewMediaError(target:ReviewTarget){
  const e=engineRef.current,video=lessonRef.current,lease=originalMediaLease.current,strict=reviewMediaRef.current;
  if(!e||!video||!lease||!strict||strict.sessionId!==e.getSnapshot().sessionId||strict.materialDigest!==target.materialDigest||!reviewSame(strict.target,target)
   ||!sameMaterial(e.getSnapshot().material,target.material)||video.src!==strict.url||video.currentSrc!==strict.url||lease.url!==strict.url||video.readyState<1||!!video.error
   ||!isVerifiedCourseMediaLease(lease,builtinCourseForMaterial(target.material)?NPS_PLAYBACK_MEDIA:ORIGINAL_COURSE_MEDIA)||lease.mediaSha256!==target.media.sha256
   ||lease.mediaId!==target.media.id||!fixedReviewDurationMatches(target,video.duration))return '复习原片尚未按固定版本核验，不能播放。';return null;
 }
 async function loadReviewMaterial(target:ReviewTarget,prepared?:PreparedReviewMedia):Promise<void>{
  const video=lessonRef.current,media=mediaRef.current,e=engineRef.current;if(!video||!media||!e)throw Error('课程播放器尚未准备。');
  prepareCoursePoster(target.material);releaseOriginalMedia();const token=++mediaToken.current,sessionId=e.getSnapshot().sessionId,request=new AbortController();originalMediaRequest.current=request;reviewMediaRequestRef.current=request;
  video.pause();video.removeAttribute('src');video.load();videoPalette.sourceChanged('demo');setMediaDuration(0);setShowSubtitle(false);
  media.kind='demo';media.name=`${target.material.title} · 固定参考课程`;setMediaKind('demo');setMediaName(media.name);if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='正在核验课程视频…'}
  const owns=()=>token===mediaToken.current&&originalMediaRequest.current===request;
  const current=()=>!disposed.current&&!document.hidden&&!bookmarkRecordingBlocked()&&!request.signal.aborted&&owns()&&engineRef.current===e&&e.getSnapshot().sessionId===sessionId&&sameMaterial(e.getSnapshot().material,target.material);
  let lease:OriginalCourseMediaLease|null=null;
  try{
   if(prepared?.lease){lease=prepared.lease;prepared.lease=null}else lease=await coursePool(target.material).acquire({signal:request.signal});
   if(!current())throw Error('复测媒体准备已取消。');
   if(!isVerifiedCourseMediaLease(lease,builtinCourseForMaterial(target.material)?NPS_PLAYBACK_MEDIA:ORIGINAL_COURSE_MEDIA)||lease.mediaSha256!==target.media.sha256||lease.mediaId!==target.media.id)throw Error('实际原片哈希或身份不一致。');
   const bind=(selected:OriginalCourseMediaLease)=>{
    originalMediaLease.current=selected;setBookmarkMediaReady(!strictCourse(target.material));
    reviewMediaRef.current={sessionId,materialDigest:target.materialDigest,url:selected.url,target};
    if(strictCourse(target.material))correctedMediaRef.current={identity:JSON.stringify(target.material),url:selected.url};
   };
   bind(lease);
   let nativeAAC=false;const metadataDeadline=Date.now()+20000;
   const loadOnce=(selected:OriginalCourseMediaLease)=>new Promise<void>((resolve,reject)=>{
    nativeAAC=false;const transport=selected.transport??'blob';let settled=false;
    const validOwner=()=>current()&&originalMediaLease.current===selected&&lease===selected;
    const rangeDiagnostic=()=>reviewRangeDiagnostic(video.duration,Math.min(...target.material.cues.map(c=>c.start)),Math.max(...target.material.cues.map(c=>c.end)),transport,video.readyState);
    const fail=(message:string)=>{if(settled)return;settled=true;cleanup();reject(Error(`${message} [transport=${transport}]`))};
    const loaded=()=>{
     if(settled)return;if(!validOwner())return fail('复测媒体准备已过期。');
     if(Date.now()>=metadataDeadline)return fail(`复测原片准备超时，未开始跟踪。 ${rangeDiagnostic()}`);
     if(!isVerifiedCourseMediaLease(selected,builtinCourseForMaterial(target.material)?NPS_PLAYBACK_MEDIA:ORIGINAL_COURSE_MEDIA)||video.src!==selected.url||video.currentSrc&&video.currentSrc!==selected.url)return fail('复测播放器的原片来源已变化。');
     if(video.error)return error();
     // A metadata event may precede a finite platform duration. Stay within the
     // original deadline; do not play, seek or weaken any real finite boundary.
     if(video.currentSrc!==selected.url||video.readyState<1||!Number.isFinite(video.duration)||video.duration<=0)return;
     if(!fixedReviewDurationMatches(target,video.duration))return fail(`实际原片时长与复习任务不符。 ${reviewDurationDiagnostic(video.duration,target.media.durationSeconds,target.material.builtinReference?.media?.durationSeconds ? .001 : 0)} ${rangeDiagnostic()}`);
     settled=true;cleanup();setMediaDuration(video.duration);pendingSeek.current=target.material.cues.find(c=>c.id===target.cueId)!.start;seekTo(pendingSeek.current);if(visualRef.current){visualRef.current.ready=true;visualRef.current.message=''}setBuiltinMediaReady(!!target.material.builtinReference);resolve();
    };
    const error=()=>{if(settled)return;nativeAAC=Date.now()<metadataDeadline&&validOwner()&&video.src===selected.url&&(!video.currentSrc||video.currentSrc===selected.url)&&isExactNativeAACError(video.error);fail(`复习原片无法解码。 ${reviewMediaDiagnostic('lesson',video)}`)};
    const abort=()=>fail('复测媒体准备已取消。');
    const timeout=setTimeout(()=>fail(`复测原片准备超时，有限时长尚未就绪，未开始跟踪。 ${reviewMediaDiagnostic('lesson',video)} ${rangeDiagnostic()}`),Math.max(0,metadataDeadline-Date.now()));
    const metadataEvents=['loadedmetadata','durationchange','loadeddata','canplay'];
    const cleanup=()=>{clearTimeout(timeout);for(const name of metadataEvents)video.removeEventListener(name,loaded);video.removeEventListener('error',error);request.signal.removeEventListener('abort',abort)};
    video.onerror=null;video.onloadedmetadata=null;for(const name of metadataEvents)video.addEventListener(name,loaded);video.addEventListener('error',error);request.signal.addEventListener('abort',abort,{once:true});
    try{video.crossOrigin='anonymous';video.src=selected.url;video.load()}catch{fail(`复习原片无法解码。 ${reviewMediaDiagnostic('lesson',video)}`)}
   });
   try{await loadOnce(lease)}catch(error){
    if(!nativeAAC||Date.now()>=metadataDeadline||!current()||originalMediaLease.current!==lease||lease.transport==='verified-direct'||!lease.toVerifiedDirect||video.src!==lease.url||video.currentSrc&&video.currentSrc!==lease.url)throw error;
    const direct=lease.toVerifiedDirect();
    if(!current()||!isVerifiedCourseMediaLease(direct,builtinCourseForMaterial(target.material)?NPS_PLAYBACK_MEDIA:ORIGINAL_COURSE_MEDIA))throw error;
    // Both immutable views share this holder's release. Do not release the Blob
    // view while replacing it; the independently held verifier stays isolated.
    video.pause();setBuiltinMediaReady(false);setMediaDuration(0);if(visualRef.current)visualRef.current.ready=false;
    lease=direct;bind(direct);await loadOnce(direct);
   }
   if(Date.now()>=metadataDeadline||!current()||reviewMediaError(target))throw Error(`复测媒体在最终交接前已失效。 ${reviewMediaDiagnostic('lesson',video)} ${reviewRangeDiagnostic(video.duration,Math.min(...target.material.cues.map(c=>c.start)),Math.max(...target.material.cues.map(c=>c.end)),lease.transport??'blob',video.readyState)}`);
   if(target.material.builtinReference)video.onerror=()=>{if(!owns()||engineRef.current!==e||e.getSnapshot().sessionId!==sessionId)return;const detail=`${reviewMediaDiagnostic('playback',video)} [transport=${originalMediaLease.current?.transport??'blob'}]`;video.pause();releaseOriginalMedia();video.onerror=null;video.removeAttribute('src');video.load();setMediaDuration(0);if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='视频暂不可用，请重新加载'}setCourseError(`真人课程解码已中断，播放和作答暂停。请重新加载当前课程；未切换其他素材。 ${detail}`)};
  }catch(error){
   // A stale request releases only its own lease, never the newer source.
   if(owns()){
    video.pause();video.onerror=null;video.onloadedmetadata=null;video.removeAttribute('src');video.load();reviewMediaRef.current=null;correctedMediaRef.current=null;
    if(originalMediaLease.current===lease)originalMediaLease.current=null;originalMediaRequest.current=null;
    if(!disposed.current){setBuiltinMediaReady(false);setBookmarkMediaReady(false);setMediaDuration(0);if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='视频暂不可用，请重新加载'}}
   }
   lease?.release();throw error;
  }finally{if(reviewMediaRequestRef.current===request)reviewMediaRequestRef.current=null;}
 }
 async function startReviewTask(row:ReviewTaskRow,nextDue:ReviewDueTime){
  await listening.beforeTransition();
  const e=engineRef.current,history=historyRef.current,repo=repoRef.current;
  if(!e||!history||!repo||referenceBlocked()||fixture||replaySnapshot.current||bookmarkRecordingBlocked()||document.hidden||composing.current||restoreFailedRef.current)throw Error('当前状态不能开始复测，请先结束录制、输入法或其他切换。');
  if(!['legacy','segment'].includes(history.getSnapshot().mode))throw Error('受追踪复测需要本页已有的记录许可。请先在练习历史设置中明确从现在记录；不会补录旧内容。');
  stopReviewTracking();reviewTransitionRef.current=true;setReviewBusy(true);setReviewStartFailure('');const action=reviewActionRef.current,owner=life.current;let didReset=false;lessonRef.current?.pause();e.setFrozen('listening',false);e.setFrozen('idle',true);
  const current=()=>!disposed.current&&owner===life.current&&action===reviewActionRef.current&&!document.hidden&&!bookmarkRecordingBlocked()&&engineRef.current===e;
  const mediaPreparation:PreparedReviewMedia={lease:null};
  try{
   let plan:Awaited<ReturnType<IndexedDBTrainingRepository['prepareReviewRetest']>>|null=null;
   await listening.saveScope();const boundary=await flushReferenceTransition({snapshot:e.getSnapshot,history,readControl:()=>repo.readAutomaticHistoryControl(),isCurrent:current,verifyTarget:async()=>{
    const task=await repo.loadReviewTask(row.taskId);if(!task||task.revision!==row.revision||task.status!=='active')throw Error('复习任务已改变，请刷新后重新选择。');
    await verifyReviewMedia(task.target.material,task.target.cueId,task.target,mediaPreparation);if(!current())throw Error('复测准备已取消。');
    plan=await repo.prepareReviewRetest({taskId:task.taskId,expectedRevision:task.revision,nextDue});
   }});
   if(!plan||!current())throw Error('复测计划已过期，本次没有切换。');const prepared=plan as Awaited<ReturnType<IndexedDBTrainingRepository['prepareReviewRetest']>>;
   const status=history.getSnapshot();assertReferenceTransitionBoundary(boundary,e.getSnapshot(),status);if(status.error||status.dirty||status.pendingWrites)throw Error('旧练习仍未保存，本次没有切换。');
   const cueIndex=prepared.task.target.material.cues.findIndex(c=>c.id===prepared.task.target.cueId);
   historyBindingPausedRef.current=true;try{e.startReferenceSession(prepared.task.target.material,cueIndex);didReset=true;}finally{historyBindingPausedRef.current=false}
   history.connect(e.getSnapshot(),boundary.control);if(boundary.mode==='segment')await history.turnOn();
   if(!current()||!['legacy','segment'].includes(history.getSnapshot().mode)||history.getSnapshot().error)throw Error('新轮的记录许可尚未成功，复测尚未开始跟踪。');
   e.setFrozen('modal',true);await history.flush();const session=history.getCommittedReviewSession();if(!current()||!session)throw Error('新轮尚未保存或许可已失效，复测尚未开始跟踪。');
   await loadReviewMaterial(prepared.task.target,mediaPreparation);if(!current())throw Error('复测媒体准备已取消。');
   // Media callbacks may append normal freeze facts; persist them before binding.
   await history.flush();const committed=history.getCommittedReviewSession();if(!current()||!committed)throw Error('新轮保存尚未完成，不能建立复测关联。');
   const binding=await repo.bindReviewSession({taskId:prepared.task.taskId,instanceId:prepared.instance.instanceId,expectedRevision:prepared.task.revision,session:committed});
   if(!current()){repo.revokeReviewSessionBindings();throw Error('复测关联建立时页面已改变，未启用跟踪。');}
   reviewBindingRef.current=binding;restoredSessionRef.current=null;pageInputGateRef.current.begin(e.getSnapshot());setTemporaryHistory(committed.kind!=='full');mediaInteractedRef.current=false;standbyPausedRef.current=false;sceneMotionRef.current.enteredAt=performance.now();setPaused(false);setShowSubtitle(false);syncDraft();
   setReviewTrackingMessage(`正在复测第 ${cueIndex+1} 句；首次有效提交后按你预选的时间安排。`);reviewTransitionRef.current=false;setReviewBusy(false);closePanel();inputRef.current?.focus({preventScroll:true});queueSave();
   notify('已按固定版本新开复测。参考显示遵循你的“显示/隐藏”选择；展示参考计入辅助练习，实际提交后才更新复习安排。');
  }catch(error){if(didReset&&!disposed.current&&owner===life.current&&engineRef.current===e){const failure=error instanceof Error?error.message:'新轮复测准备未完成。';reviewStartFailureRef.current=failure;setReviewStartFailure(failure);setPanel('review-tasks');setShowSubtitle(false);syncDraft()}throw error}
  finally{mediaPreparation.lease?.release();mediaPreparation.lease=null;reviewTransitionRef.current=false;if(!disposed.current&&owner===life.current)setReviewBusy(false)}
 }
 function leaveFailedReviewStart(){stopReviewTracking('复测准备已结束；当前为普通练习，不推进任务。');setReviewStartFailure('');reviewStartFailureRef.current='';closePanel()}
 async function changeReviewTask(row:ReviewTaskRow,action:'cancel'|'restore'|'reschedule',due?:ReviewDueTime){
  const repo=repoRef.current;if(!repo)throw Error('本机练习库尚未准备。');await repo.changeReviewTask({taskId:row.taskId,expectedRevision:row.revision,action,...(due?{due}:{})});
  if(reviewBindingRef.current?.taskId===row.taskId)stopReviewTracking('任务安排已改变，本轮不再推进旧复测实例。');await refreshReviewTasks();
 }
 async function exportReviewTask(row:ReviewTaskRow){
  const repo=repoRef.current;if(!repo)throw Error('本机练习库尚未准备。');const exported=await repo.exportReviewTask(row.taskId);
  if(disposed.current)return;download(`lingotrace-review-task-${row.taskId}.json`,new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}));
 }
 function observeReviewAttempt(attempt:Attempt){
  const binding=reviewBindingRef.current,e=engineRef.current;if(!binding||!e||binding.session.sessionId!==e.getSnapshot().sessionId||attempt.cueId!==binding.cueId)return;
  reviewPendingRef.current.set(attempt.attemptId,{attemptId:attempt.attemptId,binding,action:reviewActionRef.current});setReviewPendingCount(reviewPendingRef.current.size);void flushReviewResults();
 }
 async function flushReviewResults(){
  if(reviewResultBusy.current)return;const history=historyRef.current,repo=repoRef.current,e=engineRef.current;if(!history||!repo||!e)return;const drainAction=reviewActionRef.current;reviewResultBusy.current=true;
  try{for(const pending of reviewPendingRef.current.values()){
   const current=()=>!disposed.current&&!historyPageInactiveRef.current&&pending.action===reviewActionRef.current&&pending.binding===reviewBindingRef.current&&e===engineRef.current&&e.getSnapshot().sessionId===pending.binding.session.sessionId;
   if(!current()){reviewPendingRef.current.delete(pending.attemptId);continue;}await history.flush();if(!current())break;
   const session=history.getCommittedReviewSession(),snapshot=e.getSnapshot(),attempt=snapshot.attempts.find(a=>a.attemptId===pending.attemptId);
   if(!session||!attempt||session.kind!==pending.binding.session.kind||session.generation!==pending.binding.session.generation||(session.kind==='partial'&&pending.binding.session.kind==='partial'&&session.segmentId!==pending.binding.session.segmentId))throw Error('作答保存或本页许可尚未确认，复习关联与排期未提交。');
   try{
    const result=await repo.commitReviewResult({binding:pending.binding,source:reviewAttemptSource(snapshot,attempt,session)});if(!current())break;
    reviewPendingRef.current.delete(pending.attemptId);setReviewPendingCount(reviewPendingRef.current.size);setReviewTrackingMessage(result.disposition==='winner'?'本次真实作答已关联，已按你预选的时间安排下一次。':'本次真实作答仍关联原复测实例，没有重复推进下一次。');
   }catch(error){
    if(!current())break;
    // A redacted/invalid immutable source can never become an eligible result.
    // Drop only this volatile candidate; preserve its original facts and let a
    // later independently recorded attempt compete for the same occurrence.
    if(error instanceof Error&&'code' in error&&error.code==='invalid-source'){
     reviewPendingRef.current.delete(pending.attemptId);setReviewPendingCount(reviewPendingRef.current.size);setReviewTrackingMessage('这次提交缺少可核验的已保存来源，未推进复习；后续合规提交仍可独立关联。');continue;
    }
    throw error; // Storage/permission failures retain the existing explicit retry path.
   }
  }}catch(error){if(!disposed.current&&drainAction===reviewActionRef.current&&engineRef.current===e)setReviewTrackingMessage(error instanceof Error?error.message:'作答已留在正常练习中，复习关联与排期尚未提交。')}
  finally{reviewResultBusy.current=false;if(!disposed.current){setReviewPendingCount(reviewPendingRef.current.size);if(drainAction!==reviewActionRef.current&&reviewPendingRef.current.size&&reviewBindingRef.current)void flushReviewResults()}}
 }
 async function restoreSavedReviewBinding(snapshot:TrainingSnapshot){
  const repo=repoRef.current,history=historyRef.current,e=engineRef.current,owner=life.current,action=reviewActionRef.current;if(!repo||!history||!e||history.getSnapshot().mode!=='legacy')return;
  const mediaPreparation:PreparedReviewMedia={lease:null};
  try{const binding=await repo.restoreReviewSessionBinding(snapshot.sessionId);if(!binding||snapshot.material.cues[snapshot.cueIndex]?.id!==binding.cueId)return;
   const current=()=>!disposed.current&&owner===life.current&&action===reviewActionRef.current&&engineRef.current===e&&e.getSnapshot().sessionId===snapshot.sessionId&&e.getSnapshot().sequence===snapshot.sequence&&history.getSnapshot().mode==='legacy';
   if(!current())return;const task=await repo.loadReviewTask(binding.taskId);if(!task||!current())return;
   await verifyReviewMedia(task.target.material,task.target.cueId,task.target,mediaPreparation);if(!current())return;await loadReviewMaterial(task.target,mediaPreparation);
   if(!current())return;reviewBindingRef.current=binding;setReviewTrackingMessage('已恢复这份完整记录的原复测关联；不会补推进旧提交。');
  }catch{if(!disposed.current&&action===reviewActionRef.current)setReviewTrackingMessage('保存的复测关联或原片无法核验，请从任务列表明确重新开始；旧记录保留。')}finally{mediaPreparation.lease?.release();mediaPreparation.lease=null}
 }

 async function refreshReferenceLibrary(){const list=await referenceRepository().list();if(disposed.current)return;setReferenceEntries(list.entries);setReferenceUnreadable(list.unreadableCount)}
 async function isKnownReference(material:Material){if(isBuiltinMaterial(material))return true;return material.localReference?await referenceRepository().isExactSavedMaterial(material):sameMaterial(material,CAFE_MATERIAL)}
 async function openReferenceLibrary(edit=false){
  if(referenceBlocked()){if(referenceConfirmationRef.current)setPanel('reference-confirm');return}
  const e=engineRef.current;if(!e||restoreFailedRef.current||fixture||replaySnapshot.current||composing.current){notify('请先返回可用的真实练习，再打开本机参考版本。');return}
  const action=++referenceActionRef.current,session=e.getSnapshot().sessionId,material=e.getSnapshot().material,cue=e.cue;
  referencePanelRef.current=true;referenceTargetRef.current=null;setReferenceTarget(null);setReferenceError('');await openPanel('references');
  try{
   await refreshReferenceLibrary();if(disposed.current||action!==referenceActionRef.current||!referencePanelRef.current)return;
   if(!edit)return;
   if(material.builtinReference)throw Error('NPS 真人测试素材暂不支持文字／时间校正；官方字幕与末尾截断版本保持固定。');
   if(bookmarkRecordingBlocked())throw Error('录制准备、进行或收尾期间不能校正或预听。');
   if(!await isKnownReference(material))throw Error('当前参考版本在本机库中缺失或不匹配。历史文字和成绩保留，暂不能校正。');
   if(disposed.current||action!==referenceActionRef.current||!referencePanelRef.current||document.hidden||engineRef.current!==e||e.getSnapshot().sessionId!==session||e.cue.id!==cue.id||!sameMaterial(e.getSnapshot().material,material))return;
   const target:MaterialCorrectionTarget={material,cueId:cue.id,mediaId:'cafe-original-video-v1',mediaSha256:'22fc25ade368f351cda21951916e559ff359cf1ac8419fbfa5444e050cdbf740',...(material.localReference?{expectedDurationSeconds:material.localReference.media.durationSeconds}:{})};
   e.exposeHint('reveal',{version:'reference-exposure-v1',surface:'correction-editor'});
   referenceTargetRef.current=target;setReferenceTarget(target);
  }catch(error){if(!disposed.current&&action===referenceActionRef.current)setReferenceError(error instanceof Error?error.message:'本机参考版本暂时无法读取。')}
 }
 async function saveEditedReference(input:MaterialCorrectionSaveInput){
  const e=engineRef.current,target=referenceTargetRef.current,previewController=referencePreviewRef.current,preview=previewController?.getState(),action=referenceActionRef.current;
  if(!e||!target||!referencePanelRef.current||referenceBlocked()||document.hidden||bookmarkRecordingBlocked()||e.cue.id!==target.cueId||!sameMaterial(e.getSnapshot().material,target.material)||preview?.phase!=='ready'||preview.duration!==input.verifiedDurationSeconds||preview.reference?.text!==input.text||preview.reference.startSeconds!==input.start||preview.reference.endSeconds!==input.end)throw Error('编辑或已核验片段已变化，请重新核验后保存。');
  if(input.structure){
   const structure=input.structure,cue=target.material.cues.find(c=>c.id===target.cueId)!,index=target.material.cues.findIndex(c=>c.id===target.cueId),next=target.material.cues[index+1];
   if(structure.confirmed!==true||!['merge','split'].includes(structure.operation)||input.start!==cue.start||input.end!==(structure.operation==='merge'?next?.end:cue.end)
    ||input.text!==(structure.operation==='split'?`${structure.firstText} ${structure.secondText}`:structure.firstText))throw Error('新句结构尚未确认或与已核验片段不符，请重新核验。');
  }
  const session=e.getSnapshot().sessionId;
  const previewCurrent=()=>{const state=previewController?.getState(),ref=state?.reference;return referencePreviewRef.current===previewController&&state?.phase==='ready'&&state.duration===input.verifiedDurationSeconds&&ref?.materialId===target.material.id&&ref.materialVersion===target.material.version&&ref.cueId===target.cueId&&ref.text===input.text&&ref.startSeconds===input.start&&ref.endSeconds===input.end&&ref.mediaId===target.mediaId&&ref.mediaSha256===target.mediaSha256};
  const current=()=>!disposed.current&&referencePanelRef.current&&action===referenceActionRef.current&&!document.hidden&&!bookmarkRecordingBlocked()&&engineRef.current===e&&e.getSnapshot().sessionId===session&&e.cue.id===target.cueId&&sameMaterial(e.getSnapshot().material,target.material)&&previewCurrent();
  if(!await isKnownReference(target.material)||!current())throw Error('父参考版本已变化，本次没有保存。');
  const lease=await originalMediaPool.acquire();
  try{
   if(!current()||!lease.verified||lease.actualSha256!==target.mediaSha256||lease.mediaId!==target.mediaId)throw Error('原片内容校验未完成，本次没有保存。');
   const common={original:CAFE_MATERIAL,parent:target.material,editedCueId:target.cueId,media:{id:lease.mediaId,sha256:lease.actualSha256!,durationSeconds:input.verifiedDurationSeconds},saveRequestId:input.saveRequestId};
   const proposal=input.structure?await buildLocalReferenceStructureProposal({...common,operation:input.structure.operation,text:input.structure.firstText,...(input.structure.operation==='split'?{secondText:input.structure.secondText,splitAt:input.structure.splitAt}:{})}):await buildLocalReferenceProposal({...common,text:input.text,start:input.start,end:input.end});
   if(!current())throw Error('保存前编辑已关闭、后台化或改变，本次没有提交。');
   const result=await referenceRepository().save(proposal);await refreshReferenceLibrary();return result;
  }finally{lease.release()}
 }
 async function verifySelectedReferenceMedia(entry:LocalReferenceReceipt){
  const cue=entry.material.cues.find(c=>c.id===entry.change.cueId),binding=entry.material.localReference;
  if(!cue||!binding)throw Error('所选版本缺少完整参考或原片绑定。');
  const controller=createContextBookmarkPreviewController({video:document.createElement('video'),pool:originalMediaPool,isRecordingBlocked:bookmarkRecordingBlocked,validateReference:()=>null});
  referenceVerificationRef.current?.dispose();referenceVerificationRef.current=controller;
  try{controller.select({materialId:entry.material.id,materialVersion:entry.material.version,cueId:cue.id,text:cue.text,startSeconds:cue.start,endSeconds:cue.end,mediaId:binding.media.id,mediaSha256:binding.media.sha256});await controller.load();const state=controller.getState();if(state.phase!=='ready'||state.duration!==binding.media.durationSeconds)throw Error(state.error??'所选版本与原片实际时长不符，未开始新练习。')}
  finally{controller.dispose();if(referenceVerificationRef.current===controller)referenceVerificationRef.current=null}
 }
 function showReferenceConfirmation(){
  const confirmation=referenceConfirmationRef.current,e=engineRef.current;
  if(!confirmation||confirmation.exposed||!e||document.hidden||e.getSnapshot().sessionId!==confirmation.sessionId||e.getSnapshot().material.version!==confirmation.materialVersion||e.cue.id!==confirmation.cueId)return;
  e.exposeHint('reveal',{version:'reference-exposure-v1',surface:'corrected-version-confirmation'});
  const next={...confirmation,exposed:true};referenceConfirmationRef.current=next;setReferenceConfirmation(next);
 }
 function continueReferencePractice(){if(!referenceConfirmationRef.current?.exposed)return;referenceConfirmationRef.current=null;setReferenceConfirmation(null);closePanel();inputRef.current?.focus({preventScroll:true})}
 async function startSavedReference(selected:LocalReferenceReceipt){
  await listening.beforeTransition();
  if(referenceBlocked()||bookmarkRecordingBlocked()||document.hidden||restoreFailedRef.current||composing.current)throw Error('当前状态不能切换参考版本，请结束录制或等待保存后重试。');
  const e=engineRef.current,history=historyRef.current,repo=repoRef.current;if(!e||!history||!repo)throw Error('练习历史设置尚未准备。');
  stopReviewTracking();referenceTransitionRef.current=true;setReferenceBusy(true);const action=++referenceActionRef.current,owner=life.current;referencePreviewRef.current?.close();lessonRef.current?.pause();
  let chosen:LocalReferenceReceipt|null=null;
  const current=()=>!disposed.current&&life.current===owner&&referencePanelRef.current&&referenceActionRef.current===action&&!document.hidden&&!bookmarkRecordingBlocked()&&engineRef.current===e;
  try{
   await listening.saveScope();const boundary=await flushReferenceTransition({snapshot:e.getSnapshot,history,readControl:()=>repo.readAutomaticHistoryControl(),isCurrent:current,verifyTarget:async()=>{
    chosen=await referenceRepository().load(selected.material.id,selected.material.version);
    if(!chosen||canonicalLocalReferenceJSON(chosen)!==canonicalLocalReferenceJSON(selected))throw Error('所选本机版本已改变或不可读取，请刷新后重新选择。');
    await verifySelectedReferenceMedia(chosen);
   }});
   if(!chosen||!current())throw Error('所选版本已过期，本次没有切换。');
   const entry=chosen as LocalReferenceReceipt,cueIndex=entry.material.cues.findIndex(c=>c.id===entry.change.cueId);
   // The async helper's return itself yields. Commit only against the same
   // saved boundary, immediately adjacent to the synchronous reset.
   const commitStatus=history.getSnapshot();assertReferenceTransitionBoundary(boundary,e.getSnapshot(),commitStatus);
   if(commitStatus.error||commitStatus.pendingWrites||commitStatus.dirty)throw Error('当前轮仍有尚未保存的内容，本次没有切换。请先重试保存或主动导出。');
   historyBindingPausedRef.current=true;try{e.startReferenceSession(entry.material,cueIndex)}finally{historyBindingPausedRef.current=false}
   history.connect(e.getSnapshot(),boundary.control);
   // Existing active segment intent follows the explicit new round. OFF or an
   // awaiting page never silently enables collection.
   if(boundary.mode==='segment')await history.turnOn();
   if(disposed.current||owner!==life.current||engineRef.current!==e)return;
   const status=history.getSnapshot();
   const confirmation:ReferenceConfirmation={sessionId:e.getSnapshot().sessionId,materialVersion:entry.material.version,cueId:e.cue.id,text:e.cue.text,start:e.cue.start,end:e.cue.end,exposed:false,message:status.mode==='legacy'?'本次查看参考会随完整练习记录。':status.mode==='segment'?'本片段只记录已展示参考；校正来源未记录，仍是部分历史。':'当前只保留本页临时查看事实，不会补录先前或关闭期间内容。'};
   referenceConfirmationRef.current=confirmation;setReferenceConfirmation(confirmation);referenceTargetRef.current=null;setReferenceTarget(null);referencePanelRef.current=false;
   restoredSessionRef.current=null;pageInputGateRef.current.begin(e.getSnapshot());setTemporaryHistory(status.mode!=='legacy');mediaInteractedRef.current=false;standbyPausedRef.current=false;sceneMotionRef.current.enteredAt=performance.now();sceneMotionRef.current.mediaChangedAt=performance.now();setPaused(false);setShowSubtitle(false);syncDraft();e.setFrozen('modal',true);setPanel('reference-confirm');loadDemo();
   if(!document.hidden&&!disposed.current)showReferenceConfirmation();queueSave();
   if(status.error)notify('新练习已创建，历史记录未能开启；本次查看仅保留在当前页面。');
  }finally{referenceTransitionRef.current=false;if(!disposed.current&&owner===life.current)setReferenceBusy(false)}
 }
 async function loadCorrectedMaterial(material:Material){
  releaseOriginalMedia();const video=lessonRef.current,media=mediaRef.current;if(!video||!media)return;
  const token=++mediaToken.current,request=new AbortController();originalMediaRequest.current=request;setMediaDuration(0);video.pause();video.removeAttribute('src');video.load();videoPalette.sourceChanged('demo');media.kind='demo';media.name=`${material.title} · 本机校正版`;setMediaKind('demo');setMediaName(media.name);setShowSubtitle(false);if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='正在核验课程视频…'}
  const current=()=>!disposed.current&&!request.signal.aborted&&token===mediaToken.current&&engineRef.current?.getSnapshot().material===material;
  const fail=(message:string)=>{if(!current())return;correctedMediaRef.current=null;video.pause();if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='视频暂不可用，请重新加载'}setMediaDuration(0);notify(message)};
  video.onerror=()=>fail('校正版本的已核验原片未能播放。历史文字和成绩保留；没有切换为未核验 URL。');
  video.onloadedmetadata=()=>{if(!current())return;const error=correctedReferenceMediaError(material,originalMediaLease.current,video);if(error){fail(error);return}correctedMediaRef.current={identity:JSON.stringify(material),url:video.currentSrc};setMediaDuration(video.duration);pendingSeek.current=engineRef.current?.cue.start??0;seekTo(pendingSeek.current);if(visualRef.current)visualRef.current.ready=true};
  try{if(!await referenceRepository().isExactSavedMaterial(material))throw Error('校正版本在本机库中缺失或不匹配。历史文字和成绩保留，原片播放已停用。');if(!current())return;const lease=await originalMediaPool.acquire({signal:request.signal});if(!current()){lease.release();return}if(!lease.verified||lease.actualSha256!==material.localReference?.media.sha256){lease.release();throw Error('校正版本的原片字节校验未通过。')}originalMediaLease.current=lease;setBookmarkMediaReady(false);video.src=lease.url}
  catch(error){if(current())fail(error instanceof Error?error.message:'校正原片未能核验。')}
 }
 async function saveContextBookmark(cueId:string,start:number,end:number){
  const current=engineRef.current?.getSnapshot(),lease=originalMediaLease.current,video=lessonRef.current;
  if(panel!=='review'||!reviewSnapshot||!current||fixture||replaySnapshot.current||composing.current||mediaRef.current?.kind!=='demo'||!lease?.verified||!video||video.currentSrc!==lease.url||video.readyState<2)throw Error('当前参考或原片未能核验，收藏没有保存。请回到原创课程的已提交复盘后重试。');
  if(roundReviewCueIndex(current,reviewSnapshot,cueId)===null)throw Error('复盘已变化，请重新打开本轮复盘再收藏。');
  const reference=getBookmarkReference(current,cueId);
  if(!reference||!Number.isFinite(video.duration)||reference.endSeconds>video.duration)throw Error('原句版本或片段范围不可核验，收藏没有保存。');
  return contextRepository().save(reference,start,end);
 }
 function showCameraState(state:SceneVisual['camera']){if(visualRef.current)visualRef.current.camera=state;if(!disposed.current)setCameraState(state)}
 function releaseCameraStream(stream:MediaStream|null){if(!stream)return;if(cameraStreamRef.current===stream)cameraStreamRef.current=null;const video=cameraVideoOwnerRef.current??cameraRef.current;if(video?.srcObject===stream){video.pause();video.srcObject=null;if(cameraVideoOwnerRef.current===video)cameraVideoOwnerRef.current=null}for(const track of stream.getTracks())if(track.readyState!=='ended')track.stop()}
 function releaseCamera(){cameraToken.current++;cameraRequestRef.current=false;releaseCameraStream(cameraStreamRef.current);if(visualRef.current)visualRef.current.camera='off'}
 function stopCamera(){releaseCamera();showCameraState('off');if(!disposed.current){setCameraMessage('摄像头已关闭');if(visualRef.current?.layout==='camera'){setLayout('lesson');visualRef.current.layout='lesson'}}}
 function cancelPendingCamera(){if(cameraRequestRef.current)stopCamera()}
 async function openCamera(){
  if(disposed.current||cameraRequestRef.current)return;
  if(!navigator.mediaDevices?.getUserMedia){stopCamera();setCameraMessage('此浏览器没有可用摄像头接口。课程训练仍可继续。');showCameraState('error');return}
  stopCamera();const token=++cameraToken.current;cameraRequestRef.current=true;let acquired:MediaStream|null=null;
  const current=()=>!disposed.current&&token===cameraToken.current;
  showCameraState('requesting');setCameraMessage('等待浏览器授权；仅请求视频。');
  try{
   const stream=await navigator.mediaDevices.getUserMedia({video:selectedCamera?{deviceId:{exact:selectedCamera}}:true,audio:false});acquired=stream;
   if(!current()){releaseCameraStream(stream);return}
   cameraStreamRef.current=stream;const video=cameraRef.current;
   const disconnected=()=>{if(cameraStreamRef.current!==stream)return;stopCamera();if(!disposed.current){showCameraState('error');setCameraMessage('摄像头已断开，请重新选择设备后重试。')}};
   for(const track of stream.getVideoTracks())track.addEventListener('ended',disconnected,{once:true});
   if(!video||!stream.getVideoTracks().some(track=>track.readyState==='live'))throw Error('没有可用的视频轨道，请重新选择设备。');
   cameraVideoOwnerRef.current=video;video.srcObject=stream;await video.play();
   if(!current()){releaseCameraStream(stream);return}
   if(cameraStreamRef.current!==stream||video.srcObject!==stream||!stream.getVideoTracks().some(track=>track.readyState==='live')||!(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0))throw Error('摄像头画面尚未就绪，请重试。');
   cameraRequestRef.current=false;showCameraState('on');setCameraMessage('摄像头已开启 · 仅在本机，不镜像');
   try{const devices=await navigator.mediaDevices.enumerateDevices();if(current())setCameraDevices(devices.filter(d=>d.kind==='videoinput'))}catch{if(current())setCameraMessage('摄像头已开启；此浏览器暂不能列出其他设备。')}
  }catch(error){releaseCameraStream(acquired);if(current()){showCameraState('error');setCameraMessage(error instanceof Error?`摄像头未开启：${error.message}`:'摄像头未能开启，请重试。')}}
  finally{if(token===cameraToken.current)cameraRequestRef.current=false}
 }

 function updateArrangement(next:Arrangement){arrangementRef.current=next;if(visualRef.current)visualRef.current.arrangement=next}
 function currentLayout():LayoutConfiguration{return{layout:visualRef.current?.layout??layout,arrangement:arrangementRef.current}}
 function showLayout(value:LayoutConfiguration){updateArrangement(value.arrangement);setArrangement(value.arrangement);setLayout(value.layout);if(visualRef.current)visualRef.current.layout=value.layout}
 function layoutRecordingBusy(){return recordPreparing.current||!!recordInputRef.current||['recording','stopping'].includes(recorderRef.current?.getSnapshot().state??'idle')}
 function persistLayout(value:LayoutConfiguration){layoutCacheRef.current[portraitRef.current?'portrait':'landscape']=value.arrangement;try{localStorage.setItem(layoutStorageKey(portraitRef.current),JSON.stringify(value.arrangement))}catch{notify('布局已应用，本机偏好暂时无法保存。')}}
 function cancelLayoutPreview(focus=false){const before=layoutTransactionsRef.current.cancel();if(before)showLayout(before);layoutEditingRef.current=false;layoutReturnFocusRef.current=focus;setEditingLayout(false);setLayoutPreview(false);engineRef.current?.setFrozen('modal',!!dialogRef.current?.open||!!visualRef.current?.fixture||!!replaySnapshot.current)}
 function startLayoutPreview(){cancelFollow('review');if(layoutImportBusyRef.current)return false;if(layoutRecordingBusy()){notify('录制准备、录制或收尾期间不能预览布局；请先结束本段。');return false}if(fixture||replaySnapshot.current){notify('先返回真实训练，再编辑舞台布局。');return false}if(!layoutTransactionsRef.current.active){setLayoutUndoAvailable(layoutTransactionsRef.current.canUndo(currentLayout(),portraitRef.current));layoutTransactionsRef.current.begin(currentLayout(),{portrait:portraitRef.current,height:portraitHeightRef.current});setLayoutPreview(true)}return true}
 function previewLayout(next:Arrangement){if(layoutRecordingBusy()){cancelLayoutPreview();notify('录制状态已变化，布局预览已取消。');return}const value=layoutTransactionsRef.current.preview({layout:visualRef.current?.layout??layout,arrangement:next});if(value)showLayout(value)}
 function previewLayoutMode(next:SceneLayout){if(!startLayoutPreview())return;const value=layoutTransactionsRef.current.preview({layout:next,arrangement:arrangementRef.current});if(value)showLayout(value)}
 function setLayoutFileBusy(busy:boolean){layoutImportBusyRef.current=busy;setLayoutImportBusy(busy)}
 function importLayoutPreview(value:LayoutConfiguration,context:{portrait:boolean;height:number}){if(disposed.current||!layoutTransactionsRef.current.active||layoutRecordingBusy()||context.portrait!==portraitRef.current||(context.portrait&&context.height!==portraitHeightRef.current)||(value.layout!=='lesson'&&!cameraStreamRef.current?.getVideoTracks().some(track=>track.readyState==='live')))return false;const next=layoutTransactionsRef.current.preview(value);if(!next)return false;showLayout(next);return true}
 function finishLayout(){if(layoutImportBusyRef.current){notify('布局文件仍在读取，请稍候或取消预览。');return}const context=layoutTransactionsRef.current.context;if(context&&(context.portrait!==portraitRef.current||(context.portrait&&context.height!==portraitHeightRef.current))){cancelLayoutPreview();notify('视口已变化，未应用的布局预览已取消。');return}if(layoutRecordingBusy()){notify('录制状态已变化，请先结束本段再应用布局。');return}const value=layoutTransactionsRef.current.apply();if(!value)return;showLayout(value);persistLayout(value);setLayoutUndoAvailable(layoutTransactionsRef.current.canUndo(value,portraitRef.current));layoutEditingRef.current=false;setEditingLayout(false);setLayoutPreview(false);layoutReturnFocusRef.current=true;closePanel(false);dialogRef.current?.close();engineRef.current?.setFrozen('modal',!!visualRef.current?.fixture||!!replaySnapshot.current)}
 function beginLayout(){if(!startLayoutPreview())return;closePanel(false,true);dialogRef.current?.close();layoutEditingRef.current=true;setEditingLayout(true);engineRef.current?.setFrozen('modal',true);setToolsOpen(false)}
 function resetArrangement(){if(!startLayoutPreview())return;const value=layoutTransactionsRef.current.preview({layout:'lesson',arrangement:{}});if(value)showLayout(value)}
 function undoLayout(){if(layoutImportBusyRef.current)return;if(layoutRecordingBusy()){notify('请先结束本段，再撤销布局。');return}cancelLayoutPreview();const value=layoutTransactionsRef.current.undo(currentLayout(),portraitRef.current);if(!value){notify('没有与当前布局对应的可撤销应用。');return}showLayout(value);persistLayout(value);setLayoutUndoAvailable(false);layoutTransactionsRef.current.begin(value,{portrait:portraitRef.current,height:portraitHeightRef.current});setLayoutPreview(true)}
 function releaseMix(inputs:RecordingInputResources|null=recordInputRef.current){
  inputs?.release();
  if(recordInputRef.current===inputs)recordInputRef.current=null;
  if(activeRecordInputRef.current===inputs)activeRecordInputRef.current=null;
 }
 function cancelRecordingPreparation(){
  if(!recordPreparing.current)return;
  recordRequestToken.current++;recordPreparing.current=false;setStartingRecord(false);
  const inputs=recordInputRef.current;
  if(inputs&&activeRecordInputRef.current===inputs){void recorderRef.current?.stop().catch(()=>{});}
  else releaseMix(inputs);
 }
 async function startRecording(){cancelFollow('recording');
  if(document.hidden){notify('页面在后台；返回前台后请主动开始新的录像片段。');return}
  if(sceneFailureRef.current){notify(t('studio.displayInterrupted'));return}
  if(engineRef.current?.getSnapshot().material.builtinReference&&mediaRef.current?.kind==='demo'){const problem=currentCorrectedMediaError();if(problem){notify(problem);return}}
  if(referenceBlocked()){notify('请先完成参考版本切换与确认，再开始录制。');return}
  if(layoutTransactionsRef.current.active||layoutEditingRef.current){notify('布局仍在预览，请先应用或取消，再开始录制。');return}
  if(isPracticePaused(engineRef.current)){notify('练习已暂停；继续练习后可主动开始新的录像片段。');return}
  if(fixture||replaySnapshot.current){notify('参考预览或事件回放不产生本轮录像。先返回真实训练。');return}
  const canvas=canvasRef.current,recorder=recorderRef.current;
  if(!canvas||!recorder||!storageReady||recordPreparing.current||['recording','stopping'].includes(recorder.getSnapshot().state))return;
  recordStopRef.current=null;
  const request=++recordRequestToken.current,inputs=new RecordingInputResources();
  recordInputRef.current=inputs;recordPreparing.current=true;bookmarkPreviewRef.current?.setRecordingBlocked(true);referencePreviewRef.current?.setRecordingBlocked(true);referenceVerificationRef.current?.dispose();setStartingRecord(true);
  let mixFailure:Error|null=null,checkMixState:(()=>void)|null=null;
  const assertCurrent=()=>{
   // Check current visibility too: its event may still be queued behind this promise.
   if(document.hidden&&!disposed.current&&request===recordRequestToken.current&&recordInputRef.current===inputs)interruptPracticeRecording('页面后台化');
   checkMixState?.();if(mixFailure)throw mixFailure;inputs.assertActive();
   if(disposed.current||document.hidden||request!==recordRequestToken.current||recordInputRef.current!==inputs||isPracticePaused(engineRef.current))throw new RecordingPreparationCanceled();
  };
  try{
   if(listening.playerRef.current||listening.hasScope()){await listening.beforeTransition();assertCurrent()}
   if(!canvas.captureStream)throw Error('此浏览器不支持舞台录制');
   const stream=inputs.ownStream(canvas.captureStream(30));let label='无音频';let sourceTracks:MediaStreamTrack[]=[];
   if(lessonAudio||micAudio||promptAudio){
    if(typeof AudioContext==='undefined')throw Error('此浏览器没有可用音频混合，请关闭音频选项录制无声舞台。');
    if(micAudio&&!navigator.mediaDevices?.getUserMedia)throw Error('此浏览器无法获取麦克风，请关闭麦克风选项。');
    audioRef.current??=new AudioContext();const ac=audioRef.current;await ac.resume();assertCurrent();
    if(ac.state!=='running')throw Error('录制音频未能运行，请重新主动开始录制。');
    const onMixStateChange=()=>{
     if(ac.state==='running'||mixFailure||disposed.current||request!==recordRequestToken.current||recordInputRef.current!==inputs||recorderRef.current!==recorder||recorder.getSnapshot().state==='stopping')return;
     mixFailure=Error(activeRecordInputRef.current===inputs?'录制混音已中断，正在停止；已写入的数据将尽力保留，恢复后不会自动续录。':'录制音频在准备期间中断，本次录制未能开始，请重新主动录制。');
     // Fix the logical cutoff before releasing owned tracks; keep encoder tail draining.
     if(activeRecordInputRef.current===inputs)void stopRecording('录制混音中断');
     recordPreparing.current=false;setStartingRecord(false);releaseMix(inputs);
     notify(mixFailure.message);
    };
    checkMixState=onMixStateChange;
    ac.addEventListener('statechange',onMixStateChange);inputs.cleanup(()=>ac.removeEventListener('statechange',onMixStateChange));
    const dest=ac.createMediaStreamDestination();inputs.ownStream(dest.stream);inputs.cleanup(()=>dest.disconnect());
    if(lessonAudio&&lessonRef.current){
     const routing=await prepareCourseRouting();assertCurrent();inputs.cleanup(routing.connectRecording(dest));label='含课程音频';
    }
    if(micAudio){
     const mic=inputs.ownStream(await navigator.mediaDevices.getUserMedia({audio:true,video:false}));assertCurrent();
     sourceTracks=mic.getAudioTracks();if(!sourceTracks.length||sourceTracks.some(t=>t.readyState!=='live'))throw Error('麦克风已断开，录制未能开始。');
     const source=ac.createMediaStreamSource(mic);source.connect(dest);inputs.cleanup(()=>source.disconnect());label=lessonAudio?'含课程音频和麦克风':'含麦克风';
    }
    if(promptAudio){const cues=submissionSound.audio.current;if(!cues)throw Error('提示音控制尚未准备。');inputs.cleanup(cues.attachRecordingTarget(ac,dest));}
    label='含'+[lessonAudio?'课程音频':null,micAudio?'麦克风':null,promptAudio?'提交提示音':null].filter(Boolean).join('、');
    stream.addTrack(dest.stream.getAudioTracks()[0].clone());
   }
   assertCurrent();if(visualRef.current?.fixture||replaySnapshot.current)throw new RecordingPreparationCanceled();
   activeRecordInputRef.current=inputs;
   await recorder.start(stream,{source:'canvas-composite',audioLabel:label,sourceTracks});
   assertCurrent();
   recordPreparing.current=false;setStartingRecord(false);closePanel();notify('已开始录制同一舞台，设置面板不会入镜。');
  }catch(error){
   releaseMix(inputs);
   if(!mixFailure&&request===recordRequestToken.current&&!disposed.current)notify(error instanceof Error?error.message:'录制未能开始');
  }finally{if(request===recordRequestToken.current){recordPreparing.current=false;bookmarkPreviewRef.current?.setRecordingBlocked(bookmarkRecordingBlocked());referencePreviewRef.current?.setRecordingBlocked(bookmarkRecordingBlocked());setStartingRecord(false)}}
 }
 function stopRecording(reason:'用户停止'|'练习暂停'|'录制混音中断'|'画面渲染中断'|'页面后台化'='用户停止'):Promise<void>{
  const recorder=recorderRef.current;if(!recorder)return Promise.resolve();
  if(recordStopRef.current?.recorder===recorder)return recordStopRef.current.promise;
  const inputs=activeRecordInputRef.current,request=recordRequestToken.current;
  // stop() fixes the logical cutoff synchronously; final chunks remain drainable.
  const stopped=recorder.stop(reason);
  const promise=stopped.then(record=>{releaseMix(inputs);if(request===recordRequestToken.current&&!disposed.current){
   const failure=recorder.getSnapshot().error;
   // A controller-originated stop may predate the visibility event. Announce its
   // actual result using safe codes instead of attributing that stop to backgrounding.
   if(reason==='页面后台化'&&failure?.code!=='PAGE_BACKGROUND_INTERRUPTED'){
    notify(record.complete?'录像已停止，请在本机录像中检查与下载。':recordingFailureMessage(failure,record.bytes));return;
   }
   notify(reason==='页面后台化'?(record.bytes>0?'页面已进入后台，录像已中断，已写入片段保留；返回前台不会自动续录，请在本机录像中检查。':'页面已进入后台，录像已中断，尚未确认有已写入的录像数据；返回前台不会自动续录。'):reason==='画面渲染中断'?t('studio.displayRecordingStopped'):reason==='录制混音中断'?(record.bytes>0?'录制混音已中断，已写入片段保留；请在本机录像中检查，声音可能不完整。':'录制混音已中断，尚未确认有已写入的录像数据。'):record.complete?'录像已停止，请在本机录像中检查与下载。':'录像未完整收尾，已提交片段保留；请在本机录像中检查。')}},error=>{releaseMix(inputs);if(request===recordRequestToken.current&&!disposed.current)notify(error instanceof Error?error.message:'录像收尾失败，已提交片段保留。')}).finally(()=>{if(recordStopRef.current?.promise===promise)recordStopRef.current=null});
  recordStopRef.current={recorder,promise};return promise;
 }
 function interruptPracticeRecording(reason:'练习暂停'|'页面后台化'='练习暂停'){
  const inputs=recordInputRef.current,active=activeRecordInputRef.current,recorder=recorderRef.current;
  if(reason==='页面后台化'&&!inputs&&!active&&!recordPreparing.current)return;
  recordRequestToken.current++;recordPreparing.current=false;setStartingRecord(false);
  if(active||['recording','stopping'].includes(recorder?.getSnapshot().state??'idle'))void stopRecording(reason);
  // Only this recording's composite/mix/mic inputs. The independent camera is retained.
  releaseMix(inputs);if(active!==inputs)releaseMix(active);
 }
 async function openPanel(next:Panel){cancelFollow(next==='record'?'recording':'review');if(!next)return;listening.playerRef.current?.pause();if(referenceBlocked()&&next!=='reference-confirm')return;if(next!=='camera'&&visualRef.current?.camera==='requesting')cancelPendingCamera();if(next!=='references'){referencePanelRef.current=false;referenceActionRef.current++;referencePreviewRef.current?.close()}if(next==='record'&&layoutTransactionsRef.current.active){notify('布局仍在预览，请先应用或取消，再开始录制。');return}if(next==='layout'&&!startLayoutPreview())return;if(next!=='layout'&&layoutTransactionsRef.current.active)cancelLayoutPreview();cancelTypingErrorFeedback();submissionSound.audio.current?.cancel();setMutedRecord(null);clearRecordingPreview();if(next!=='record')cancelRecordingPreparation();lastFocus.current=document.activeElement as HTMLElement;engineRef.current?.setFrozen('modal',true);if(next==='record')void recorderRef.current?.refreshStorageEstimate();if(next==='review')setReviewSnapshot(engineRef.current?.getSnapshot()??null);if(next==='review-tasks')void refreshReviewTasks().catch(()=>{});if(next==='data'&&engineRef.current)exportRef.current=listening.conditionsRef.current?.identity.sessionId===engineRef.current.getSnapshot().sessionId?exportListeningPage(engineRef.current.getSnapshot(),listening.conditionsRef.current):exportSession(engineRef.current.getSnapshot());if(next==='library'){try{setRecordings(await recorderRef.current?.list()??[])}catch(e){notify(e instanceof Error?e.message:'无法读取本机录像')}}setPanel(next)}
 function closePanel(restoreFocus=true,keepLayoutPreview=false){if(referenceTransitionRef.current||reviewTransitionRef.current||reviewStartFailureRef.current)return;if(visualRef.current?.camera==='requesting')cancelPendingCamera();if(referenceConfirmationRef.current){if(!referenceConfirmationRef.current.exposed){notify('请先主动查看新版本确认参考，再开始输入。');return}referenceConfirmationRef.current=null;setReferenceConfirmation(null)}referencePanelRef.current=false;referenceActionRef.current++;referencePreviewRef.current?.close();referenceVerificationRef.current?.dispose();if(!keepLayoutPreview&&layoutTransactionsRef.current.active)cancelLayoutPreview();setMutedRecord(null);clearRecordingPreview();setToolsOpen(false);cancelRecordingPreparation();setPanel(null);engineRef.current?.setFrozen('modal',!!visualRef.current?.fixture||!!replaySnapshot.current);if(previewURL.current){URL.revokeObjectURL(previewURL.current);previewURL.current=null;setPreview(null);setPreviewInfo(INITIAL_PREVIEW_INFO)}setDeleteId(null);setResetPrompt(false);if(restoreFocus)requestAnimationFrame(()=>lastFocus.current?.focus({preventScroll:true}))}
 function openSubtitleWorkbench(){cancelFollow('review');
  const state=recorderRef.current?.getSnapshot().state;
  if(recordPreparing.current||state==='recording'||state==='stopping'||referenceBlocked()){
   notify('请先完成或停止录制／当前参考操作，再打开本机字幕准备。');return;
  }
  lessonRef.current?.pause();cancelTypingErrorFeedback();submissionSound.audio.current?.cancel();
  window.open('/subtitle-workbench/','_blank','noopener,noreferrer');
 }
 function exitReplay(){replaySnapshot.current=null;setReplayIndex(null);engineRef.current?.setFrozen('modal',false);syncDraft()}
 function submit(gesture=false){cancelFollow('check');if(listening.playerRef.current?.getState().mode==='listen'||referenceBlocked()||builtinAnswerBlocked())return;const engine=engineRef.current,view=visualRef.current;if(!engine||!view||fixture||replaySnapshot.current||isPracticePaused(engine)||mediaKind!=='demo'||composing.current)return;if(!hasScorableReference(engine.cue.text)){notify('当前素材没有可判定的英文参考文本，暂不判分。请选择有参考文本的练习。');return}if(engine.currentResult){if(engine.currentResult.errors===0){changeCue((engine.getSnapshot().cueIndex+1)%engine.getSnapshot().material.cues.length,true,gesture);return}notify('这份输入已经检查过，修改后再确认。');return}applyReferenceGuideExposure();const listeningCapture=listening.captureSubmit(engine.getSnapshot());const fixedPaceAdmission=fixedPaceScopeRef.current?fixedPaceFrame():null;const attempt=engine.submit();listening.completeSubmit(listeningCapture,engine.getSnapshot());if(!attempt){notify('先输入你听到的英文，再确认。');inputRef.current?.focus();return}checkFixedPace(attempt,fixedPaceAdmission);observeReviewAttempt(attempt);typingErrorFeedback.control.current?.submission(attempt.errors,attempt.firstCompletion,submissionSound.audio.current?.getSnapshot?.()?.enabled??false);submissionSound.audio.current?.play(attempt.firstCompletion?'firstCompletion':attempt.errors===0?'correct':'correction',attempt.attemptId);setResult({...attempt,announcement:{kind:attempt.firstCompletion?'firstCompletion':attempt.errors===0?'correct':'correction',total:engine.getSnapshot().earnedWords,locale}});view.lastResult=attempt;view.gain=attempt.gain;view.rewardAttemptId=attempt.attemptId;view.rewardAt=performance.now();view.message=''}
 function changeCue(index:number,focusInput=true,gesture=false){cancelFollow('cue-change');if(referenceBlocked())return;if(listening.playerRef.current?.getState().mode==='listen'){const cue=engineRef.current?.getSnapshot().material.cues[index];if(cue)listening.playerRef.current.seek(cue.start);return}cancelTypingErrorFeedback();submissionSound.audio.current?.cancel();if(fixture||replaySnapshot.current){notify('先返回真实训练，再切换句子。');return}const e=engineRef.current;if(!e||mediaRef.current?.kind!=='demo'||!Number.isInteger(index)||index<0||index>=e.getSnapshot().material.cues.length)return;if(reviewBindingRef.current&&e.getSnapshot().material.cues[index].id!==reviewBindingRef.current.cueId)stopReviewTracking('已离开复测目标句；本轮不再推进复习任务。');if(strictCourse(e.getSnapshot().material)){correctedPlayRequest.current++;correctedPlayOwner.current=null}const changed=index!==e.getSnapshot().cueIndex;mediaInteractedRef.current=true;e.nextCue(index);lessonRef.current?.pause();if(listening.playerRef.current?.getState().mode==='type'){listening.playerRef.current.type(index);listening.playerRef.current.seek(e.cue.start)}seekTo(e.cue.start);setShowSubtitle(false);syncDraft();if(gesture&&changed)armFollowAutoEntry(followAutoEpochRef.current);if(focusInput)inputRef.current?.focus({preventScroll:true})}
 function navigationCueIndex(state:{active:boolean;mode:string;position:number}|undefined=listening.playerRef.current?.getState()){const e=engineRef.current;if(!e)return 0;const snapshot=e.getSnapshot();if(!state?.active||state.mode!=='listen'||!Number.isFinite(state.position))return snapshot.cueIndex;const index=snapshot.material.cues.findIndex(c=>state.position<c.end);return index<0?snapshot.material.cues.length-1:index}
 function continueRoundReview(cueId:string){const engine=engineRef.current;if(!engine||!reviewSnapshot||panel!=='review'||fixture||replaySnapshot.current||restoreFailedRef.current||mediaRef.current?.kind!=='demo'||isPracticePaused(engine)||composing.current)return;const index=roundReviewCueIndex(engine.getSnapshot(),reviewSnapshot,cueId);if(index===null){notify('本轮内容已变化，请重新打开复盘。');return}closePanel(false);dialogRef.current?.close();changeCue(index)}
 function togglePlay(restart=false){const wasFollowPlaying=followPauseClickRef.current||!!followRef.current?.active&&!lessonRef.current?.paused;followPauseClickRef.current=false;cancelFollow(restart?'manual-replay':wasFollowPlaying?'manual-pause':'manual-play');if(wasFollowPlaying&&!restart)return;if(referenceBlocked())return;if(listening.playerRef.current?.getState().active){const player=listening.playerRef.current;if(restart)player.repeatCurrent();else if(player.getState().playing)player.pause();else void player.play();return}const selected=engineRef.current?.getSnapshot().material;if(selected?.builtinReference&&!builtinMediaReady&&courseError){if(!document.hidden&&!bookmarkRecordingBlocked())void loadBuiltinMaterial(selected);return}if(reviewMediaRef.current&&reviewMediaRef.current.sessionId===engineRef.current?.getSnapshot().sessionId){const problem=reviewMediaError(reviewMediaRef.current.target);if(problem){notify(problem);return}}if(engineRef.current&&strictCourse(engineRef.current.getSnapshot().material)&&mediaRef.current?.kind==='demo'){void toggleCorrectedPlay(restart);return}const video=lessonRef.current,e=engineRef.current;if(!video||mediaKind==='image')return;if(mediaKind==='demo'&&mediaRef.current?.kind==='demo'&&e&&!fixture&&!replaySnapshot.current)e.activatePractice();mediaInteractedRef.current=true;if(!video.paused&&!restart){video.pause();return}if(mediaKind==='demo'&&e&&(restart||video.currentTime<e.cue.start||video.currentTime>=e.cue.end)){if(!seekTo(e.cue.start)){notify('素材正在准备定位，请稍候再播放。');return}}if(courseRoutingRef.current)void prepareCourseRouting().catch(error=>notify(error instanceof Error?error.message:'课程监听未能恢复，请重试。'));video.play().catch(()=>notify('播放未能开始，请再次点击或更换素材。'))}

 async function toggleCorrectedPlay(restart=false,follow?:{intent:TypingFollowIntent;current:()=>boolean;prepare:()=>boolean;issued?:()=>void;pause:()=>void}):Promise<boolean>{
  const e=engineRef.current,video=lessonRef.current;if(!e||!video||referenceBlocked()||mediaRef.current?.kind!=='demo')return false;
  if(!follow&&!video.paused&&!restart){correctedPlayRequest.current++;correctedPlayOwner.current=null;e.activatePractice();video.pause();return false}
  const material=e.getSnapshot().material,session=e.getSnapshot().sessionId,cueId=e.cue.id,token=follow?Number(follow.intent.scope.ownerId):++correctedPlayRequest.current,url=video.currentSrc;
  if(!follow)correctedPlayOwner.current=null;
  const current=()=>!disposed.current&&!document.hidden&&!referenceBlocked()&&!listening.playerRef.current?.getState().active&&token===correctedPlayRequest.current&&engineRef.current===e&&e.getSnapshot().sessionId===session&&e.cue.id===cueId&&e.getSnapshot().material===material&&mediaRef.current?.kind==='demo'&&video.currentSrc===url&&(!follow||follow.current());
  let requestOwner:typeof correctedPlayOwner.current=null;
  try{
   if(!(material.builtinReference?isBuiltinMaterial(material):await referenceRepository().isExactSavedMaterial(material)))throw Error(material.builtinReference?'固定真人素材版本缺失或已改变，未播放。历史文字和成绩保留。':'本机校正版本缺失或已改变，未播放。历史文字和成绩保留。');
   if(!current())return false;const error=currentCorrectedMediaError();if(error)throw Error(error);
   if(!follow)e.activatePractice();mediaInteractedRef.current=true;
   if(!follow&&(restart||video.currentTime<e.cue.start||video.currentTime>=e.cue.end)){if(!seekTo(e.cue.start))throw Error('校正素材正在准备定位，请稍候再播放。')}
   // Native resume and play must both begin inside the explicit gesture.
   // Observe async completion without delaying the already verified source.
   const routing=courseRoutingRef.current?prepareCourseRouting().then(()=>null,error=>({error})):Promise.resolve(null);if(!current())return false;
   if(follow?.intent.type==='start-cue')pendingSeek.current=null;
   if(follow&&!follow.prepare())return false;
   requestOwner={token,identity:JSON.stringify(material),url};correctedPlayOwner.current=requestOwner;
   const nativePlay=video.play();follow?.issued?.();const [routeResult]=await Promise.all([routing,nativePlay]);if(routeResult)throw routeResult.error;
   if(!current()){
    // A late promise may silence only its own request, never a newer play/source owner.
    if(token===correctedPlayRequest.current&&video.currentSrc===url&&(!correctedPlayOwner.current||correctedPlayOwner.current===requestOwner)){if(follow)follow.pause();else video.pause()}
    return false;
   }
   if(follow&&(video.currentTime<e.cue.start||video.currentTime>=e.cue.end)){follow.pause();return false}
   return true;
  }catch(error){if(current()){correctedPlayOwner.current=null;if(follow)follow.pause();else video.pause();notify(error instanceof Error?error.message:'校正片段未能播放，请重试。')}return false}
 }

 function reveal(){if(referenceBlocked()||builtinAnswerBlocked())return;if(fixture||replaySnapshot.current||mediaKind!=='demo')return;const visible=!referenceVisibleRef.current;if(visible)engineRef.current?.exposeHint('reveal');setReferenceGuideVisible(visible)}
 function pauseTraining(){cancelFollow('manual-pause');if(referenceBlocked())return;cancelTypingErrorFeedback();submissionSound.audio.current?.cancel();const engine=engineRef.current;if(!engine)return;const next=!isPracticePaused(engine);engine.activatePractice();if(next)whiteNoise.setEnabled(false);setWholePracticePaused(engine,next,{pauseLesson:()=>{listening.playerRef.current?.pause();lessonRef.current?.pause()},interruptRecording:interruptPracticeRecording});standbyPausedRef.current=next;setPaused(next);if(visualRef.current)visualRef.current.paused=next;if(next&&composing.current){interruptedCompositionRef.current=true;composing.current=false;engine.setFrozen('composition',false);if(inputRef.current)inputRef.current.value=engine.draft;if(visualRef.current)visualRef.current.composition=false}}
 async function chooseFile(file:File){cancelFollow('course-change');if(referenceBlocked())return;await listening.beforeTransition();const media=mediaRef.current,video=lessonRef.current;if(!media||!video)return;const kind=file.type.startsWith('video/')?'video':file.type.startsWith('image/')?'image':null;if(!kind){notify('请选择浏览器支持的视频或图片。');return}stopReviewTracking('已切换媒体，本轮不再推进复习任务。');releaseOriginalMedia();setCourseError('');videoPalette.sourceChanged(kind);setMediaDuration(0);const token=++mediaToken.current;if(visualRef.current){visualRef.current.ready=false;visualRef.current.message='正在加载本机素材…'}video.pause();engineRef.current?.setFrozen('listening',false);engineRef.current?.setFrozen('idle',true);if(localURL.current)URL.revokeObjectURL(localURL.current);localURL.current=URL.createObjectURL(file);media.kind=kind;media.name=file.name;setMediaKind(kind);setMediaName(file.name);if(kind==='image'){media.image.onload=()=>{if(token===mediaToken.current&&!disposed.current&&visualRef.current){visualRef.current.ready=true;visualRef.current.message=''}};media.image.onerror=()=>{if(token!==mediaToken.current)return;if(visualRef.current)visualRef.current.message='图片未能载入，请重新选择';notify('图片无法解码，请选择其他文件。')};media.image.src=localURL.current}else{video.onerror=()=>{if(token!==mediaToken.current)return;if(visualRef.current)visualRef.current.message='视频未能载入，请重新选择';notify('此视频在当前浏览器中无法播放，请换一种编码或返回原创素材。')};video.onloadedmetadata=()=>{if(token===mediaToken.current&&!disposed.current&&visualRef.current){setMediaDuration(Number.isFinite(video.duration)?video.duration:0);visualRef.current.ready=true;visualRef.current.message=''}};video.src=localURL.current}closePanel()}
 function updatePreviewInfo(video:HTMLVideoElement,phase:'loading'|'metadata'|'ended'|'error'){if(video.getAttribute('src')!==previewURL.current)return false;setPreviewInfo(phase==='loading'?INITIAL_PREVIEW_INFO:recordingPreviewInfo(video.duration,phase==='ended'||video.ended,phase==='error'||!!video.error));return true}
 function clearRecordingPreview(){recordingPreviewRequest.current++;if(previewURL.current)URL.revokeObjectURL(previewURL.current);previewURL.current=null;setPreview(null);setPreviewInfo(INITIAL_PREVIEW_INFO)}
 async function previewRecording(id:string){clearRecordingPreview();const request=recordingPreviewRequest.current,owner=life.current;try{const blob=await recorderRef.current!.blob(id);if(disposed.current||owner!==life.current||request!==recordingPreviewRequest.current)return;previewURL.current=URL.createObjectURL(blob);setPreviewInfo(INITIAL_PREVIEW_INFO);setPreview(previewURL.current)}catch(e){if(!disposed.current&&owner===life.current&&request===recordingPreviewRequest.current)notify(e instanceof Error?e.message:'录像无法预览')}}
 async function saveRecording(record:RecordMeta){try{const blob=await recorderRef.current!.blob(record.id);download(`lingotrace-studio-${record.id}.${record.extension}`,blob);notify('已发起下载，请检查浏览器下载列表。')}catch(e){notify(e instanceof Error?e.message:'下载未能开始')}}
 function downloadScene(){canvasRef.current?.toBlob(b=>{if(b){download(`lingotrace-studio-${fixture?'reference':'scene'}.png`,b);notify('已发起舞台截图下载。')}else notify('图片未能生成。')},'image/png')}
 useLayoutEffect(()=>{
  const stage=stageRef.current;if(!stage)return;
  const measure=()=>{const {width,height}=stage.getBoundingClientRect();if(width<=0||height<=0)return;const next={width,height};cameraViewportRef.current=next;if(visualRef.current)visualRef.current.cameraViewport=next;setCameraViewport(previous=>previous?.width===width&&previous.height===height?previous:next)};
  measure();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;observer?.observe(stage);window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure)};
 },[portrait,portraitHeight,fixture]);
 useEffect(()=>{const hideCamera=()=>stopCamera();window.addEventListener('pagehide',hideCamera);return()=>{window.removeEventListener('pagehide',hideCamera);releaseCamera()}},[]);
 useEffect(()=>{disposed.current=false;const generation=++life.current,followBootstrapEpoch=followAutoEpochRef.current;const lesson=lessonRef.current!,camera=cameraRef.current!,canvas=canvasRef.current!;const poster=new Image(),localImage=new Image(),reference=new Image();reference.src='/studio-assets/06-reference.png';mediaRef.current={lesson,camera,poster,image:localImage,reference,kind:'demo',name:mediaName};const initialPortrait=responsive&&readViewport('auto').portrait;portraitRef.current=initialPortrait;setPortrait(initialPortrait);const engine=new TrainingEngine({material:NPS_MATERIAL,deferInitialPractice:true,inputObservation:{runId:crypto.randomUUID()}});engineRef.current=engine;pageInputGateRef.current.begin(engine.getSnapshot());inputProjectorRef.current=new TransparentInputProjector();inputProjectorRef.current.attach(engine.getSnapshot(),performance.now());sceneMotionRef.current={enteredAt:performance.now(),mediaChangedAt:0,mediaLoading:true};try{arrangementRef.current=(initialPortrait?(raw:unknown)=>parsePortraitArrangement(raw,portraitHeightRef.current):parseArrangement)(JSON.parse(localStorage.getItem(layoutStorageKey(initialPortrait))||'{}'));layoutCacheRef.current[initialPortrait?'portrait':'landscape']=arrangementRef.current;setArrangement(arrangementRef.current)}catch{}visualRef.current={locale:localeRef.current,arrangement:arrangementRef.current,layout:'lesson',cameraViewport:cameraViewportRef.current,fixture:false,showSubtitle:true,paused:false,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:false,playbackTime:0,playbackDuration:72,renderTime:0,snapshot:engine.getSnapshot()};setReducedMotion(visualRef.current.reducedMotion);lesson.volume=.8;const repo=new IndexedDBTrainingRepository();repoRef.current=repo;const unsubRepo=repo.subscribe(()=>setPersistence(repo.getStatus()));const history=new TrainingHistoryRecorder(repo);historyRef.current=history;historyPageInactiveRef.current=false;const unsubHistory=history.subscribe(()=>setHistoryStatus(history.getSnapshot()));let unsubscribe=engine.subscribe(queueSave);const tabRecovery=bindTrainingTabRecovery({storage:()=>window.sessionStorage,repository:repo,history,snapshot:()=>engineRef.current?.getSnapshot()??null,isCurrent:()=>!disposed.current&&generation===life.current,onError:()=>setRecoveryStorageError(true)});readDefaultCourseBootstrap(repo,new URLSearchParams(window.location.search).get('resume'),new URLSearchParams(window.location.search).get('resumeSequence'),tabRecovery.read).then(async({saved,control,temporary,listeningSession})=>{if(disposed.current||generation!==life.current)return;if(listeningSession)listening.restoreScope(listeningSession);if(saved){restoredSessionRef.current=saved.sessionId;unsubscribe();const restored=new TrainingEngine({snapshot:saved,restoredReadOnly:control.state==='legacy-default',inputObservation:{runId:crypto.randomUUID()}});restored.setFrozen('background',document.hidden);restored.setFrozen('listening',false);restored.setFrozen('modal',false);engineRef.current=restored;pageInputGateRef.current.begin(restored.getSnapshot());inputProjectorRef.current?.attach(restored.getSnapshot(),performance.now());setPaused(restored.getSnapshot().frozenReasons.includes('paused'));unsubscribe=restored.subscribe(queueSave);syncDraft()}else{restoredSessionRef.current=null}if(saved&&engineRef.current!.isPassiveRestored)history.connectRestoredBaseline(engineRef.current!.getSnapshot(),control,saved);else if(engineRef.current!.isAwaitingInitialInput)history.connectFreshPreview(engineRef.current!.getSnapshot(),control);else history.connect(engineRef.current!.getSnapshot(),control);setTemporaryHistory(temporary);if(saved)tabRecovery.rememberRestored(saved,control);queueSave();setReady(true);await loadDemo();if(disposed.current||generation!==life.current)return;const requestedCourse=parseCourseQueryParam(new URLSearchParams(window.location.search).get('course'));
const deepLink=resolveCourseDeepLink({
  requested:requestedCourse,
  currentMaterialId:engineRef.current?.getSnapshot().material.id,
  hasRestoredSession:saved!==null,
  freshAwaitingInput:!!(engineRef.current&&engineRef.current===engine&&engine.isAwaitingInitialInput),
});
if(deepLink.kind==='auto-start'&&engineRef.current===engine&&engine.isAwaitingInitialInput){
  try{await startBuiltinPractice(deepLink.course==='cafe'?CAFE_MATERIAL:NPS_MATERIAL,false,followBootstrapEpoch)}
  catch(error){if(!disposed.current&&generation===life.current){setCourseError(error instanceof Error?error.message:(deepLink.course==='cafe'?'咖啡馆课程未能准备。':'NPS 课程未能准备。'));notify(error instanceof Error?error.message:(deepLink.course==='cafe'?'咖啡馆课程未能准备。':'NPS 课程未能准备。'))}}
  if(disposed.current||generation!==life.current)return;
}else if(deepLink.kind==='prompt-switch'&&!disposed.current&&generation===life.current){
  setCourseIntent(deepLink.course);
}
if(saved===null&&engineRef.current&&engineRef.current.isAwaitingInitialInput&&fixedPaceSourceQualified())armFollowAutoEntry(followBootstrapEpoch,true);
const wantFollowBoot=parseFollowQueryParam(new URLSearchParams(window.location.search).get('follow'));
if(wantFollowBoot&&saved===null&&engineRef.current&&engineRef.current.isAwaitingInitialInput&&referenceVisibleRef.current){
  pacingStrategyRef.current='adaptive';setPacingStrategy('adaptive');
  armFollowAutoEntry(followBootstrapEpoch,true);
  setPaceSheetOpen(true);
}if(saved&&control.state==='legacy-default')void restoreSavedReviewBinding(engineRef.current!.getSnapshot())}).catch(()=>{if(disposed.current||generation!==life.current)return;restoreFailedRef.current=true;setRestoreFailed(true);notify('本机记录恢复失败，已暂停自动保存；请重试恢复。原记录未清空。');setReady(true);lesson.pause();lesson.removeAttribute('src');lesson.load();if(visualRef.current)visualRef.current.ready=false;setMediaDuration(0)});let reconcileBusy=false;const reconcileHistory=async()=>{if(reconcileBusy||disposed.current||historyPageInactiveRef.current||restoreFailedRef.current||!engineRef.current)return;const before=history.getSnapshot();if(before.mode==='enabling'||before.mode==='unprepared')return;reconcileBusy=true;try{const control=await repo.readAutomaticHistoryControl();if(disposed.current||historyPageInactiveRef.current||history.getSnapshot().control!==before.control||history.getSnapshot().mode!==before.mode)return;if(control.state!==before.control?.state||control.generation!==before.control?.generation){listening.stopCapture();stopReviewTracking('历史许可已改变，本页复习跟踪已停止。');if(history.isFreshPreview)history.connectFreshPreview(engineRef.current.getSnapshot(),control);else history.connect(engineRef.current.getSnapshot(),control);setTemporaryHistory(true);notify('练习历史设置已在其他页面改变。本页练习保留，开启需从现在重新记录。')}}catch{notify('暂时无法核对练习历史设置；写入仍会检查许可。')}finally{reconcileBusy=false}};historyReconcileRef.current=reconcileHistory;let historyChannel:BroadcastChannel|null=null;try{historyChannel=new BroadcastChannel('lingotrace-history-control-v1');historyChannel.onmessage=()=>{void reconcileHistory()};historyChannelRef.current=historyChannel}catch{}let exitHistorySave:Promise<void>|null=null;let recorder=new SceneRecorder();recorderRef.current=recorder;let observedRecorder=recorder.getSnapshot();const onRecorderChange=()=>{const state=recorder.getSnapshot();const release=isNewRecordingTerminal(observedRecorder,state);observedRecorder=state;if(layoutTransactionsRef.current.active&&['recording','stopping'].includes(state.state)){cancelLayoutPreview();notify('录制状态已变化，布局预览已取消。')}bookmarkPreviewRef.current?.setRecordingBlocked(recordPreparing.current||['recording','stopping'].includes(state.state));referencePreviewRef.current?.setRecordingBlocked(recordPreparing.current||['recording','stopping'].includes(state.state));setRecordState(state);if(release)releaseMix(activeRecordInputRef.current)};let unsubRecorder=recorder.subscribe(onRecorderChange);recorder.prepare().then(()=>{if(!disposed.current)setStorageReady(true)}).catch(e=>{setStorageError(e instanceof Error?e.message:'本机录像暂存不可用');});const draw=(_rafTime:number)=>{const now=performance.now();if(disposed.current)return;sceneRenderPhaseRef.current='context';const context=canvas.getContext('2d',{alpha:false});if(!context||context.isContextLost?.())throw Error('Canvas context unavailable');const v=visualRef.current,m=mediaRef.current,e=engineRef.current;if(v&&m&&e){sceneRenderPhaseRef.current='snapshot';v.locale=localeRef.current;v.keyboardPlacement=keyboardPlacementRef.current;v.renderTime=now;v.snapshot=replaySnapshot.current??e.getSnapshot();const input=inputRef.current;v.draft=replaySnapshot.current?getDraft(replaySnapshot.current).text:input?.value??e.draft;v.lastResult=replaySnapshot.current?getCurrentResult(replaySnapshot.current):e.currentResult;v.inputFocused=!replaySnapshot.current&&document.activeElement===input;v.caret=input?.selectionStart??v.draft.length;v.selectionEnd=input?.selectionEnd??v.caret;v.scrollLeft=replaySnapshot.current?0:(input?.scrollLeft??0)*responsiveLayout(portraitRef.current&&!v.fixture,{},'lesson',portraitHeightRef.current).width/((stageRef.current?.getBoundingClientRect().width||DESIGN.width)*responsiveLayout(portraitRef.current&&!v.fixture,{},'lesson',portraitHeightRef.current).inputScale);v.scrollTop=replaySnapshot.current?0:((inputViewportRef.current??input)?.scrollTop??0);v.underlineMode=inputStyleRef.current.endsWith('words')?'words':'letters';const activeListening=listening.playerRef.current?.getState();v.referenceGuide=referenceVisibleRef.current&&!document.hidden&&!v.fixture&&!replaySnapshot.current&&v.ready&&m.kind==='demo'&&!referenceBlocked()&&!builtinAnswerBlocked()&&activeListening?.mode!=='listen'?e.cue.text:undefined;if(v.ready)referenceExposureRef.current.syncSession(e.getSnapshot());if(v.referenceGuide&&!referenceExposureRef.current.observe(e.getSnapshot()))v.referenceGuide=undefined;v.referenceGuideUnavailable=referenceExposureRef.current.unavailable;const nextFollowReady=!!v.referenceGuide&&!v.referenceGuideUnavailable;if(nextFollowReady!==followReadyRef.current){followReadyRef.current=nextFollowReady;setFollowReady(nextFollowReady)}if(v.referenceGuideUnavailable&&!guideStorageErrorRef.current){guideStorageErrorRef.current=true;setGuideStorageError(true)}v.inputGuide=referenceVisibleRef.current&&activeListening?.mode!=='listen'&&!replaySnapshot.current&&inputGuideOwnerRef.current===inputGuideOwner()&&getDraft(engineRef.current!.getSnapshot()).hinted?{mode:v.underlineMode as InputUnderlineMode,mask:inputGuideMask(engineRef.current!.cue.text)}:undefined;v.keyboardFeedback={visible:!portraitRef.current&&keyboardVisibleRef.current&&!softwareKeyboardRef.current,codes:[...pressedKeysRef.current].filter(([,at])=>now-at<3000).map(([code])=>code),committedUntil:committedUntilRef.current,composing:composing.current};sceneRenderPhaseRef.current='native-input';if(input&&!v.fixture&&!replaySnapshot.current){const scale=(stageRef.current?.getBoundingClientRect().width||DESIGN.width)/(portraitRef.current?430:1672);syncNativeFeedback(input,activeListening?.mode==='listen'?null:getDraftFeedback(v.snapshot,v.draft,v.composition).attempt,v.referenceGuide,v.composition);v.nativeInputDisplay=inputViewportRef.current?syncInputViewport(input,inputViewportRef.current,v.inputGuide,scale,inputCaretPendingRef.current,v.referenceGuide,portraitRef.current):captureNativeInputDisplay(input,scale);inputCaretPendingRef.current=false}else v.nativeInputDisplay=undefined;sceneRenderPhaseRef.current='media-state';const activeLesson=m.lesson;const listeningState=listening.playerRef.current?.getState();v.listeningDisplay=listeningState?.active&&listeningState.mode==='listen'?{active:true,hidden:!listeningState.textVisible||document.hidden,text:listeningState.frame.text,cueId:listeningState.frame.cueId,targetKey:listeningState.frame.targetKey,cadence:listeningState.cadence}:undefined;v.transportCueIndex=navigationCueIndex(listeningState);v.playbackTime=activeLesson.currentTime||0;v.playbackDuration=strictCourse(e.getSnapshot().material)?(v.ready&&Number.isFinite(activeLesson.duration)&&activeLesson.duration>0?activeLesson.duration:0):Number.isFinite(activeLesson.duration)?activeLesson.duration:72;v.volume=monitorPrefs.current.volume;v.muted=monitorPrefs.current.courseMuted||monitorPrefs.current.allMuted;const rs=recorder.getSnapshot();v.recording=rs.state==='recording'||rs.state==='stopping';v.recordingStarted=rs.startedAt;v.recordingBytes=rs.bytes;sceneRenderPhaseRef.current='projection';const projector=inputProjectorRef.current;pageInputGateRef.current.observe(e.getSnapshot());if(projector){projector.observe(e.getSnapshot(),now);const frame=projector.frame(now),motion=sceneMotionRef.current;if(motion.mediaLoading===v.ready){motion.mediaLoading=!v.ready;motion.mediaChangedAt=now}if(v.fixture){standbyAudioRef.current?.update({energy:0,active:false,mediaAudible:false});sceneRenderPhaseRef.current='scene-paint';paintReferenceScene(canvas,m,v)}else{sceneRenderPhaseRef.current='scene-paint';const mode=paintTransparentScene(canvas,m,v,{input:frame,...motion,wallNowMs:Date.now(),replay:!!replaySnapshot.current,restored:restoredSessionRef.current===undefined||restoredSessionRef.current===e.getSnapshot().sessionId,restoreFailed:restoreFailedRef.current,pageInputStarted:pageInputGateRef.current.started,standbyPaused:standbyPausedRef.current,mediaInteracted:mediaInteractedRef.current},portraitRef.current,portraitHeightRef.current);sceneRenderPhaseRef.current='post-paint';const contrast=readHudContrastStatus(canvas);if(contrast!==contrastStatusRef.current){contrastStatusRef.current=contrast;setContrastStatus(contrast)}if(stageRef.current)stageRef.current.dataset.hudContrast=contrast;if(v.listeningDisplay?.active&&!document.hidden)listening.present();standbyAudioRef.current?.update({energy:sampleStandbyEnergy(now,motion.enteredAt).energy,active:mode==='standby'&&!monitorPrefs.current.allMuted&&!v.reducedMotion&&!standbyPausedRef.current&&!document.hidden&&v.ready,mediaAudible:!lesson.paused&&!monitorPrefs.current.courseMuted&&!monitorPrefs.current.allMuted&&monitorPrefs.current.volume>.01});const presentationStatus=v.listeningDisplay?.active&&!replaySnapshot.current?(v.listeningDisplay.hidden?'listening-hidden':'listening-reference'):mode;if(mode&&stageRef.current&&(stageRef.current.dataset.presentationStatus!==presentationStatus||stageRef.current.dataset.presentationLocale!==localeRef.current)){stageRef.current.dataset.presentation=mode;stageRef.current.dataset.presentationStatus=presentationStatus;stageRef.current.dataset.presentationLocale=localeRef.current;if(presentationStatusRef.current)presentationStatusRef.current.textContent=ui(presentationStatus==='listening-hidden'?'正在纯听，原文、目标键与估算节奏均已隐藏。':presentationStatus==='listening-reference'?'正在听原声。文字、目标键与节奏图为句级原文跟随估算，不计入真实输入或成绩。':mode==='standby'?'待开始。待机动效尚未统计本次输入，已有记录保留。新的文本输入后进入真实训练。':mode==='live'?'训练中，正在显示真实输入统计。':mode==='replay'?'事件回放，不计入新成果。':'待开始，暂无新的输入统计。')}}}sceneRenderPhaseRef.current='post-paint';if(seekRef.current&&document.activeElement!==seekRef.current){seekRef.current.max=String(v.playbackDuration);seekRef.current.value=String(v.playbackTime)}}};const frameLoop=startSceneFrameLoop(draw,{request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id),recover:()=>{sceneRenderPhaseRef.current='context-reset';resetSceneContext(canvas)},onError:failSceneRendering,onRecovered:recoverSceneRendering});frameLoopRef.current=frameLoop;const timer=setInterval(()=>engineRef.current?.sampleClock(),1000);const visibility=()=>{if(document.hidden){interruptPracticeRecording('页面后台化');cancelFollow('background')}if(document.hidden){courseSwitchRef.current?.abort.abort();if(engineRef.current?.getSnapshot().material.builtinReference&&!visualRef.current?.ready){if(visualRef.current)visualRef.current.message='视频暂不可用，请重新加载';setCourseError('真人素材准备已因后台化中断，请在素材面板重新加载当前课程。');}courseLoadRequest.current++;reviewMediaRequestRef.current?.abort();reviewVerificationRef.current?.dispose();if(reviewTransitionRef.current)stopReviewTracking('复测准备已因后台化取消。');referenceActionRef.current++;referenceVerificationRef.current?.dispose();referencePreviewRef.current?.close();correctedPlayRequest.current++;correctedPlayOwner.current=null}if(document.hidden&&layoutTransactionsRef.current.active)cancelLayoutPreview();engineRef.current?.setFrozen('background',document.hidden);if(document.hidden){lesson.pause();if(listening.playerRef.current?.getState().mode==='type')listening.playerRef.current.pause();if(engineRef.current&&restoredSessionRef.current!==undefined&&!restoreFailedRef.current)void history.flush()}};const beforeUnload=(e:BeforeUnloadEvent)=>{if(history.getSnapshot().dirty||history.getSnapshot().pendingWrites||['recording','stopping'].includes(recorder.getSnapshot().state)){e.preventDefault();e.returnValue='还有未完成的本机保存，请稍候或主动导出。'}};const pageHide=()=>{cancelFollow('background');courseSwitchRef.current?.abort.abort();stopReviewTracking();reviewVerificationRef.current?.dispose();referenceActionRef.current++;referenceVerificationRef.current?.dispose();referencePreviewRef.current?.close();if(layoutTransactionsRef.current.active)cancelLayoutPreview();engineRef.current?.setInputObservationFocused(false);historyPageInactiveRef.current=true;if(saveTimer.current)clearTimeout(saveTimer.current);soundRequestRef.current++;standbyAudioRef.current?.disable();setSoundEnabled(false);recordRequestToken.current++;recordPreparing.current=false;setStartingRecord(false);cameraToken.current++;cameraStreamRef.current?.getTracks().forEach(t=>t.stop());void recorder.dispose();releaseMix();if(engineRef.current&&restoredSessionRef.current!==undefined&&!restoreFailedRef.current){exitHistorySave=history.flush();void exitHistorySave.finally(()=>{if(historyPageInactiveRef.current)history.suspend()})}};const pageShow=async(event:PageTransitionEvent)=>{if(!event.persisted)return;history.suspend();historyPageInactiveRef.current=false;setReady(false);try{const control=await repo.readAutomaticHistoryControl();if(disposed.current||generation!==life.current)return;if(engineRef.current){const current=engineRef.current;if(history.isFreshPreview)history.connectFreshPreview(current.getSnapshot(),control);else if(!current.isPassiveRestored||!history.resumeRestoredBaseline(current.getSnapshot(),control))history.connect(current.getSnapshot(),control);setTemporaryHistory(control.state!=='legacy-default')}}catch{restoreFailedRef.current=true;setRestoreFailed(true);notify('练习历史设置未能恢复，自动保存已暂停。原历史保留。')}setReady(true);engineRef.current?.setInputObservationFocused(document.activeElement===inputRef.current&&document.hasFocus()&&!document.hidden);if(engineRef.current)pageInputGateRef.current.begin(engineRef.current.getSnapshot());mediaInteractedRef.current=false;standbyPausedRef.current=false;sceneMotionRef.current.enteredAt=performance.now();sceneMotionRef.current.mediaChangedAt=performance.now();setStorageReady(false);await recorder.dispose();if(disposed.current||generation!==life.current)return;unsubRecorder();cameraStreamRef.current=null;if(cameraRef.current)cameraRef.current.srcObject=null;setCameraState('off');recorder=new SceneRecorder();recorderRef.current=recorder;observedRecorder=recorder.getSnapshot();unsubRecorder=recorder.subscribe(onRecorderChange);try{await recorder.prepare();if(!disposed.current)setStorageReady(true)}catch(e){setStorageError(e instanceof Error?e.message:'本机录像暂存无法恢复')}engineRef.current?.setFrozen('background',document.hidden)};const observationBlur=()=>{cancelFollow('blur');engineRef.current?.setInputObservationFocused(false)},observationFocus=()=>{engineRef.current?.setInputObservationFocused(document.activeElement===inputRef.current&&document.hasFocus()&&!document.hidden);void reconcileHistory()};window.addEventListener('blur',observationBlur);window.addEventListener('focus',observationFocus);document.addEventListener('visibilitychange',visibility);window.addEventListener('beforeunload',beforeUnload);window.addEventListener('pagehide',pageHide);window.addEventListener('pageshow',pageShow);const onPlay=(event:Event)=>{if(listening.playerRef.current?.getState().active){lesson.pause();return}if(reviewMediaRef.current&&reviewMediaRef.current.sessionId===engineRef.current?.getSnapshot().sessionId&&reviewMediaError(reviewMediaRef.current.target)){lesson.pause();return}if(mediaRef.current?.kind==='demo'&&engineRef.current&&strictCourse(engineRef.current.getSnapshot().material)&&(document.hidden||currentCorrectedMediaError()||!correctedPlayOwner.current||correctedPlayOwner.current.identity!==JSON.stringify(engineRef.current.getSnapshot().material))){lesson.pause();return}if(lesson.paused||followNativeEventsRef.current.has(event))return;mediaInteractedRef.current=true;engineRef.current?.setFrozen('listening',true)},onPause=(event:Event)=>{if(!lesson.paused||followNativeEventsRef.current.has(event))return;if(listening.playerRef.current?.getState().active)return;engineRef.current?.setFrozen('listening',false);engineRef.current?.setFrozen('idle',true)},onTime=()=>{observeFixedPaceMedia();if(followRef.current?.boundary())return;const e=engineRef.current;if(mediaRef.current?.kind==='demo'&&e&&!lesson.paused&&lesson.currentTime>=e.cue.end-.02){lesson.pause();seekTo(e.cue.start)}};const onReady=()=>{if(pendingSeek.current!==null)seekTo(pendingSeek.current)};const onDuration=()=>{if(engineRef.current&&strictCourse(engineRef.current.getSnapshot().material)&&currentCorrectedMediaError()){lesson.pause();setMediaDuration(0);return}setMediaDuration(Number.isFinite(lesson.duration)&&lesson.duration>0?lesson.duration:0)};lesson.addEventListener('durationchange',onDuration);lesson.addEventListener('play',onPlay);lesson.addEventListener('pause',onPause);lesson.addEventListener('timeupdate',onTime);['progress','canplay','loadeddata'].forEach(n=>lesson.addEventListener(n,onReady));return()=>{if(inputRef.current)releaseNativeInputDisplay(inputRef.current);disposed.current=true;life.current++;frameLoop.dispose();if(frameLoopRef.current===frameLoop)frameLoopRef.current=null;clearInterval(timer);if(saveTimer.current)clearTimeout(saveTimer.current);unsubscribe();unsubRepo();unsubHistory();tabRecovery.dispose();unsubRecorder();historyChannel?.close();if(historyChannelRef.current===historyChannel)historyChannelRef.current=null;pageHide();standbyAudioRef.current?.dispose();standbyAudioRef.current=null;void (exitHistorySave??Promise.resolve()).finally(()=>{history.dispose();void repo.close()});courseRoutingRef.current?.dispose();courseRoutingRef.current=null;void audioRef.current?.close();audioRef.current=null;window.removeEventListener('blur',observationBlur);window.removeEventListener('focus',observationFocus);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('pagehide',pageHide);window.removeEventListener('pageshow',pageShow);lesson.removeEventListener('durationchange',onDuration);lesson.removeEventListener('play',onPlay);lesson.removeEventListener('pause',onPause);lesson.removeEventListener('timeupdate',onTime);['progress','canplay','loadeddata'].forEach(n=>lesson.removeEventListener(n,onReady));releaseOriginalMedia();bookmarkPreviewRef.current?.dispose();referencePreviewRef.current?.dispose();referenceVerificationRef.current?.dispose();const references=referenceRepositoryRef.current;referenceRepositoryRef.current=null;void references?.close();const bookmarks=bookmarkRepository.current;bookmarkRepository.current=null;void bookmarks?.close();if(localURL.current)URL.revokeObjectURL(localURL.current);if(previewURL.current)URL.revokeObjectURL(previewURL.current)}},[]);
 useEffect(()=>{clearKeyboardFeedback();cancelTypingErrorFeedback()},[panel,paused,currentCue,fixture,editingLayout]);
 useEffect(()=>{const reset=()=>clearKeyboardFeedback();window.addEventListener('blur',reset);document.addEventListener('visibilitychange',reset);return()=>{window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',reset)}},[]);
 useEffect(()=>{layoutEditingRef.current=editingLayout},[editingLayout]);
 useEffect(()=>{if(!editingLayout&&!panel&&layoutReturnFocusRef.current){layoutReturnFocusRef.current=false;if(!paused&&!fixture&&!replaySnapshot.current&&!restoreFailedRef.current)inputRef.current?.focus({preventScroll:true})}},[editingLayout,panel,paused,fixture]);
 useEffect(()=>{const context=layoutTransactionsRef.current.context;if(context?.portrait&&context.height!==portraitHeight){cancelLayoutPreview();notify('可用高度已变化，未应用的布局预览已取消。')}},[portraitHeight]);
 useEffect(()=>{if(!responsive)return;const update=()=>{const next=readViewport(viewportMode).portrait;if(next===portraitRef.current)return;const old=portraitRef.current;if(layoutTransactionsRef.current.active)cancelLayoutPreview();layoutCacheRef.current[old?'portrait':'landscape']=arrangementRef.current;let values=layoutCacheRef.current[next?'portrait':'landscape'];if(!values){try{values=(next?(raw:unknown)=>parsePortraitArrangement(raw,portraitHeightRef.current):parseArrangement)(JSON.parse(localStorage.getItem(layoutStorageKey(next))||'{}'))}catch{values={}}}portraitRef.current=next;updateArrangement(values);setArrangement(values);setPortrait(next);if(layoutEditingRef.current){setEditingLayout(false);layoutEditingRef.current=false;engineRef.current?.setFrozen('modal',!!dialogRef.current?.open||!!visualRef.current?.fixture||!!replaySnapshot.current)}};update();let resizeFrame=0;const resized=()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(update)};window.addEventListener('resize',resized);window.addEventListener('orientationchange',resized);document.addEventListener('fullscreenchange',resized);document.addEventListener('focusin',resized);document.addEventListener('focusout',resized);window.visualViewport?.addEventListener('resize',resized);window.screen.orientation?.addEventListener('change',resized);const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resized):null;if(stageRef.current?.parentElement){observer?.observe(stageRef.current.parentElement);}return()=>{cancelAnimationFrame(resizeFrame);observer?.disconnect();window.removeEventListener('resize',resized);window.removeEventListener('orientationchange',resized);document.removeEventListener('fullscreenchange',resized);document.removeEventListener('focusin',resized);document.removeEventListener('focusout',resized);window.visualViewport?.removeEventListener('resize',resized);window.screen.orientation?.removeEventListener('change',resized)}},[responsive,viewportMode]);
 function ensureInputReachable(){
  const input=inputRef.current,stage=stageRef.current;if(!input||!stage||document.activeElement!==input)return;
  const vv=window.visualViewport,top=vv?.offsetTop??0,bottom=top+(vv?.height??window.innerHeight);
  const box=(inputViewportRef.current??input).getBoundingClientRect(),submit=stage.querySelector('.submit-hit')?.getBoundingClientRect();
  const transport=portraitRef.current?stage.querySelector('.play-hit')?.getBoundingClientRect():undefined,follow=portraitRef.current?stage.querySelector('.typing-follow-toolbar')?.getBoundingClientRect():undefined;
  const delta=learningFocusScroll({top,bottom},box,submit,transport,follow);
  const page=stage.parentElement,scroller=page&&page.scrollHeight>page.clientHeight+1?page:window;
  if(delta)scroller.scrollBy({top:delta,behavior:'instant'});
 }
 useEffect(()=>{if(!responsive)return;const viewport=window.visualViewport;const update=()=>requestAnimationFrame(ensureInputReachable);viewport?.addEventListener('resize',update);return()=>viewport?.removeEventListener('resize',update)},[responsive]);
 useEffect(()=>{if(ready&&fontsReady){sceneMotionRef.current.enteredAt=performance.now();sceneMotionRef.current.mediaChangedAt=performance.now()}},[ready,fontsReady]);
 useEffect(()=>{const preference=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReducedMotion(preference.matches);preference.addEventListener('change',change);return()=>preference.removeEventListener('change',change)},[]);
 useEffect(()=>{const v=visualRef.current;if(v){v.layout=layout;v.fixture=fixture;v.showSubtitle=showSubtitle;v.paused=paused;v.reducedMotion=reducedMotion;v.camera=cameraState;v.composition=composing.current;v.visualEdition=visualEdition}},[layout,fixture,showSubtitle,paused,reducedMotion,cameraState,visualEdition]);
 useEffect(()=>{if(panel&&!dialogRef.current?.open){dialogRef.current?.showModal();dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()}if(!panel&&dialogRef.current?.open)dialogRef.current.close()},[panel]);
 useEffect(()=>{if(!editingLayout)return;const controls=stageRef.current?.querySelectorAll<HTMLElement>('.hit,.entry-form,.seek-hit,.volume-hit,.studio-tools,.status-strip');controls?.forEach(el=>{el.inert=true});return()=>controls?.forEach(el=>{el.inert=false})},[editingLayout]);
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{const el=event.target instanceof Element?event.target:null;const action=mediaShortcut(event.key,{editing:!!el?.closest('input,textarea,select,button,a,summary,[contenteditable],[role="textbox"]'),composing:event.isComposing||composing.current,blocked:sceneFailureRef.current||!!panel||editingLayout||fixture||replayIndex!==null||!ready||!fontsReady,altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey});if(!action)return;event.preventDefault();if(action==='play'&&event.repeat)return;if(action==='play')togglePlay();else{const cues=knownCueMarkers(engineRef.current?.getSnapshot().material.cues??[],mediaDuration,mediaKind==='demo');const next=navigationCueIndex()+(action==='previous'?-1:1);if(cues.some(c=>c.cueIndex===next))changeCue(next,false,event.isTrusted)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[panel,editingLayout,fixture,replayIndex,ready,fontsReady,mediaKind,mediaDuration]);
 const activeRecord=recordState.state==='recording'||recordState.state==='stopping';const readonly=listening.state?.mode==='listen'||(!!engineRef.current?.getSnapshot().material.builtinReference&&!builtinMediaReady)||reviewBusy||!!reviewStartFailure||referenceBusy||!!referenceConfirmation||fixture||replayIndex!==null||editingLayout||mediaKind!=='demo'||!ready||!fontsReady||restoreFailed;
 const geometry=learningGeometry(responsiveLayout(portrait&&!fixture,arrangement,layout,portraitHeight),{keyboardVisible:!portrait&&keyboardVisible&&!softwareKeyboardOpen,keyboardPlacement,intrinsicWidth:mediaIntrinsic?.width,intrinsicHeight:mediaIntrinsic?.height,videoSize:layout==='camera'?'fit':videoSize,availableWidth:learningViewport?.width,availableHeight:learningViewport?.height,cssWidth:cameraViewport?.width,hud:hudPreferences}),layoutBase=responsiveLayout(portrait&&!fixture,{},layout,portraitHeight),hitStyle=fixture?rectStyle:geometry.style;
 const cameraControl=cameraControlGeometry(geometry,cameraState,layout,{fixture,cssWidth:cameraViewport?.width,cssHeight:cameraViewport?.height});
 const playerHitStyle=hitStyle,followHeader=inputHeaderControls(geometry.inputCard);
 const zones=fixture?LEGACY_ZONES:geometry.zones;
 const portraitInputStyle=fixture?{}:inputCardTextareaStyle(geometry.inputCard,(cameraViewport?.width??geometry.width)/geometry.width);
 const transportCueIndex=navigationCueIndex();
 const cueMarkers=knownCueMarkers(engineRef.current?.getSnapshot().material.cues??[],mediaDuration,mediaKind==='demo');
 useLayoutEffect(()=>{
  if(fixture)return;const stage=stageRef.current,page=stage?.parentElement;if(!stage||!page)return;
  let frame=0;const measure=()=>{const bounds=readViewport(viewportMode),video=lessonRef.current,image=mediaRef.current?.image;
   const iw=layout==='camera'?cameraRef.current?.videoWidth:mediaKind==='image'?image?.naturalWidth:video?.videoWidth,ih=layout==='camera'?cameraRef.current?.videoHeight:mediaKind==='image'?image?.naturalHeight:video?.videoHeight;
   const intrinsic={width:iw&&iw>0?iw:1280,height:ih&&ih>0?ih:720};setMediaIntrinsic(previous=>previous?.width===intrinsic.width&&previous.height===intrinsic.height?previous:intrinsic);setLearningViewport(previous=>previous?.width===bounds.usableWidth&&previous.height===bounds.usableHeight?previous:{width:bounds.usableWidth,height:bounds.usableHeight});
   const size=fitLearningSurface({availableWidth:bounds.usableWidth,availableHeight:bounds.usableHeight,sceneWidth:geometry.width,sceneHeight:geometry.height,media:geometry.media,intrinsicWidth:mediaKind==='image'?image?.naturalWidth:video?.videoWidth,intrinsicHeight:mediaKind==='image'?image?.naturalHeight:video?.videoHeight,videoSize,portrait});
   if(visualRef.current){visualRef.current.videoSize=videoSize;visualRef.current.mediaViewport={width:bounds.usableWidth,height:bounds.usableHeight}}
   stage.style.width=`${size.width}px`;stage.style.height=`${size.height}px`;stage.dataset.keyboardPlacement=keyboardPlacement;stage.dataset.videoSize=videoSize;stage.dataset.hudScale=hudPreferences.mode;stage.dataset.hudClamped=String(geometry.hudClamped);
  };const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)};measure();
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);document.addEventListener('fullscreenchange',resize);lessonRef.current?.addEventListener('loadedmetadata',resize);lessonRef.current?.addEventListener('emptied',resize);cameraRef.current?.addEventListener('loadedmetadata',resize);mediaRef.current?.image.addEventListener('load',resize);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);document.removeEventListener('fullscreenchange',resize);lessonRef.current?.removeEventListener('loadedmetadata',resize);lessonRef.current?.removeEventListener('emptied',resize);cameraRef.current?.removeEventListener('loadedmetadata',resize);mediaRef.current?.image.removeEventListener('load',resize)};
 },[fixture,geometry.width,geometry.height,geometry.media.x,geometry.media.y,geometry.media.w,geometry.media.h,geometry.hudClamped,videoSize,hudPreferences.mode,viewportMode,mediaKind,mediaDuration,layout,keyboardPlacement]);
 const fixedDictationSurface=pacingStrategy==='fixed'&&!referenceVisible&&!guideStorageError;
 const assistedSurfaceReady=!!referenceVisible&&followReady&&followReferenceShown();
 const paceSurfaceReady=pacingStrategy==='fixed'?(fixedDictationSurface||assistedSurfaceReady):assistedSurfaceReady;
 const followUnavailable=sceneFailureRef.current||!paceSurfaceReady||!followSourceQualified()||(lessonRef.current?.readyState??0)<2||readonly||paused||activeRecord||startingRecord||!!listening.state?.active||!!reviewBindingRef.current||restoredSessionRef.current===undefined||!!engineRef.current?.isPassiveRestored;
 const followUnavailableReason=followUnavailable?(()=>{
  if(sceneFailureRef.current)return t('studio.displayInterrupted');
  if(activeRecord||startingRecord)return t('follow.unavailableRecording');
  if(listening.state?.active)return t('follow.unavailableListening');
  if(reviewBindingRef.current||readonly&&(listening.state?.mode==='listen'||reviewBusy||reviewStartFailure||referenceBusy||referenceConfirmation||fixture||replayIndex!==null||editingLayout||restoreFailed))return t('follow.unavailableReadonly');
  if(pacingStrategy==='adaptive'&&(!referenceVisible||!referenceVisibleRef.current))return t('follow.unavailableReference');
  if(pacingStrategy==='fixed'&&referenceVisible&&!followReferenceShown())return t('follow.unavailableReference');
  if(pacingStrategy==='adaptive'&&!assistedSurfaceReady)return t('follow.unavailableReference');
  const material=engineRef.current?.getSnapshot().material;
  try{if(material&&(!isBuiltinMaterial(material)||mediaRef.current?.kind!=='demo'))return t('follow.unavailableCourse')}catch{return t('follow.unavailableCourse')}
  if(paused)return t('follow.unavailablePaused');
  if(engineRef.current?.isPassiveRestored)return t('follow.unavailableRestored');
  if(restoredSessionRef.current===undefined||!material||!followSourceQualified()||(lessonRef.current?.readyState??0)<2)return t('follow.unavailableLoading');
  if(readonly)return t('follow.unavailableReadonly');
  return t('follow.unavailable');
 })():null;
 const followActive=!!followView.state.active;
 const followAutoReady=followAutoArmed&&followAutoEntryMatches();
 const followSurfaceLive=followActive&&(fixedDictationSurface||(referenceVisible&&followReferenceShown()));
 const followStatus=(!followSurfaceLive&&!followAutoReady?followUnavailableReason:null)??(followAutoReady?t(pacingStrategy==='fixed'?(fixedDictationSurface?'fixed.autoReadyDictation':'fixed.autoReady'):'follow.autoReady'):followView.state.phase==='starting'?t('follow.starting'):followView.state.phase==='following'?t(pacingStrategy==='fixed'?(fixedDictationSurface?'fixed.followingDictation':'fixed.following'):followView.state.reason==='idle-coasting'?'follow.coasting':'follow.following'):followView.state.phase==='waiting'?t(followView.state.reason==='composition'?'follow.composing':'follow.waiting'):followView.state.phase==='ended'?t('follow.ended'):followView.state.reason==='non-append-input'?t('follow.edit'):followView.state.reason?.startsWith('play-')||followView.state.reason==='rate-not-applied'||followView.state.reason==='media-error'?t('follow.error'):followView.state.reason?t('follow.manual'):t('follow.off'));
 const followButton=((label)=>{return <button type="button" className="hud-glyph typing-follow-toggle" disabled={followUnavailable&&!followActive&&!followAutoReady} aria-label={label} title={label} aria-describedby={followUnavailable&&!followActive?(inputSettingsOpen?'typing-follow-prerequisite':'typing-follow-status'):undefined} aria-pressed={followActive||followAutoReady} data-active={followActive||followAutoReady||undefined} onPointerDown={event=>{if(document.activeElement===inputRef.current)event.preventDefault()}} onClick={event=>{if(followActive||followAutoReady)cancelFollow('manual-pause');else startFollow(event.nativeEvent.isTrusted)}}><HudGlyph name="pace"/><span className="sr-only">{label}</span></button>})(followActive||followAutoReady?t(pacingStrategy==='fixed'?'fixed.stop':'follow.stop'):t(pacingStrategy==='fixed'?'fixed.start':'follow.start'));
 const followDeepLinkSurface=resolveFollowDeepLinkSurface({followDeepLink,tipDismissed:followDeepLinkDismissed,active:followActive,reason:followView.state.reason});
 const followVisibleStatus=followStatusNeedsVisibleSurface({recoverKind:followDeepLinkSurface.recoverKind,followDeepLink,unavailable:followUnavailable,phase:followView.state.phase,active:followActive});

 const checkedReview=reviewSnapshot?getDraftFeedback(reviewSnapshot,getDraft(reviewSnapshot).text).attempt:null;
 const inlineCueTargets=cueMarkers.every((cue,index)=>index===0||(cue.ratio-cueMarkers[index-1].ratio)*(geometry.zones.seek.w-40)*(cameraViewport?.width??geometry.width)/geometry.width>=44);
 const toggleFullscreen=async()=>{try{const active=await toggleElementFullscreen(document,stageRef.current?.parentElement??null);if(!disposed.current)setFullscreenActive(active)}catch{if(!disposed.current){setFullscreenActive(document.fullscreenElement===stageRef.current?.parentElement);notify('Fullscreen is unavailable or was not allowed. Use Fit to fill the view.')}}};
 return <main lang={locale} className={`studio-page ${responsive?'responsive-enabled':''}`} data-viewport-mode={viewportMode} data-visual-edition={visualEdition} ><div className={`studio-stage ${portrait&&!fixture?'portrait-layout':''} ${fixture?'reference-mode':''} ${toolsOpen?'tools-open':''} ${editingLayout?'editing-layout':''}`} ref={stageRef} style={!fixture?{aspectRatio:`${geometry.width}/${geometry.height}`}:undefined} data-practice-compact={portrait&&!fixture&&!!geometry.practiceCompact?true:undefined} data-visual-edition={visualEdition} data-software-keyboard={softwareKeyboardOpen||undefined} data-testid="studio-stage" data-input-rate-version="input.cpm.5s.v1" data-version={responsive?'v35-height-fit-responsive':TRANSPARENT_VERSION} data-layout={portrait&&!fixture?'portrait':'landscape'}><ListeningControls control={listening} download={download} dockStyle={hitStyle(geometry.listeningDock)}/><canvas ref={canvasRef} width={portrait&&!fixture?860:1920} height={!fixture?Math.round(geometry.height*(portrait?2:1920/1672)):1080} className="scene-canvas" tabIndex={0} aria-keyshortcuts="Space ArrowLeft ArrowRight" onPointerDown={e=>{setToolsOpen(false);const box=inputViewportRef.current?.getBoundingClientRect();if(box&&e.clientX>=box.left&&e.clientX<=box.right&&e.clientY>=box.top&&e.clientY<=box.bottom){focusPracticeInput();return}e.currentTarget.dataset.pointerFocused='true';e.currentTarget.focus({preventScroll:true})}} onKeyDown={e=>{delete e.currentTarget.dataset.pointerFocused}} onBlur={e=>{delete e.currentTarget.dataset.pointerFocused}} aria-label={t('studio.stageLabel')} aria-describedby={responsive?'responsive-hud-description':undefined}/><video ref={lessonRef} className="source-video" playsInline preload="auto" crossOrigin="anonymous"/><video ref={cameraRef} className="source-video" autoPlay playsInline muted/>
 <button className="title-hit hit" style={fixture?undefined:hitStyle(geometry.zones.title)} title={t('studio.tools')} aria-label={t('studio.openTools')} aria-expanded={toolsOpen} onClick={()=>setToolsOpen(v=>!v)}><span className="sr-only">{t('studio.tools')}</span></button>
 {toolsOpen&&portrait&&!fixture&&<button type="button" className="studio-drawer-scrim" aria-label={t('panel.close')} onClick={()=>setToolsOpen(false)}/>}
 <div className={`studio-drawer ${toolsOpen?'is-open':''}`} data-drawer={portrait&&!fixture?'sheet':'rail'}>
  <div className="studio-drawer-grabber" aria-hidden="true"/>
  <div className="studio-tools" aria-label={t('studio.tools')}><button type="button" onClick={()=>openPanel('media')}><Icon name="folder"/><span>{t('studio.media')}</span></button><button type="button" onClick={()=>openPanel('layout')}><Icon name="layout"/><span>{t('studio.layout')}</span></button><button type="button" onClick={reveal} disabled={readonly} aria-pressed={referenceVisible}><Icon name="caption"/><span>{referenceVisible?t('studio.referenceHideAction'):t('studio.referenceShowAction')}</span></button><button type="button" onClick={()=>openPanel('hint')} disabled={readonly} aria-haspopup="dialog"><Icon name="hint"/><span>{t('studio.hint')}</span></button><button type="button" onClick={()=>openPanel('review')}><Icon name="chart"/><span>{t('studio.review')}</span></button><button type="button" onClick={()=>openPanel('record')} className={activeRecord?'record-active':''}><Icon name="record"/><span>{activeRecord?t('studio.recording'):t('studio.record')}</span></button><button type="button" onClick={()=>openPanel('camera')}><Icon name="camera"/><span>{t('studio.camera')}</span></button><button type="button" onClick={()=>openPanel('settings')} aria-label={t('studio.moreSettings')}><Icon name="more"/><span>{t('studio.moreSettings')}</span></button></div>
 </div>
 <button className="camera-hit hit" style={hitStyle(fixture?legacyInsetRect(layout,{},true):cameraControl.hit)} onClick={()=>openPanel('camera')} aria-label={cameraState==='on'?t('studio.cameraOnSettings'):cameraState==='requesting'?t('studio.cameraRequestSettings'):cameraState==='error'?t('studio.cameraRetrySettings'):t('studio.cameraSettings')}><span className="sr-only">{t('studio.camera')}</span></button>
 {!fixture&&<><button type="button" className="keyboard-toggle hud-glyph" style={hitStyle(geometry.inputCard.toggle)} aria-label={portrait?t('studio.showKeyboard'):(keyboardVisible&&!softwareKeyboardOpen?t('studio.hideKeyboard'):t('studio.showKeyboard'))} title={portrait?t('studio.showKeyboard'):(keyboardVisible&&!softwareKeyboardOpen?t('studio.hideKeyboard'):t('studio.showKeyboard'))} aria-expanded={portrait?softwareKeyboardOpen:(keyboardVisible&&!softwareKeyboardOpen)} aria-controls={portrait?undefined:'passive-keyboard-description'} data-active={portrait?softwareKeyboardOpen||undefined:(keyboardVisible&&!softwareKeyboardOpen)||undefined} onClick={toggleKeyboard}><HudGlyph name="keyboard"/></button><button type="button" className="input-settings-toggle hud-glyph" style={hitStyle(geometry.inputCard.modeToggle)} aria-label={t('studio.typingSettings')} title={t('studio.typingSettings')} aria-expanded={inputSettingsOpen} onClick={()=>{setInputSettingsOpen(v=>!v);setPaceSheetOpen(false)}}><HudGlyph name="settings"/></button>
 {inputSettingsOpen&&<HudPopover label={t('studio.typingDisplay')} onClose={()=>setInputSettingsOpen(false)} className="input-settings-popover"><div className="hud-panel-body"><div className="hud-panel-section"><span className="hud-section-label">{t('studio.learning')}</span><button type="button" className="hud-reference-choice" aria-pressed={referenceVisible} onClick={()=>setReferenceGuideVisible(!referenceVisible)}>{referenceVisible?t('hud.referenceShown'):t('hud.referenceHidden')}</button><label>{t('studio.guidance')}<select className="input-style-select" aria-label={t('studio.underlinesLabel')} value={inputStyle} disabled={readonly||paused} onChange={e=>chooseInputStyle(e.target.value)}><option value="words">{t('studio.wordUnderlines')}</option><option value="letters">{t('studio.letterUnderlines')}</option><option disabled={!referenceVisible} value="hint-words">{t('studio.wordHints')}</option><option disabled={!referenceVisible} value="hint-letters">{t('studio.letterHints')}</option></select></label><label>{t('studio.sentence')}<select aria-label={t('studio.chooseSentence')} value={currentCue} disabled={!cueMarkers.length||fixture||editingLayout||paused} onChange={e=>changeCue(Number(e.target.value),false,e.nativeEvent.isTrusted)}>{cueMarkers.map(c=><option key={c.id} value={c.cueIndex}>{c.cueIndex+1}</option>)}</select></label></div><div className="hud-panel-section"><div className="hud-section-head"><span className="hud-section-label">{t('follow.title')}</span><div className="hud-pace-row">{followButton}</div></div>{followUnavailableReason&&<p className="note" id="typing-follow-prerequisite">{followUnavailableReason}</p>}<label>{t('fixed.mode')}<select aria-label={t('fixed.mode')} value={pacingStrategy} disabled={readonly||paused||activeRecord||startingRecord} onChange={e=>choosePacingStrategy(e.target.value)}><option value="fixed">{t('fixed.primary')}</option><option value="adaptive">{t('fixed.assist')}</option></select></label>{pacingStrategy==='fixed'&&<label>{t('fixed.rate')}<select aria-label={t('fixed.rate')} value={fixedRate} disabled={readonly||paused||activeRecord||startingRecord} onChange={e=>chooseFixedRate(Number(e.target.value))}>{[.5,.8,1,1.25,1.5].map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></label>}<p className="note">{t(pacingStrategy==='fixed'?(referenceVisible?'fixed.description':'fixed.descriptionDictation'):'follow.description')}</p>{pacingStrategy==='adaptive'&&<p className="note follow-start-hint" id="follow-start-hint">{t('follow.startHint')}</p>}{renderFixedPaceResult()}</div><div className="hud-panel-section"><span className="hud-section-label">{t('studio.view')}</span><label>{t('hud.keyboardPosition')}<select aria-label={t('hud.keyboardPosition')} value={keyboardPlacement} onChange={e=>chooseKeyboardPlacement(e.target.value)}><option value="inside">{t('hud.keyboardInside')}</option><option value="below">{t('hud.keyboardBelow')}</option></select></label><fieldset><legend>{t('studio.videoSize')}</legend><div className="button-row">{([['half','0.5×'],['native','1×'],['fit',t('studio.fit')]] as const).map(([value,label])=><button type="button" key={value} aria-pressed={videoSize===value} onClick={()=>setVideoSize(value)}>{ui(label)}</button>)}<button type="button" aria-pressed={fullscreenActive} onClick={()=>void toggleFullscreen()}>{fullscreenActive?t('studio.exitFullscreen'):t('studio.fullscreen')}</button></div></fieldset><label>{t('studio.hudScaling')}<select aria-label={t('studio.hudScaling')} value={hudPreferences.mode} onChange={e=>setHudPreferences(v=>({...v,mode:e.target.value as HudPreferences['mode']}))}><option value="follow">{t('studio.followVideo')}</option><option value="fixed">{t('studio.fixedSize')}</option></select></label><label>{t('studio.hudSize')}<select aria-label={t('studio.hudSize')} value={hudPreferences.size} onChange={e=>setHudPreferences(v=>({...v,size:Number(e.target.value)}))}><option value={.8}>{t('studio.small')}</option><option value={1}>{t('studio.normal')}</option><option value={1.15}>{t('studio.large')}</option></select></label></div>{geometry.hudClamped&&<p className="note">{t('studio.hudFitLimit')}</p>}{softwareKeyboardOpen&&<p className="note">{t('studio.deviceKeyboard')}</p>}{referenceExposureRef.current.unavailable&&<p role="alert">{t('studio.referenceRetentionError')}</p>}<p className="hud-contrast-note">{contrastStatus==='adaptive'?t('studio.adaptiveContrast'):contrastStatus==='letterbox'?t('studio.letterboxContrast'):reducedMotion?t('studio.reducedContrast'):t('studio.fallbackContrast')}</p></div></HudPopover>}
 <button type="button" className={`reference-guide-toggle ${listening.state?.mode==='listen'?'listening-native-input-hidden':''}`} style={hitStyle(followHeader.reference)} aria-pressed={referenceVisible} aria-label={referenceVisible?t('studio.hideForDictation'):t('studio.showAssistedReference')} onClick={()=>setReferenceGuideVisible(!referenceVisible)}>{guideStorageError?t('studio.referenceUnavailable'):referenceVisible?t('studio.hideReference'):t('studio.showReference')}</button>
 <span id="input-guide-status" className="sr-only" role="status">{listening.state?.mode==='listen'?t('studio.listeningHidesGuide'):guideStorageError?t('studio.referenceAnswerRetentionError'):!referenceVisible?t('studio.referenceInputOnly'):inputGuideOwnerRef.current===inputGuideOwner()&&engineRef.current?inputGuideSummary(inputGuideMask(engineRef.current.cue.text),locale):t('studio.referenceAssistanceNotice')}</span><span id="passive-keyboard-description" className="sr-only">{t('studio.keyboardExplanation')}</span></>}

 {!fixture&&listening.state?.mode!=='listen'&&<section className="typing-follow-toolbar" style={hitStyle(followHeader.follow)} aria-label={t('follow.title')} data-follow-phase={!followActive&&followUnavailable?'unavailable':followView.state.phase} data-compact-secondary={portrait&&geometry.practiceCompact?true:undefined} data-pace-mode={pacingStrategy}>
  <button type="button" className="typing-pace-chip" aria-expanded={paceSheetOpen} aria-controls="typing-pace-sheet" aria-label={t('fixed.paceSheet')} title={t('fixed.paceSheet')} onPointerDown={event=>{if(document.activeElement===inputRef.current)event.preventDefault()}} onClick={()=>{setPaceSheetOpen(v=>!v);setInputSettingsOpen(false)}}>{pacingStrategy==='fixed'?t(referenceVisible?'fixed.chipFixed':'fixed.chipDictation',{rate:fixedRate}):(followActive&&followView.rate!==null?t('fixed.chipAssistRate',{rate:followView.rate.toFixed(2)}):t('fixed.chipAssist'))}</button>
  {followButton}<span id="typing-follow-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{followStatus}</span>
  {followVisibleStatus&&<span className="typing-follow-status-pill" data-recover={followDeepLinkSurface.recoverKind!=='none'||undefined} aria-hidden="true">{followStatus}</span>}
  {followActive&&followView.rate!==null&&(fixedDictationSurface||(referenceVisible&&followReferenceShown()))&&<span className="typing-follow-rate" aria-label={t('follow.rate',{rate:followView.rate.toFixed(2)})}>{followView.rate.toFixed(2)}×</span>}
  {paceSheetOpen&&<HudPopover label={t('fixed.paceSheet')} onClose={()=>setPaceSheetOpen(false)} className="pace-sheet-popover" id="typing-pace-sheet"><div className="hud-panel-body"><p className="note">{t('fixed.paceHint')}</p><div className="hud-panel-section"><span className="hud-section-label">{t('fixed.mode')}</span><div className="pace-mode-row" role="group" aria-label={t('fixed.mode')}><button type="button" aria-pressed={pacingStrategy==='fixed'} disabled={readonly||paused||activeRecord||startingRecord} onClick={()=>choosePacingStrategy('fixed')}>{t('fixed.primary')}</button><button type="button" aria-pressed={pacingStrategy==='adaptive'} disabled={readonly||paused||activeRecord||startingRecord} onClick={()=>choosePacingStrategy('adaptive')}>{t('fixed.assist')}</button></div></div>{pacingStrategy==='fixed'&&<div className="hud-panel-section"><span className="hud-section-label">{t('fixed.rateChoice')}</span><div className="pace-rate-row" role="group" aria-label={t('fixed.rate')}>{[.5,.8,1,1.25,1.5].map(rate=><button type="button" key={rate} aria-pressed={fixedRate===rate} disabled={readonly||paused||activeRecord||startingRecord} onClick={()=>chooseFixedRate(rate)}>{rate}×</button>)}</div></div>}<div className="hud-panel-section"><div className="hud-section-head"><span className="hud-section-label">{t('follow.title')}</span><div className="hud-pace-row">{followButton}</div></div>{followUnavailableReason&&<p className="note" id="typing-follow-prerequisite-sheet">{followUnavailableReason}</p>}<p className="note">{t(pacingStrategy==='fixed'?(referenceVisible?'fixed.description':'fixed.descriptionDictation'):'follow.description')}</p>{pacingStrategy==='adaptive'&&<p className="note follow-start-hint" id="follow-start-hint-sheet">{t('follow.startHint')}</p>}{renderFixedPaceResult()}</div></div></HudPopover>}
 </section>}
 <form className="entry-form" onSubmit={e=>{e.preventDefault();submit()}}><label htmlFor="studio-answer" className="sr-only">{t('studio.typeEnglish')}</label><div ref={inputViewportRef} translate="no" className={fixture?'entry-viewport legacy-entry-viewport':`entry-viewport ${listening.state?.mode==='listen'?'listening-native-input-hidden':''}`} aria-hidden={listening.state?.mode==='listen'} style={fixture?undefined:{...hitStyle(zones.input),...(portrait?{overflow:'hidden',clipPath:`inset(${geometry.inputCard.paddingY*geometry.inputCard.cssScale}px 0)`}:{})}} tabIndex={fixture||listening.state?.mode==='listen'?-1:0} role="region" aria-label={t(portrait?'studio.inputWindowRegion':'studio.inputScrollRegion')} onPointerDown={e=>{if(fixture||listening.state?.mode==='listen'||readonly)return;resumePracticeForTyping();if(e.target===e.currentTarget)focusPracticeInput()}} onFocus={e=>{if(e.target===e.currentTarget)focusPracticeInput()}}><textarea id="studio-answer" translate="no" placeholder={undefined} rows={2} wrap="soft" ref={inputRef} className={`entry-input ${listening.state?.mode==='listen'?'listening-native-input-hidden':''}`} style={fixture?hitStyle(zones.input):{...portraitInputStyle,left:0,top:0,width:'100%',height:'100%',minHeight:'100%',overflow:'hidden'}} onSelect={()=>{inputCaretPendingRef.current=true}} aria-describedby="entry-status input-guide-status" maxLength={2000} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={readonly} inputMode="text" enterKeyHint="done" aria-hidden={listening.state?.mode==='listen'} onPointerDown={e=>{resumePracticeForTyping();prepareTypingErrorFeedback(e.nativeEvent)}} onPaste={()=>{cancelTypingErrorFeedback();pasting.current=true;setTimeout(()=>{pasting.current=false},0)}} onFocus={()=>{resumePracticeForTyping();engineRef.current?.setInputObservationFocused(true);if(responsive)requestAnimationFrame(()=>ensureInputReachable())}} onBlur={()=>{cancelFollow('blur');cancelTypingErrorFeedback();clearKeyboardFeedback();engineRef.current?.setInputObservationFocused(false);engineRef.current?.setFrozen('idle',true)}} onCompositionStart={e=>{invalidateFixedPace('composition');cancelTypingErrorFeedback();prepareTypingErrorFeedback(e.nativeEvent);if(referenceBlocked()||builtinAnswerBlocked())return;resumePracticeForTyping();if(isPracticePaused(engineRef.current))return;interruptedCompositionRef.current=false;const observeFollow=prepareFollowInput();composing.current=true;if(observeFollow){const input=e.currentTarget;const id=followInputRef.current.beginComposition(input.value,{start:input.selectionStart,end:input.selectionEnd},e.nativeEvent);followRef.current?.compositionStart(id)}pressedKeysRef.current.clear();if(visualRef.current)visualRef.current.gain=0;applyReferenceGuideExposure();engineRef.current?.beginComposition();if(visualRef.current)visualRef.current.composition=true;syncFeedback()}} onCompositionEnd={e=>{compositionEnterRef.current=performance.now();if(referenceBlocked()||builtinAnswerBlocked()){e.currentTarget.value=engineRef.current?.draft??'';return}if(isPracticePaused(engineRef.current)||interruptedCompositionRef.current){const ticket=compositionTailRef.current.remember(e.currentTarget.value);setTimeout(()=>compositionTailRef.current.expire(ticket),0);e.currentTarget.value=engineRef.current?.draft??'';composing.current=false;pasting.current=false;if(visualRef.current)visualRef.current.composition=false;return}composing.current=false;const ticket=compositionTailRef.current.remember(e.currentTarget.value);setTimeout(()=>compositionTailRef.current.expire(ticket),0);const errorBefore=engineRef.current?.draft??'';const errorPasted=pasting.current;applyReferenceGuideExposure();engineRef.current?.endComposition(e.currentTarget.value,{version:'dom-edit-v1',kind:'compositionend',inputType:null,data:e.data??null});if(visualRef.current)visualRef.current.composition=false;pasting.current=false;if(followRef.current?.active||followAutoEntryRef.current){const commit=followInputRef.current.endComposition(e.currentTarget.value,e.nativeEvent);if(commit.edit)commitFollowInput(commit.edit);else if(commit.id!==null){if(followRef.current?.active)followRef.current.compositionCancel(commit.id);else disarmFollowAutoEntry()}}showCommittedInput();syncFeedback();observeTypingError(e.nativeEvent as CompositionEvent,errorBefore,'compositionend',errorPasted)}} onInput={e=>{if(referenceBlocked()||builtinAnswerBlocked()){e.currentTarget.value=engineRef.current?.draft??'';pasting.current=false;return}resumePracticeForTyping();const native=e.nativeEvent as InputEvent;if(native.inputType==='insertText'&&!native.isComposing)prepareTypingErrorFeedback(native);if(isPracticePaused(engineRef.current)||(interruptedCompositionRef.current&&(native.isComposing||['insertCompositionText','insertFromComposition'].includes(native.inputType)))){e.currentTarget.value=engineRef.current?.draft??'';pasting.current=false;return}if(composing.current)return;if(compositionTailRef.current.consume(e.currentTarget.value,(e.nativeEvent as InputEvent).inputType??null)){e.currentTarget.value=engineRef.current?.draft??'';return}if(visualRef.current)visualRef.current.gain=0;const errorBefore=engineRef.current?.draft??'';const errorPasted=pasting.current||native.inputType==='insertFromPaste';applyReferenceGuideExposure();engineRef.current?.input(e.currentTarget.value,pasting.current||(e.nativeEvent as InputEvent).inputType==='insertFromPaste'?'paste':'typed',{version:'dom-edit-v1',kind:'input',inputType:(e.nativeEvent as InputEvent).inputType??null,data:(e.nativeEvent as InputEvent).inputType==='insertText'?(e.nativeEvent as InputEvent).data??null:null});pasting.current=false;const observingFixed=!!fixedPaceScopeRef.current;if(followRef.current?.active||followAutoEntryRef.current)commitFollowInput(followInputRef.current.commit(e.currentTarget.value,native));if(observingFixed)observeFixedPaceInput(native);showCommittedInput();syncFeedback();observeTypingError(native,errorBefore,'input',errorPasted)}} onKeyDown={handleAnswerKeyDown} onKeyUp={e=>{pressedKeysRef.current.delete(e.code)}}/></div>{result&&!fixture&&<button type="button" className="feedback-review-hit hit" style={hitStyle(geometry.inputCard.status)} aria-label={t('hud.errorCount',{count:result.errors})} onClick={()=>void openPanel('review')}><span className="sr-only">{t('studio.reviewErrors')}</span></button>}<button className="submit-hit hit" onClick={event=>{if(event.nativeEvent.isTrusted){event.preventDefault();submit(true)}}} onPointerDown={e=>{if(document.activeElement===inputRef.current)e.preventDefault();prepareTypingErrorFeedback(e.nativeEvent)}} onKeyDown={e=>prepareTypingErrorFeedback(e.nativeEvent)} style={hitStyle(zones.submit)} type="submit" disabled={readonly||paused} aria-label={result?.errors===0?t('hud.next'):t('studio.checkDictation')} title={result?.errors===0?t('hud.next'):t('hud.check')}><span className="sr-only">{result?.errors===0?t('hud.next'):t('hud.check')}</span></button></form>
 <span id="responsive-hud-description" className="sr-only">{t('studio.hudDescription')}</span><span ref={presentationStatusRef} className="sr-only" role="status"/>
 <div id="entry-status" className="sr-only">{result?t('studio.lastResultSummary',{errors:result.errors}):t('studio.notChecked')}</div>
 <div id="submission-announcement" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{result?.announcement&&result.announcement.locale===locale&&!fixture&&replayIndex===null&&<span key={result.attemptId}>{t(result.announcement.kind==='firstCompletion'?'studio.submissionFirstCompletion':result.announcement.kind==='correct'?'studio.submissionCorrect':'studio.submissionCorrection')} {t('studio.resultSummary',{errors:result.errors,gain:result.gain,total:result.announcement.total})}</span>}</div>
 <button className="play-hit hit" style={playerHitStyle(zones.play)} onPointerDown={()=>{followPauseClickRef.current=!!followRef.current?.active&&!lessonRef.current?.paused}} onPointerCancel={()=>{followPauseClickRef.current=false}} onPointerUp={()=>{setTimeout(()=>{followPauseClickRef.current=false},0)}} onClick={()=>togglePlay()} aria-label={t('studio.playPause')} disabled={mediaKind==='image'}><span className="sr-only">{t('studio.play')}</span></button>
 {!fixture&&<button className="hit cue-previous" style={playerHitStyle(geometry.zones.previous)} disabled={!cueMarkers.some(c=>c.cueIndex===transportCueIndex-1)} onClick={e=>changeCue(transportCueIndex-1,false,e.nativeEvent.isTrusted)} aria-label={t('studio.previous')}><span className="sr-only">{t('studio.previous')}</span></button>}
 <input className="seek-hit" style={{...hitStyle(zones.seek),'--seek-thumb-width':`${geometry.seekThumbWidthCss}px`} as import('react').CSSProperties} ref={seekRef} type="range" min="0" max={mediaDuration||(engineRef.current&&strictCourse(engineRef.current.getSnapshot().material)?0:72)} step=".05" defaultValue="0" aria-label={engineRef.current&&strictCourse(engineRef.current.getSnapshot().material)&&!mediaDuration?t('studio.durationUnavailable'):t('studio.seekLabel')} disabled={mediaKind==='image'||!mediaDuration} onChange={e=>{cancelFollow('manual-seek');mediaInteractedRef.current=true;if(listening.playerRef.current?.getState().active){listening.playerRef.current.seek(Number(e.target.value));return}if(!seekTo(Number(e.target.value)))notify('素材暂时不可定位，等待浏览器加载。')}}/>
 {!fixture&&inlineCueTargets&&cueMarkers.map(c=><button key={c.id} className="hit cue-marker" style={hitStyle(geometry.cueMarker(c.ratio))} aria-label={t('studio.cuePosition',{number:c.cueIndex+1,seconds:c.start})} aria-current={transportCueIndex===c.cueIndex?'true':undefined} title={t('studio.cuePosition',{number:c.cueIndex+1,seconds:c.start})} onPointerDown={e=>{suppressCueClickRef.current=false;cueDragRef.current={pointerId:e.pointerId,startX:e.clientX,dragging:false};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const drag=cueDragRef.current;if(!drag||drag.pointerId!==e.pointerId)return;if(Math.abs(e.clientX-drag.startX)>4)drag.dragging=true;if(drag.dragging)dragTimeline(e.clientX)}} onPointerUp={e=>{const drag=cueDragRef.current;if(drag?.pointerId!==e.pointerId)return;suppressCueClickRef.current=drag.dragging;if(drag.dragging)dragTimeline(e.clientX);cueDragRef.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>{cueDragRef.current=null;suppressCueClickRef.current=false}} onClick={e=>{if(suppressCueClickRef.current){suppressCueClickRef.current=false;return}if(e.detail===0){changeCue(c.cueIndex,false,e.nativeEvent.isTrusted);return}const stage=stageRef.current?.getBoundingClientRect();if(!stage||stage.width<=0)return;const marker=nearestCueMarker(cueMarkers,geometry.timelineProgress(e.clientX,stage.left,stage.width));if(marker)changeCue(marker.cueIndex,false,e.nativeEvent.isTrusted)}}><span className="sr-only">{t('studio.sentencePrefix')}{c.cueIndex+1}{t('studio.sentenceSuffix')}</span></button>)}
 {!fixture&&<button className="hit cue-next" style={playerHitStyle(geometry.zones.next)} disabled={!cueMarkers.some(c=>c.cueIndex===transportCueIndex+1)} onClick={e=>changeCue(transportCueIndex+1,false,e.nativeEvent.isTrusted)} aria-label={t('hud.next')}><span className="sr-only">{t('hud.next')}</span></button>}
 <button className="mute-hit hit" style={playerHitStyle(zones.mute)} onClick={toggleCourseMute} aria-pressed={courseMuted} aria-label={t('studio.toggleMute')}><span className="sr-only">{t('studio.mute')}</span></button><input className="volume-hit" style={{display:fixture?'block':'none'}} type="range" min="0" max="1" step=".05" value={courseVolume} aria-label={t('studio.courseVolume')} onChange={e=>changeCourseVolume(Number(e.target.value))}/>
 {fixture&&<button className="fullscreen-hit hit" style={rectStyle(LEGACY_ZONES.fullscreen)} onClick={toggleFullscreen} aria-label={t('studio.toggleFullscreen')}><span className="sr-only">{t('studio.fullscreen')}</span></button>}

 <div className="status-strip" data-drawer-companion={portrait&&!fixture?true:undefined} data-history-mode={historyStatus?.mode??'unprepared'}><span>{fixture?t('studio.fixtureStatus'):replayIndex!==null?t('studio.replayStatus'):mediaKind==='demo'?t('studio.practiceStatus'):t('studio.localMediaStatus')}</span><button onClick={()=>openPanel('data')}>{restoreFailed?t('studio.restoreFailed'):historyStatus?.mode==='unprepared'?t('studio.checkingPermission'):historyStatus?.error?t('studio.historyUnsaved'):recoveryStorageError?t('studio.tabRecoveryUnavailable'):historyRef.current?.isFreshPreview&&historyStatus?.mode==='legacy'?t('studio.awaitingInput'):historyStatus?.mode==='off'||historyStatus?.mode==='awaiting-segment'?t('studio.temporaryPractice'):historyStatus?.mode==='enabling'?t('studio.enablingHistory'):historyStatus?.mode==='segment'?(historyStatus.dirty||historyStatus.pendingWrites?t('studio.savingSegment'):t('studio.savedAllowed')):historyStatus?.mode==='legacy'&&(historyStatus.dirty||historyStatus.pendingWrites)?t('studio.savingLocally'):persistence?.state==='persisted'?t('studio.savedLocally'):persistence?.state==='error'?t('studio.unsavedExport'):persistence?.state==='pending'?t('studio.savingLocally'):t('studio.localProcessing')}</button><button onClick={pauseTraining}>{paused?t('studio.resumePractice'):t('studio.pausePractice')}</button><button onClick={()=>togglePlay(true)}>{t('studio.repeatSentence')}</button></div>
 {activeRecord&&<div className="record-banner" role="status"><span>{t('studio.recordBanner')}{ui(recordState.audioLabel)} · {(recordState.bytes/1048576).toFixed(1)} MB</span>{recordState.capacity.status!=='ok'&&<button onClick={()=>openPanel('record')} aria-label={t('studio.capacityHint')}>{recordState.capacity.status==='low'?t('studio.lowCapacity'):t('studio.unknownCapacity')}</button>}<button onClick={()=>stopRecording()} disabled={recordState.state==='stopping'}>{recordState.state==='stopping'?t('studio.finishing'):t('studio.stopSave')}</button></div>}
 {replayIndex!==null&&<div className="replay-banner"><span>{t('studio.eventReplay')}{replayIndex} / {reviewSnapshot?.events.length??0}</span><button onClick={exitReplay}>{t('studio.returnPractice')}</button></div>}
 {courseIntent&&<div className="course-intent-banner" role="status" aria-live="polite"><span>{t(courseIntent==='cafe'?'media.intentCafe':'media.intentNps')}</span><button type="button" className="course-intent-keep" disabled={referenceBusy||activeRecord||startingRecord||restoreFailed||!!courseSwitchRef.current?.committed} onClick={()=>{setCourseIntent(null);if(typeof window!=='undefined'&&window.history){const cleaned=stripCourseQueryParam(window.location.href);window.history.replaceState(window.history.state,'',cleaned)}}}>{t('media.intentKeep')}</button><button type="button" className="course-intent-switch" disabled={referenceBusy||activeRecord||startingRecord||restoreFailed||!!courseSwitchRef.current?.committed} onClick={event=>void startBuiltinPractice(courseIntent==='cafe'?CAFE_MATERIAL:NPS_MATERIAL,event.nativeEvent.isTrusted).catch(()=>{})}>{referenceBusy?t('media.verifyingSaving'):t(courseIntent==='cafe'?'media.intentSwitchCafe':'media.intentSwitchNps')}</button></div>}
 {followDeepLinkSurface.showTip&&<div className="follow-intent-banner" role="status" aria-live="polite" data-follow-surface="tip"><span>{t('follow.deepLinkTip')}</span><button type="button" className="follow-intent-dismiss" onClick={()=>setFollowDeepLinkDismissed(true)}>{t('follow.deepLinkDismiss')}</button><button type="button" className="follow-intent-start" disabled={followUnavailable&&!followAutoReady} onClick={event=>{setFollowDeepLinkDismissed(true);if(!followAutoReady)startFollow(event.nativeEvent.isTrusted)}}>{t('follow.deepLinkStart')}</button></div>}
 {followDeepLinkSurface.showRecover&&<div className="follow-intent-banner follow-recover-banner" role="alert" aria-live="assertive" data-follow-surface="recover" data-recover-kind={followDeepLinkSurface.recoverKind}><span>{t(followDeepLinkSurface.recoverKind==='media-error'?'follow.recoverMedia':followDeepLinkSurface.recoverKind==='rate-failed'?'follow.recoverRate':'follow.recoverPlay')}</span><button type="button" className="follow-intent-dismiss" onClick={()=>cancelFollow('manual-pause')}>{t('follow.recoverDismiss')}</button><button type="button" className="follow-intent-start" disabled={followUnavailable} onClick={event=>startFollow(event.nativeEvent.isTrusted)}>{t('follow.recoverRetry')}</button></div>}
 {editingLayout&&<LayoutEditor portrait={portrait} portraitHeight={portraitHeight} surfaceHeight={geometry.height} initial={arrangementRef.current} base={portrait?{media:layoutBase.media,inset:layoutBase.inset,subtitle:layoutBase.subtitle,metrics:layoutBase.metrics}:layout==='split'?{media:{x:0,y:0,w:1133,h:735},inset:SPLIT_INSET}:{}} onChange={previewLayout} onClose={finishLayout} onCancel={()=>{cancelLayoutPreview(true);engineRef.current?.setFrozen('modal',!!visualRef.current?.fixture||!!replaySnapshot.current)}} onResetAll={()=>previewLayoutMode('lesson')}/>}
 <dialog ref={sceneFallbackRef} className="scene-display-fallback" role="alertdialog" aria-labelledby="scene-display-title" onCancel={e=>e.preventDefault()}><p id="scene-display-title">{t(sceneFailure==='failed'?'studio.displayInterrupted':'studio.displayRecovering')}</p>{sceneFailureCode&&<p><code translate="no">{sceneFailureCode}</code></p>}<button type="button" disabled={sceneFailure==='recovering'} onClick={()=>{frameLoopRef.current?.retry()}}>{t('studio.retryDisplay')}</button></dialog>
 {courseError&&!builtinMediaReady&&mediaKind==='demo'&&!visualRef.current?.ready&&visualRef.current?.message==='视频暂不可用，请重新加载'&&<div className="scene-media-error" role="alert"><p>{t('error.videoUnavailable')}</p><button type="button" onClick={()=>void openPanel('media')}>{t('studio.media')}</button></div>}
 {(!ready||!fontsReady)&&<div className="initializing">{t('studio.restoring')}</div>}
 </div>
 <div className="desktop-note" hidden={responsive}>{t('studio.prototypeNote')}</div>


 <dialog ref={dialogRef} className="studio-dialog" aria-labelledby="studio-panel-title" onCancel={e=>{e.preventDefault();closePanel()}} onClick={e=>{if(e.target===dialogRef.current)closePanel()}}>{panel&&<motion.div key={panel} initial={{opacity:0,y:reducedMotion?0:10}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reducedMotion?0:.16}}><header className="panel-head"><div><small>LINGOTRACE / STUDIO 06</small><h1 id="studio-panel-title">{{media:t('panel.media'),layout:t('panel.layout'),camera:t('studio.camera'),record:t('panel.record'),library:t('panel.library'),review:t('panel.review'),data:t('panel.data'),settings:t('panel.settings'),history:t('panel.history'),bookmarks:t('panel.bookmarks'),references:t('panel.references'),'reference-confirm':t('panel.referenceConfirm'),'review-tasks':t('panel.reviewTasks'),hint:t('panel.hint')}[panel]}</h1></div><button onClick={()=>closePanel()} aria-label={t('panel.close')}><Icon name="close"/></button></header><div className="panel-body">
 {panel==='history'&&repoRef.current&&<><ListeningSessionHistory repository={repoRef.current} download={download}/><div className="button-row" aria-label={t('history.recordType')}><button aria-pressed={historyKind==='complete'} onClick={()=>setHistoryKind('complete')}>{t('history.completeTraining')}</button><button aria-pressed={historyKind==='segments'} onClick={()=>setHistoryKind('segments')}>{t('history.partialSegments')}</button><button aria-pressed={historyKind==='calendar'} onClick={()=>setHistoryKind('calendar')}>{t('history.calendar')}</button></div>{historyKind==='calendar'?<RecordCalendarPanel referenceRepository={referenceRepository()} repository={repoRef.current} currentSessionId={engineRef.current?.getSnapshot().sessionId??null} download={download} currentHistoryOff={historyStatus?.mode==='off'}/>:historyKind==='complete'?<LegacyHistoryPanel referenceRepository={referenceRepository()} repository={repoRef.current} currentSessionId={engineRef.current?.getSnapshot().sessionId??null} download={download} onContinue={continueSavedHistory} continueDisabledReason={referenceBusy?t('history.verifyingRound'):historyStatus?.control?.state!=='legacy-default'?t('history.permissionGap'):null}/>:<SegmentHistoryPanel repository={repoRef.current} currentSessionId={engineRef.current?.getSnapshot().sessionId??null} download={download}/>}</>}
 {panel==='hint'&&<section className="sheet-section hint-panel" aria-label={t('panel.hint')}><div className="sheet-status-row"><span className="sheet-status-chip" data-state={referenceVisible?'on':'off'}>{referenceVisible?t('hud.referenceShown'):t('hud.referenceHidden')}</span><span className="sheet-status-chip" data-state={readonly?'warn':'idle'}>{readonly?t('hint.unavailable'):t('hint.ready')}</span></div><p className="sheet-lede">{t('hint.lede')}</p><div className="notice hint-tip-card"><strong>{t('hint.sentenceTip')}</strong><p>{engineRef.current?.cue.text?t('studio.sentenceHint',{words:engineRef.current.cue.text.split(' ').slice(0,2).join(' ')}):t('hint.noSentence')}</p><div className="button-row"><button type="button" className="primary" disabled={readonly||referenceBlocked()||!referenceVisible} onClick={()=>{if(referenceBlocked()||!referenceVisible)return;engineRef.current?.exposeHint('hint');notify(t('studio.sentenceHint',{words:engineRef.current?.cue.text.split(' ').slice(0,2).join(' ')??''}))}}>{t('hint.revealWords')}</button><button type="button" disabled={readonly} onClick={()=>setReferenceGuideVisible(!referenceVisible)}>{referenceVisible?t('studio.referenceHideAction'):t('studio.referenceShowAction')}</button></div></div><div className="sheet-section nested"><span className="sheet-section-label">{t('hint.assistModes')}</span><div className="button-row hint-assist-row"><button type="button" aria-pressed={inputStyle==='hint-words'} disabled={readonly||paused||!referenceVisible} onClick={()=>chooseInputStyle('hint-words')}>{t('studio.wordHints')}</button><button type="button" aria-pressed={inputStyle==='hint-letters'} disabled={readonly||paused||!referenceVisible} onClick={()=>chooseInputStyle('hint-letters')}>{t('studio.letterHints')}</button><button type="button" aria-pressed={inputStyle==='words'} disabled={readonly||paused} onClick={()=>chooseInputStyle('words')}>{t('studio.wordUnderlines')}</button><button type="button" aria-pressed={inputStyle==='letters'} disabled={readonly||paused} onClick={()=>chooseInputStyle('letters')}>{t('studio.letterUnderlines')}</button></div><p className="note">{t('hint.assistNote')}</p></div><p className="note">{t('hint.dictationNote')}</p></section>}
{panel==='media'&&<section className="sheet-section media-panel" aria-label={t('panel.media')}><p className="sheet-lede">{t('media.current')}<strong>{mediaName}</strong></p>{courseError&&<p className="notice warn" role="alert">{ui(courseError)}</p>}<h2>{t('media.fixedCourse')}</h2><div className="button-row"><button disabled={referenceBusy||activeRecord||startingRecord||restoreFailed} onClick={()=>setCourseChoice('nps')}>{t('media.npsCourse')}</button><button disabled={referenceBusy||activeRecord||startingRecord||restoreFailed} onClick={()=>setCourseChoice('cafe')}>{t('media.cafeCourse')}</button></div>{courseChoice&&<div className="notice"><p>{t('media.endRoundUsing')}{courseChoice==='nps'?t('media.npsClip'):t('media.cafeCourse')}{t('media.courseChangeNotice')}</p><div className="button-row"><button disabled={!!courseSwitchRef.current?.committed} onClick={cancelCourseSelection}>{t('media.cancelChoice')}</button><button disabled={referenceBusy||activeRecord||startingRecord||restoreFailed} onClick={event=>void startBuiltinPractice(courseChoice==='nps'?NPS_MATERIAL:CAFE_MATERIAL,event.nativeEvent.isTrusted).catch(()=>{})}>{referenceBusy?t('media.verifyingSaving'):t('media.startSelected')}</button></div></div>}<div className="button-row"><label className="button" role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.querySelector<HTMLInputElement>('input')?.click()}}}>{t('media.chooseLocal')}<input type="file" tabIndex={-1} accept="video/*,image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void chooseFile(f)}}/></label><button disabled={referenceBusy||activeRecord||startingRecord||restoreFailed} onClick={()=>{void loadDemo();closePanel()}}>{t('media.reloadCourse')}</button></div><p className="note">{t('media.localNotice')}</p><div className="button-row"><button onClick={()=>void openReferenceLibrary(true)}>{t('media.correctSentence')}</button><button onClick={()=>void openReferenceLibrary(false)}>{t('media.referenceLibrary')}</button></div><div className="button-row"><button disabled={referenceBusy||activeRecord||startingRecord||restoreFailed} onClick={openSubtitleWorkbench}>{t('media.subtitleWorkbench')}</button></div><p className="note">{t('media.workbenchNotice')}</p><h2>{engineRef.current?.getSnapshot().material.cues.length??0}{t('studio.sentenceSuffix')}{engineRef.current?.getSnapshot().material.title??t('media.courseMedia')}</h2><div className="cue-grid">{engineRef.current?.getSnapshot().material.cues.map((c,i)=><button key={c.id} className={engineRef.current?.getSnapshot().cueIndex===i?'selected':''} onClick={event=>{changeCue(i,true,event.nativeEvent.isTrusted);closePanel()}}>{String(i+1).padStart(2,'0')} {engineRef.current?.getSnapshot().completedCueIds.includes(c.id)?t('media.completed'):t('media.toPractice')}</button>)}</div>{engineRef.current?.getSnapshot().material.builtinReference?<p className="note">{t('media.source')}<a href={NPS_COURSE_MEDIA.sourcePage} target="_blank" rel="noreferrer">{t('media.npsOfficial')}</a>{t('media.npsAttribution')}<a href="/studio-assets/nps-connie/playback-variant-v2.json" target="_blank" rel="noreferrer">{t('media.viewHashes')}</a>{t('media.npsLimit')}</p>:<p className="note">{t('media.cafeAttribution')}</p>}</section>}
 {panel==='layout'&&<section className="sheet-section layout-panel" aria-label={t('panel.layout')}><LayoutPlanFiles key={`${portrait}/${portraitHeight}`} applied={layoutTransactionsRef.current.original??currentLayout()} context={{portrait,height:portraitHeight}} onBegin={startLayoutPreview} onPreview={importLayoutPreview} onBusy={setLayoutFileBusy} download={download}/><div className="layout-options">{([{id:'lesson',name:t('layout.coursePrimary'),desc:t('layout.courseDescription')}, {id:'camera',name:t('layout.cameraPrimary'),desc:t('layout.cameraDescription')}, {id:'split',name:t('layout.sideBySide'),desc:t('layout.sideDescription')}] as const).map(o=><button key={o.id} className={layout===o.id?'selected':''} disabled={layoutImportBusy||(o.id!=='lesson'&&cameraState!=='on')} onClick={()=>previewLayoutMode(o.id)}><span className={`layout-sketch ${o.id}`}><i/><i/></span><strong>{o.name}</strong><small>{o.desc}</small></button>)}</div><p className="note">{t('layout.notice')}</p><div className="button-row"><button onClick={()=>openPanel('camera')}>{t('studio.cameraSettings')}</button><button className="primary" onClick={beginLayout} disabled={layoutImportBusy||activeRecord||startingRecord||fixture||replayIndex!==null}>{t('layout.freeEdit')}</button><button disabled={layoutImportBusy} onClick={resetArrangement}>{t('layout.previewDefault')}</button><button disabled={layoutImportBusy||!layoutUndoAvailable} onClick={undoLayout}>{t('layout.undo')}</button><button onClick={()=>closePanel()}>{t('layout.cancel')}</button><button className="primary" onClick={finishLayout} disabled={layoutImportBusy||!layoutPreview}>{t('layout.apply')}</button></div><p className="note">{t('layout.previewNotice')}</p></section>}
 {panel==='camera'&&<section className="sheet-section camera-panel" aria-label={t('studio.camera')}><div className="sheet-status-row"><span className="sheet-status-chip" data-state={cameraState==='on'?'on':cameraState==='requesting'?'busy':cameraState==='error'?'warn':'off'}>{cameraState==='on'?t('hud.cameraLive'):cameraState==='requesting'?t('hud.cameraRequesting'):cameraState==='error'?t('hud.cameraError'):t('hud.cameraOff')}</span></div><div role="status" className={`notice ${cameraState==='error'?'warn':''}`}>{ui(cameraMessage)||t('camera.offNotice')}</div><div className="button-row"><button className="primary" onClick={()=>openCamera()} disabled={cameraState==='requesting'}>{cameraState==='on'?t('camera.reconnect'):t('camera.open')}</button><button onClick={stopCamera}>{cameraState==='requesting'?t('camera.cancel'):t('camera.close')}</button></div>{cameraDevices.length>0&&<label className="field">{t('camera.devices')}<select value={selectedCamera} onChange={e=>setSelectedCamera(e.target.value)}>{cameraDevices.map((d,i)=><option value={d.deviceId} key={d.deviceId}>{d.label||t('camera.number',{number:i+1})}</option>)}</select></label>}<p className="note">{t('camera.notice')}</p></section>}
 {panel==='record'&&<section className="sheet-section record-panel" aria-label={t('panel.record')}><div className="sheet-status-row"><span className="sheet-status-chip" data-state={activeRecord||startingRecord?'on':recordState.error?'warn':'idle'}>{startingRecord?t('common.preparing'):activeRecord?t('studio.recording'):t('studio.record')}</span><span className="sheet-status-chip" data-state={recordState.capacity.status==='low'?'warn':recordState.capacity.status==='ok'?'on':'idle'}>{t('record.capacity')}{recordState.capacity.checking?t('record.capacityUpdating'):''}</span></div><div className="notice">{t('record.scope')}</div><div className="option-list"><label><input type="checkbox" checked={lessonAudio} onChange={e=>setLessonAudio(e.target.checked)} disabled={activeRecord||startingRecord}/>{t('record.courseAudio')}</label><label><input type="checkbox" checked={micAudio} onChange={e=>setMicAudio(e.target.checked)} disabled={activeRecord||startingRecord}/>{t('record.microphone')}</label><label><input type="checkbox" checked={promptAudio} onChange={e=>setPromptAudio(e.target.checked)} disabled={activeRecord||startingRecord}/>{t('record.submissionSound')}</label></div><p className="note">{t('record.audioNotice')}</p><p className="note">{t('record.retentionNotice')}</p><div className={`notice ${recordState.capacity.status==='low'?'warn':''}`} role="status"><strong>{t('record.capacity')}{recordState.capacity.checking?t('record.capacityUpdating'):''}</strong><br/>{ui(recordState.capacity.message)}<p className="note">{t('record.capacityNotice')}</p><button onClick={()=>void recorderRef.current?.refreshStorageEstimate()} disabled={recordState.capacity.checking}>{t('record.refreshCapacity')}</button></div>{storageError&&<div className="notice warn">{t('record.storageUnavailable')}{ui(storageError)}</div>}{recordState.warning&&<div className="notice warn">{ui(recordState.warning)}</div>}{recordState.error&&<div className="notice warn">{ui(recordingFailureMessage(recordState.error,recordState.bytes))}</div>}<div className="button-row"><button className="primary" onClick={()=>startRecording()} disabled={!storageReady||activeRecord||startingRecord||paused||fixture||replayIndex!==null}>{startingRecord?t('common.preparing'):paused?t('record.resumeFirst'):t('record.start')}</button><button onClick={()=>stopRecording()} disabled={!activeRecord}>{t('record.stopFinish')}</button><button onClick={()=>openPanel('library')}>{t('panel.library')}</button></div><p className="note">{t('record.prototypeNotice')}</p></section>}
 {panel==='library'&&<><p className="note">{t('record.downloadNotice')}</p>{recordings.length===0?<div className="empty empty-state" role="status"><span className="empty-glyph" aria-hidden="true">◌</span><p>{t('record.empty')}</p></div>:recordings.map(r=><article className="record-card" key={r.id}><h2>{new Date(r.startedAt).toLocaleString(locale)}</h2><p>{r.status==='complete'?t('record.written'):t('record.incomplete')} · {(r.bytes/1048576).toFixed(2)} MB · {r.mimeType}</p><p className="note">{r.retained?t('record.retained'):t('record.expires',{date:r.expiresAt?new Date(r.expiresAt).toLocaleString(locale):t('record.pendingFinish')})}</p><div className="button-row"><button onClick={()=>{setMutedRecord(null);void previewRecording(r.id)}}>{t('common.preview')}</button><button disabled={activeRecord||startingRecord||!r.complete||r.status!=='complete'} onClick={()=>{clearRecordingPreview();setMutedRecord(r)}}>{t('record.mutedCopy')}</button><button onClick={()=>saveRecording(r)}>{t('record.download')}</button><button onClick={async()=>{await recorderRef.current?.retain(r.id,!r.retained);setRecordings(await recorderRef.current?.list()??[])}}>{r.retained?t('record.unretain'):t('record.retain')}</button><button onClick={()=>{setMutedRecord(null);setDeleteId(r.id)}}>{t('common.delete')}</button></div>{deleteId===r.id&&<div className="notice warn">{t('record.deleteWarning')}<div className="button-row"><button onClick={()=>setDeleteId(null)}>{t('common.cancel')}</button><button onClick={async()=>{await recorderRef.current?.remove(r.id);setDeleteId(null);setRecordings(await recorderRef.current?.list()??[])}}>{t('common.confirmDelete')}</button></div></div>}</article>)}{mutedRecord&&<MutedRecordingCopy key={mutedRecord.id} record={mutedRecord} load={id=>recorderRef.current!.blob(id)} blocked={activeRecord||startingRecord} onClose={()=>setMutedRecord(null)}/>} {preview&&<><video key={preview} className="record-preview" src={preview} controls playsInline muted={monitorMuted} onVolumeChange={e=>{if(monitorPrefs.current.allMuted&&!e.currentTarget.muted)e.currentTarget.muted=true}} onLoadStart={e=>updatePreviewInfo(e.currentTarget,'loading')} onEmptied={e=>updatePreviewInfo(e.currentTarget,'loading')} onLoadedMetadata={e=>updatePreviewInfo(e.currentTarget,'metadata')} onDurationChange={e=>updatePreviewInfo(e.currentTarget,'metadata')} onEnded={e=>updatePreviewInfo(e.currentTarget,'ended')} onError={e=>{if(updatePreviewInfo(e.currentTarget,'error'))notify(t('record.previewFailed'))}}/><p className="note" role="status">{ui(previewInfo.message)}</p></>}<div className="button-row"><button onClick={()=>openPanel('library')}>{t('common.refreshList')}</button><button onClick={()=>openPanel('record')}>{t('record.new')}</button></div></>}
 {panel==='review'&&reviewSnapshot&&<>{renderFixedPaceResult()}{checkedReview&&<CheckedAnswerReview attempt={checkedReview}/>}{reviewSnapshot.material.builtinReference&&<p className="notice">{t('review.npsNotice')}</p>}{reviewSnapshot.material.localReference&&<p className="notice">{t('review.correctedNotice')}</p>}<RoundReview key={reviewSnapshot.sessionId} snapshot={reviewSnapshot} assistance={listening.conditionsRef.current?.identity.sessionId===reviewSnapshot.sessionId?a=>listeningAssistanceLabel(listening.conditionsRef.current,a):undefined} disabledReason={fixture||replaySnapshot.current?'先返回真实训练，再继续练习。':restoreFailed?'先恢复历史设置，再继续练习。':mediaKind!=='demo'?'请先切回课程素材。':paused?'先继续已暂停的练习，再选择句子。':null} onContinue={continueRoundReview} renderContextBookmark={cueId=><><ReviewTaskComposer key={`${reviewSnapshot.sessionId}/${reviewSnapshot.material.version}/${cueId}/${reviewSnapshot.attempts.filter(a=>a.cueId===cueId).at(-1)?.attemptId??''}`} cueNumber={reviewSnapshot.material.cues.findIndex(c=>c.id===cueId)+1} disabledReason={listening.hasScope()?'听力辅助条件记录暂不支持旧版复习任务来源；可继续本轮练习。':reviewBusy?'正在处理复习操作。':fixture||replaySnapshot.current?'返回真实练习后再安排复习。':!['legacy','segment'].includes(historyStatus?.mode??'')?'本页来源尚无已确认的保存许可；不会通过任务补存临时答案。':activeRecord||startingRecord?'结束录制后再核验安排。':null} onSave={(due,requestId)=>saveReviewTask(cueId,due,requestId)} onOpenLibrary={()=>void openPanel('review-tasks')}/><ContextBookmarkComposer key={cueId} reference={getBookmarkReference(reviewSnapshot,cueId)} disabledReason={fixture||replaySnapshot.current?'参考预览或事件回放不创建收藏。':!bookmarkMediaReady||mediaKind!=='demo'?'当前原片尚未通过内容校验，暂不能绑定收藏。':null} onSave={(start,end)=>saveContextBookmark(cueId,start,end)} onOpenLibrary={()=>void openPanel('bookmarks')}/></>}/><div className="review-stats"><div><strong>{reviewSnapshot.earnedWords}</strong><span>{t('review.confirmedWords')}</span></div><div><strong>{reviewSnapshot.completedCueIds.length}<small>/{reviewSnapshot.material.cues.length}</small></strong><span>{t('review.completedSentences')}</span></div><div><strong>{fmt(reviewSnapshot.activeMs)}</strong><span>{t('review.inputTime')}</span></div></div><h2>{t('review.pacePauses')}</h2><PaceTimeline snapshot={reviewSnapshot}/>{reviewSnapshot.attempts.length?<><h2>{t('review.realTimeline')}</h2><div className={`session-chart${chartExpanded?' is-expanded':''}`} role="img" aria-label={t('review.matchChartLabel')} data-expanded={chartExpanded||undefined}><div className="chart-labels"><span>{t('review.wordMatch')}</span><button type="button" className="pace-expand-toggle" aria-pressed={chartExpanded} onClick={()=>setChartExpanded(v=>!v)}>{t(chartExpanded?'review.collapseChart':'review.expandChart')}</button><span>100</span></div><div className="chart-points">{deriveCurves(reviewSnapshot).map((p,i)=><div key={p.attemptId} className={`chart-column ${p.conditions.exposure}`} title={`${fmt(p.activeMs)} ${p.accuracy}% ${p.conditions.exposure==='first'?t('review.firstAttempt'):t('review.retry')}`}><span>{p.accuracy}%</span><i style={{height:`${p.accuracy}%`}}/><small>{i+1}</small></div>)}</div><div className="chart-labels"><span>{t('review.chartLegend')}</span><span>{t('review.chartSequence')}</span></div></div><p className="note">{t('review.chartNotice')}</p><div className="attempt-list">{reviewSnapshot.attempts.slice().reverse().map(a=><details key={a.attemptId}><summary>{t('studio.sentencePrefix')}{reviewSnapshot.material.cues.findIndex(c=>c.id===a.cueId)+1}{t('review.sentenceSeparator')}{a.accuracy}% · {a.conditions.exposure==='first'?t('review.firstAttempt'):t('review.retry')}{t('review.gainedPrefix')}{a.gain}</summary><p>{a.answer}</p><div className="token-list">{a.alignment.map((token,i)=><span className={token.kind} key={i}><strong>{t(token.kind==='match'?'hud.correct':token.kind==='missing'?'hud.missing':token.kind==='extra'?'hud.extra':'hud.wrong')}: </strong>{token.actual||token.expected}{token.kind==='replace'?` → ${token.expected}`:''}</span>)}</div><p className="note">{projectAttemptReferenceExposure(reviewSnapshot,a).status==='recorded'?t('review.referenceSeen'):''}{ui(listeningAssistanceLabel(listening.conditionsRef.current?.identity.sessionId===a.sessionId?listening.conditionsRef.current:null,a))} · {a.conditions.pasted?t('review.pasted'):t('review.noPaste')} · {fmt(a.activeMs)}</p></details>)}</div></>:<div className="empty empty-state" role="status"><span className="empty-glyph" aria-hidden="true">◌</span><p>{t('review.noSubmissions')}</p></div>}<h2>{t('review.replayEvents')}</h2><input className="replay-slider" type="range" min="1" max={reviewSnapshot.events.length} defaultValue={reviewSnapshot.events.length} disabled={activeRecord||startingRecord} aria-label={t('review.replayToEvent')} onChange={e=>{if(['recording','stopping'].includes(recorderRef.current?.getSnapshot().state??'idle'))return;const n=Number(e.target.value);replaySnapshot.current=replay(reviewSnapshot.events.slice(0,n),reviewSnapshot.material);setReplayIndex(n)}}/><div className="button-row"><button disabled={activeRecord||startingRecord} onClick={()=>{if(replayIndex===null){replaySnapshot.current=replay(reviewSnapshot.events.slice(0,1),reviewSnapshot.material);setReplayIndex(1)}closePanel();engineRef.current?.setFrozen('modal',true)}}>{t('review.viewStageReplay')}</button><button onClick={()=>openPanel('data')}>{t('review.exportComplete')}</button><button onClick={()=>openPanel('history')}>{t('review.openHistory')}</button></div></>}
 {panel==='review-tasks'&&<>{reviewTrackingMessage&&<p className="notice" role="status">{ui(reviewTrackingMessage)}</p>}{reviewStartFailure&&<div className="notice warn" role="alert">{ui(reviewStartFailure)}{t('review.trackingNotOpen')}<button onClick={leaveFailedReviewStart}>{t('review.leavePreparation')}</button></div>}{reviewPendingCount>0&&<div className="notice warn">{t('review.pendingPrefix')}{reviewPendingCount}{t('review.pendingSuffix')}<button disabled={reviewBusy} onClick={()=>void flushReviewResults()}>{t('review.retryLinks')}</button></div>}<ReviewTaskPanel entries={reviewRows} unreadableCount={reviewUnreadable} loading={reviewLoading||reviewBusy} error={ui(reviewError)} blockedReason={reviewStartFailure||(!['legacy','segment'].includes(historyStatus?.mode??'')?'请先在练习历史设置明确从现在记录；不会补录关闭期间内容。':activeRecord||startingRecord?'请先结束录制。':fixture||replayIndex!==null?'请返回真实训练。':null)} onReload={refreshReviewTasks} onStart={startReviewTask} onChange={changeReviewTask} onExport={exportReviewTask}/></>}
 {panel==='references'&&<>{referenceError&&<p role="alert" className="notice warn">{ui(referenceError)}</p>}<MaterialCorrectionPanel key={`${engineRef.current?.getSnapshot().sessionId}/${referenceTarget?.material.version??'list'}/${referenceTarget?.cueId??''}`} current={referenceTarget} entries={referenceEntries} pool={originalMediaPool} controllerRef={referencePreviewRef} monitor={{volume:courseVolume,courseMuted,allMuted:monitorMuted}} recordingBlocked={activeRecord||startingRecord} isRecordingBlocked={bookmarkRecordingBlocked} transitionBusy={referenceBusy} unreadableCount={referenceUnreadable} onBeforePreview={()=>{if(bookmarkRecordingBlocked()||referenceBlocked())return false;lessonRef.current?.pause();return true}} onSave={saveEditedReference} onStart={startSavedReference} onReload={refreshReferenceLibrary} onCancel={()=>closePanel()}/></>}
 {panel==='reference-confirm'&&referenceConfirmation&&<section aria-label={t('reference.confirmTitle')}><p>{t('reference.startedPrefix')}{referenceConfirmation.materialVersion}{t('reference.startedSuffix')}</p><p className="note">{ui(referenceConfirmation.message)}</p>{referenceConfirmation.exposed?<><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{referenceConfirmation.text}</p><p>{referenceConfirmation.start}–{referenceConfirmation.end}{t('common.seconds')}</p><p className="notice">{t('reference.exposureNotice')}</p><button className="primary" onClick={continueReferencePractice}>{t('reference.hideStart')}</button></>:<button onClick={showReferenceConfirmation}>{t('reference.viewConfirmation')}</button>}<p className="note">{t('reference.correctedLimit')}</p></section>}
 {panel==='bookmarks'&&<ContextBookmarkLibrary repository={contextRepository()} pool={originalMediaPool} controllerRef={bookmarkPreviewRef} monitor={{volume:courseVolume,courseMuted,allMuted:monitorMuted}} recordingBlocked={activeRecord||startingRecord} isRecordingBlocked={bookmarkRecordingBlocked} onBeforePlay={()=>{if(bookmarkRecordingBlocked())return false;lessonRef.current?.pause();return true}}/>}
 {panel==='data'&&<>{recoveryStorageError&&<p className="notice warn" role="alert">{t('settings.tabRecoveryUnavailable')}</p>}{restoreFailed&&<div className="notice warn">{t('data.restoreNotice')}</div>}{fixture&&<div className="notice warn" role="alert">{t('data.fixtureBlocked')}</div>}<p>{t('data.description')}</p><div className="notice">{t('data.localNotice')}</div><div className="button-row"><button className="primary" disabled={!!fixture||!exportRef.current} onClick={()=>{if(fixture)return;const p=exportRef.current;if(p)download('lingotrace-studio-session.json',new Blob([p.json],{type:'application/json'}))}}>{t('data.downloadJson')}</button><button disabled={!!fixture||!exportRef.current} onClick={()=>{if(fixture)return;const p=exportRef.current;if(p)download('lingotrace-studio-session.csv',new Blob([p.csv],{type:'text/csv;charset=utf-8'}))}}>{t('data.downloadCsv')}</button></div><p className="note">{t('data.samplePrefix')}{exportRef.current?.snapshot.session.sequence??0}{t('data.eventSeparator')}{exportRef.current?.snapshot.attempts.length??0}{t('data.matchFormula')}</p><p className="notice">{t('data.temporaryNotice')}</p>{historyStatus?.error&&<p className="notice warn" role="alert">{ui(historyStatus.error)}</p>}<div className="button-row"><button disabled={restoreFailed||!['legacy','segment'].includes(historyStatus?.mode??'')} onClick={()=>void retryHistorySave()}>{t('data.retrySave')}</button><button onClick={()=>openPanel('history')}>{t('settings.savedHistory')}</button><button onClick={()=>openPanel('settings')}>{t('settings.historySettings')}</button></div></>}
 {panel==='settings'&&<><InterfaceLanguageSettings/>{recoveryStorageError&&<p className="notice warn" role="alert">{t('settings.tabRecoveryUnavailable')}</p>}{responsive&&<details className="display-settings"><summary>{t('settings.display')}</summary><div className="button-row" aria-label={t('settings.layoutLabel')}>{(['auto','portrait','landscape']as const).map((mode,i)=><button key={mode} aria-pressed={viewportMode===mode} onClick={()=>setViewportMode(mode)}>{[t('settings.autoLayout'),t('settings.portraitLayout'),t('settings.landscapeLayout')][i]}</button>)}</div><p className="note">{t('settings.layoutNotice')}</p></details>}<h2>{t('settings.history')}</h2>{historyStatus?.mode==='off'&&<p className="notice" role="status">{repoRef.current?.getAutomaticHistoryStatus().settingsState==='pending'?t('settings.offPending'):historyStatus.error?t('settings.offFailed'):repoRef.current?.getAutomaticHistoryStatus().settingsState==='persisted'?t('settings.offSaved'):t('settings.offTemporary')}</p>}<p>{t('settings.historyNotice')}</p>{temporaryHistory&&<p className="notice">{t('settings.partialNotice')}</p>}<div className="button-row"><button disabled={!ready||restoreFailed||['legacy','segment','enabling'].includes(historyStatus?.mode??'')} onClick={()=>void changeHistoryRecording(true)}>{historyStatus?.mode==='enabling'?t('settings.enabling'):historyStatus?.mode==='legacy'||historyStatus?.mode==='segment'?t('settings.historyOn'):t('settings.recordFromNow')}</button><button disabled={!ready||!historyStatus?.control} onClick={()=>void changeHistoryRecording(false)}>{historyStatus?.mode==='enabling'?t('settings.cancelEnable'):t('settings.historyOff')}</button><button disabled={!ready||restoreFailed} onClick={()=>void historyReconcileRef.current()}>{t('settings.refreshHistory')}</button><button onClick={()=>openPanel('history')}>{t('settings.savedHistory')}</button></div>{historyStatus?.error&&<p className="notice warn" role="alert">{ui(historyStatus.error)}{historyStatus.mode==='off'&&<button onClick={()=>void changeHistoryRecording(false)}>{t('settings.retryOff')}</button>}</p>}<p className="note">{t('settings.historyDetails')}</p>{restoreFailed&&<div className="notice warn">{t('settings.restoreFailed')}<button onClick={()=>window.location.reload()}>{t('settings.reopenRestore')}</button></div>}<label className="field">{t('studio.courseVolume')}<input aria-label={t('settings.adjustCourseVolume')} type="range" min="0" max="1" step=".05" value={courseVolume} onChange={e=>changeCourseVolume(Number(e.target.value))}/></label><div className="option-list"><label><input type="checkbox" checked={soundEnabled} onChange={e=>void setStandbySound(e.target.checked)}/>{t('settings.standbySound')}</label><label><input type="checkbox" checked={reducedMotion} onChange={e=>setReducedMotion(e.target.checked)}/>{t('settings.reducedMotion')}</label></div><div className="field"><span>{t('studio.visualEdition')}</span><div className="edition-switch" role="group" aria-label={t('studio.visualEdition')}>{(['pro','kids'] as const).map(id=><button key={id} type="button" aria-pressed={visualEdition===id} onClick={()=>{setVisualEdition(id);writeVisualEdition(localStorage,id)}}>{id==='pro'?t('studio.editionPro'):t('studio.editionKids')}</button>)}</div><p className="note">{t('studio.editionNote')}</p></div><div className="button-row"><a className="button" href="/cards/">{t('studio.openCards')}</a></div><label><input type="checkbox" checked={monitorMuted} onChange={e=>changeMonitorMuted(e.target.checked)}/>{t('settings.muteMonitor')}</label><TypingErrorSettings feedback={typingErrorFeedback}/><SubmissionSoundSettings control={submissionSound}/><WhiteNoiseSettings control={whiteNoise}/><VideoPaletteSettings control={videoPalette}/><details className="display-settings"><summary>{t('settings.keyboardHelp')}</summary><p className="note">{t('settings.practiceExplanation')}</p></details><div className="button-row"><button onClick={toggleFullscreen}>{t('studio.toggleFullscreen')}</button><button onClick={downloadScene}>{t('settings.downloadStage')}</button><button onClick={()=>openPanel('data')}>{t('settings.trainingData')}</button><button onClick={()=>openPanel('history')}>{t('panel.history')}</button><button onClick={()=>openPanel('bookmarks')}>{t('panel.bookmarks')}</button><button onClick={()=>openPanel('review-tasks')}>{t('panel.reviewTasks')}</button><button onClick={()=>void openReferenceLibrary(false)}>{t('media.referenceLibrary')}</button><button onClick={()=>openPanel('library')}>{t('panel.library')}</button></div><p className="note">{t('settings.screenshotNotice')}</p><button onClick={()=>setResetPrompt(true)}>{t('settings.newRound')}</button>{resetPrompt&&<div className="notice warn">{t('settings.newRoundNotice')}<div className="button-row"><button onClick={()=>setResetPrompt(false)}>{t('common.cancel')}</button><button disabled={newRoundBusy} onClick={event=>void beginNewRound(event.nativeEvent.isTrusted)}>{newRoundBusy?t('common.preparing'):t('settings.confirmNewRound')}</button></div></div>}<details className="display-settings"><summary>{t('settings.archive')}</summary><label><input type="checkbox" checked={fixture} disabled={activeRecord||startingRecord} onChange={e=>{setFixture(e.target.checked);if(e.target.checked)lessonRef.current?.pause()}}/>{t('settings.legacyPreview')}</label><a className="archive-link" href="/demo/01-fitness-flow/">{t('settings.archiveDemo')}</a></details></>}
 </div></motion.div>}</dialog>
 <AnimatePresence>{toast&&<motion.div className="studio-toast" role="status" initial={{opacity:0,y:reducedMotion?0:10}} animate={{opacity:1,y:0}} exit={{opacity:0}}>{ui(toast)}</motion.div>}</AnimatePresence>
 </main>
}
