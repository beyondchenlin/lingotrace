/** Shared Canvas/capture copy. Learning text is deliberately never translated. */
export const sceneEnglish={
 'scene.cameraPermission':'Permission…',
 'scene.checkedReview':'The checked version of this sentence. Edits require a new check.',
 'scene.restoreDetail':'Local records could not be restored. Retry recovery; historical totals are unavailable.',
 'scene.imageNoTimeline':'Image · no timeline','scene.mediaWaiting':'Media time not ready','scene.noCueMarkers':'No sentence markers',
 'scene.confirmedWords':'Confirmed words','scene.replay':'Replay','scene.restoreFailed':'Recovery failed','scene.standby':'Standby','scene.localMedia':'Local media',
 'scene.referencePace':'Reference pace','scene.estimated':'Estimated','scene.graphemes':'Graphemes / second','scene.hidden':'Hidden','scene.reducedMotion':'Reduced motion','scene.awaitingPlayback':'Awaiting playback','scene.replayPaused':'Replay · live observation paused','scene.typeToTrace':'Type to see your trace',
 'scene.events':'EVENTS / 10s','scene.committedEvents':'Committed events','scene.localOnly':'Local preview only','scene.referenceUnavailable':'Assisted · reference unavailable','scene.referenceAction':'Reference · assisted · Hide','scene.dictationAction':'Dictation · Show reference','scene.complete':'Sentence complete','scene.checked':'Checked','scene.confirmedGain':'+{count} words confirmed','scene.fewerErrors':'{count} fewer differences','scene.image':'Image','scene.muted':'Muted','scene.guideSummary':'Length hints are on. This sentence is assisted: {letters} letter slots and {words} word slots. Scroll to view all slots.','scene.livePausedDetail':'Practice paused; earned progress is kept','scene.liveActiveDetail':'Showing this round\'s actual statistics','scene.noScorableDetail':'Current material has no scorable reference text','scene.awaitingPracticeDetail':'Waiting for practice to be ready','scene.standbyDetail':'Standby motion; this page\'s input is not counted yet','scene.standbyRestoredSuffix':'; saved records are kept','scene.training':'Practicing',
} as const;
export const sceneChinese:Record<keyof typeof sceneEnglish,string>={
 'scene.cameraPermission':'授权中',
 'scene.checkedReview':'这是本句已检查的版本。修改后需重新检查。',
 'scene.restoreDetail':'本地记录恢复失败，请重试；历史统计暂不可用',
 'scene.imageNoTimeline':'图片 · 无时间轴','scene.mediaWaiting':'媒体时间待就绪','scene.noCueMarkers':'无句子标记',
 'scene.confirmedWords':'已确认词','scene.replay':'事件回放','scene.restoreFailed':'恢复失败','scene.standby':'待开始','scene.localMedia':'本机素材',
 'scene.referencePace':'参考节奏','scene.estimated':'估算','scene.graphemes':'字素 / 秒','scene.hidden':'已隐藏','scene.reducedMotion':'减少动效','scene.awaitingPlayback':'等待播放','scene.replayPaused':'回放中 · 实时观察已暂停','scene.typeToTrace':'输入后显示实际轨迹',
 'scene.events':'输入事件 / 10秒','scene.committedEvents':'实际输入事件','scene.localOnly':'仅本机预览','scene.referenceUnavailable':'辅助练习 · 参考不可用','scene.referenceAction':'参考 · 辅助练习 · 隐藏','scene.dictationAction':'听写 · 显示参考','scene.complete':'本句完成','scene.checked':'已检查','scene.confirmedGain':'+{count} 个词已确认','scene.fewerErrors':'比上次少 {count} 处差异','scene.image':'图片','scene.muted':'已静音','scene.guideSummary':'长度提示已开启，本句按辅助练习记录。共 {letters} 个字位、{words} 个词位。可滚动查看全部占位。','scene.livePausedDetail':'练习已暂停，已获得成果保留','scene.liveActiveDetail':'正在显示本轮实际统计','scene.noScorableDetail':'当前素材没有可统计的参考文本','scene.awaitingPracticeDetail':'等待练习就绪','scene.standbyDetail':'待机动效，尚未统计本次输入','scene.standbyRestoredSuffix':'；已有记录保留','scene.training':'训练中',
};
