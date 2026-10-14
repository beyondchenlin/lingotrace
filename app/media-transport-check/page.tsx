import type { Metadata } from 'next';
import NpsTransportCheck from '@/studio/components/NpsTransportCheck';
import { panelsEnglish } from '@/studio/i18n/messages-panels';

export const metadata: Metadata = {
  title: `${panelsEnglish['npsTransport.title']} · LingoTrace`,
  description: panelsEnglish['npsTransport.lede'],
};

export default function MediaTransportCheckPage() {
  return <NpsTransportCheck />;
}
