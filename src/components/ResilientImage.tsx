"use client";

import React, { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { ImageKind, reportImageLoadFailure } from '@/lib/imageDiagnostics';
import { resolveImageFromCacheOrNetwork } from '@/lib/imageCache';

interface ResilientImageProps {
  src: string;
  alt: string;
  kind: ImageKind;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
}

export default function ResilientImage({
  src,
  alt,
  kind,
  fill = false,
  className,
  style,
  fallback = null,
}: ResilientImageProps) {
  const [image, setImage] = useState<{ source: string; display: string; failed: boolean } | null>(null);
  const generation = useRef(0);
  const remote = /^https?:\/\//i.test(src);

  useEffect(() => {
    const request = ++generation.current;
    let objectUrl: string | null = null;
    if (remote) {
      // One pipeline; do not download the remote img alongside a cache fetch.
      void resolveImageFromCacheOrNetwork(src).then(blob => {
        if (generation.current !== request) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ source: src, display: objectUrl, failed: false });
      }).catch(() => {
        if (generation.current !== request) return;
        // Hosts may allow img loading but disallow cross-origin fetch.
        setImage({ source: src, display: src, failed: false });
      });
    }
    return () => {
      generation.current++;
      // Never revoke a caller-owned blob URL.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, remote]);

  const current = image?.source === src ? image : null;
  const displaySrc = remote ? current?.display : src;
  if (!displaySrc || current?.failed) return <>{fallback}</>;

  return (
    // 외부 이미지 장애 시 원본 URL 대신 IndexedDB의 Blob URL로 복구하기 위해 native img를 사용합니다.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={displaySrc}
      src={displaySrc}
      alt={alt}
      className={className}
      decoding="async"
      onError={() => {
        if (remote && displaySrc.startsWith('blob:')) {
          // A damaged/undecodable cache entry must still get one original-URL attempt.
          setImage({ source: src, display: src, failed: false });
          return;
        }
        reportImageLoadFailure(src, kind, 'Image decode failed');
        setImage({ source: src, display: displaySrc, failed: true });
      }}
      style={{
        ...(fill ? { position: 'absolute', width: '100%', height: '100%', inset: 0 } : {}),
        ...style,
      }}
    />
  );
}
