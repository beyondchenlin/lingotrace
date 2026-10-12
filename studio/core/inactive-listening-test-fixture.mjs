
/** Explicitly absent B feature in legacy extracted-handler tests. This is not a
 * fake active listener: no player, conditions, scope, storage or input exists.
 * New B behavior is exercised separately against real core/repository code. */
export function inactiveListeningTestScope() {
  const noop = () => {};
  const referenceVisibleRef = { current: false };
  return {
    // Extracted Studio handlers use the default interface locale unless a test overrides it.
    locale: 'en',
    // New page-local fixed-pace observer is absent in legacy extracted tests.
    pacingStrategy: 'adaptive', pacingStrategyRef: { current: 'adaptive' }, fixedRate: 1, fixedRateRef: { current: 1 },
    fixedPaceObserverRef: { current: { snapshot: { phase: 'idle', result: null }, invalidate: noop, clear: noop } },
    fixedPaceInputRef: { current: { clear: noop } }, fixedPaceScopeRef: { current: null },
    fixedPaceFrame:()=>null, setFixedPaceResult: noop, clearFixedPace: noop, invalidateFixedPace: noop, beginFixedPace: noop,
    captureFixedPaceInput: noop, observeFixedPaceInput: noop, observeFixedPaceMedia: noop,
    observeFixedPaceFollow: noop, checkFixedPace: noop, renderFixedPaceResult: () => null,
    // Optional Follow is absent in these legacy extracted-handler fixtures.
    cancelFollow: noop, followRef: { current: null }, followPauseClickRef: { current: false }, followNativeEventsRef: { current: new WeakSet() },
    followAutoEntryRef: { current: null }, followAutoEpochRef: { current: 0 }, prepareFollowInput: () => false, armFollowAutoEntry: noop,
    // These extracted legacy handlers have no active error-cue controller.
    // Real trusted-edit and audio lifecycle behavior has dedicated cue tests.
    cancelTypingErrorFeedback: noop, prepareTypingErrorFeedback: noop, observeTypingError: noop,
    typingErrorFeedback: { control: { current: null } },
    // These older extracted lifecycle scenarios have no pending course switch.
    // Active admission cancellation is covered by studio-course-admission.test.
    courseSwitchRef: { current: null },
    // Legacy handlers have no painted v78 reference; exposure is tested separately.
    applyReferenceGuideExposure: noop,
    referenceVisibleRef,
    setReferenceGuideVisible: visible => { referenceVisibleRef.current = visible; },
    referenceExposureRef: { current: { setPersistence: noop } },
    listening: {
      playerRef: { current: null }, conditionsRef: { current: null }, state: null,
      hasScope: () => false, observe: () => false, captureSubmit: () => null,
      completeSubmit: noop, stopCapture: noop, present: noop,
      saveScope: async () => {}, beforeTransition: async () => {},
      readmit: async () => {}, retry: async () => {}, restoreScope: async () => {},
    },
  };
}
