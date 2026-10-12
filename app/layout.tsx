import type { Metadata } from 'next';
export const metadata:Metadata={title:'训练直播间 · LingoTrace Studio',description:'真实练习事件驱动的英语训练舞台。课程、摄像头、字幕与HUD本机合成。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
