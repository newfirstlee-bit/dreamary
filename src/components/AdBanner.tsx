"use client";

import { useEffect, useRef } from 'react';

interface AdBannerProps {
  width: number;
  height: number;
  adKey: string;
}

export default function AdBanner({ width, height, adKey }: AdBannerProps) {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bannerRef.current) return;
    
    // Prevent multiple script injections during re-renders
    if (bannerRef.current.firstChild) return;

    const conf = document.createElement('script');
    conf.type = 'text/javascript';
    conf.innerHTML = `
      atOptions = {
        'key' : '${adKey}',
        'format' : 'iframe',
        'height' : ${height},
        'width' : ${width},
        'params' : {}
      };
    `;

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = `https://www.highperformanceformat.com/${adKey}/invoke.js`;
    script.async = true;

    bannerRef.current.appendChild(conf);
    bannerRef.current.appendChild(script);
  }, [adKey, width, height]);

  return <div ref={bannerRef} style={{ width, height, margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' }} />;
}
