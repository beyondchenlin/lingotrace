'use client';
import {CardCarousel} from '@/studio/carousel/CardCarousel';
import {readStudioLocale} from '@/studio/i18n/locale';
import {useEffect,useState} from 'react';

export default function CardsPage(){
 const [locale,setLocale]=useState<'en'|'zh-CN'>('en');
 useEffect(()=>{setLocale(readStudioLocale(window.localStorage))},[]);
 return <main lang={locale}><CardCarousel locale={locale}/></main>;
}
