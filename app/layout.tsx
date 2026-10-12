import type { Metadata } from 'next';
export const metadata:Metadata={title:'Practice Studio · LingoTrace',description:'An English practice stage driven by real learning events. Course media, camera, captions, and HUD are composed locally.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
