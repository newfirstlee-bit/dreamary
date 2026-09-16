"use client";

import React, { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { ImageKind, reportImageLoadFailure } from '@/lib/imageDiagnostics';
import { readCachedImage, warmImageCache } from '@/lib/imageCache';

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
  const activeSource = useRef(src);
  const cachedObjectUrl = useRef<string | null>(null);
  const remote = /^https?:\/\//i.test(src);

  useEffect(() => {
    activeSource.current = src;
    cachedObjectUrl.current = null;
    if (remote) {
      // Show the newly saved remote URL immediately. Cache warming must never
      // block the profile screen or make a valid image look like a default avatar.
      setImage({ source: src, display: src, failed: false });
      void warmImageCache(src);
    }
    return () => {
      // Never revoke a caller-owned blob URL.
      if (cachedObjectUrl.current) URL.revokeObjectURL(cachedObjectUrl.current);
      cachedObjectUrl.current = null;
    };
  }, [src, remote]);

  const current = image?.source === src ? image : null;
  // Derive the first remote render directly from the URL; the effect only
  // warms cache and records the current source for subsequent error recovery.
  const displaySrc = remote ? (current?.display ?? src) : src;
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
        if (remote && displaySrc === src) {
          // If the network image failed (including while offline), use a fresh
          // cached blob when available before showing the fallback.
          void readCachedImage(src).then(blob => {
            if (activeSource.current !== src) return;
            if (blob) {
              const blobUrl = URL.createObjectURL(blob);
              cachedObjectUrl.current = blobUrl;
              setImage({ source: src, display: blobUrl, failed: false });
              return;
            }
            reportImageLoadFailure(src, kind, 'Image decode failed');
            setImage({ source: src, display: src, failed: true });
          }).catch(() => {
            if (activeSource.current !== src) return;
            reportImageLoadFailure(src, kind, 'Image decode failed');
            setImage({ source: src, display: src, failed: true });
          });
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
