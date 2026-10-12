import type { Metadata } from 'next';
import NpsTransportCheck from '@/studio/components/NpsTransportCheck';

export const metadata: Metadata = {
  title: '同源视频传输检查 · LingoTrace',
  description: '独立核验固定 NPS 视频的同源直接播放与画布读取，不产生学习记录。',
};

export default function MediaTransportCheckPage() {
  return <NpsTransportCheck />;
}
