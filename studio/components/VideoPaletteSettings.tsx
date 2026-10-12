import {useStudioLocale} from '../i18n/react';
import {useEffect, useRef, useState, type RefObject} from 'react';
import {VideoPaletteController, INITIAL_VIDEO_PALETTE_STATE, type PaletteMode} from '../media/video-palette';
import type {SceneVisual} from '../scene/renderer';

/** Page-local display preferences only. Color samples go to the shared scene ref,
 * not React state, a history writer, the recorder graph, or a remote service. */
export function useVideoPalette(
  video: RefObject<HTMLVideoElement | null>,
  visual: RefObject<SceneVisual | null>,
  reducedMotion: boolean,
) {
  const controller = useRef<VideoPaletteController | null>(null);
  const [state, setState] = useState(INITIAL_VIDEO_PALETTE_STATE);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let current = true;
    const instance = new VideoPaletteController(element, {
      onPalette: palette => {if (current && visual.current) visual.current.palette = palette;},
      onState: next => {if (current) setState(next);},
    });
    controller.current = instance;
    setState(instance.getSnapshot());
    return () => {
      current = false;
      if (controller.current === instance) controller.current = null;
      instance.dispose();
      if (visual.current) visual.current.palette = null;
    };
  }, [video, visual]);
  useEffect(() => {controller.current?.setReducedMotion(reducedMotion);}, [reducedMotion]);
  return {
    state,
    reducedMotion,
    setMode: (mode: PaletteMode) => controller.current?.setMode(mode),
    lock: () => controller.current?.lock(),
    unlock: () => controller.current?.unlock(),
    sourceChanged: (kind: 'demo' | 'video' | 'image') => controller.current?.sourceChanged(kind),
  };
}

export default function VideoPaletteSettings({control}: {control: ReturnType<typeof useVideoPalette>}) {
 const {t,ui,locale}=useStudioLocale();
  const {state, reducedMotion} = control;
  return <section aria-label={t('palette.title')}>
    <h2>{t('palette.title')}</h2>
    <p className="note">{t('palette.scope')}</p>
    <label className="field">{t('palette.mode')}<select aria-label={t('palette.modeLabel')} value={state.mode} onChange={event => control.setMode(event.target.value as PaletteMode)}>
        <option value="off">{t('palette.off')}</option>
        <option value="frame">{t('palette.frame')}</option>
        <option value="follow">{t('palette.follow')}</option>
      </select>
    </label>
    <p className={state.status === 'unavailable' ? 'notice warn' : 'notice'} role="status">{ui(state.message)}</p>
    {reducedMotion && state.mode === 'follow' && <p className="note">{t('palette.reducedMotion')}</p>}
    <div className="button-row">
      <button disabled={state.mode === 'off' || !state.hasPalette || state.locked} onClick={control.lock}>{t('palette.lock')}</button>
      <button disabled={!state.locked} onClick={control.unlock}>{t('palette.unlock')}</button>
    </div>
    <p className="note">{t('palette.lockNotice')}</p>
    <p className="note">{t('palette.localNotice')}</p>
  </section>;
}
