"use client";

import { Capacitor } from '@capacitor/core';

type AdDiagnosticArea = 'chat' | 'diary' | 'ad';
type AdDiagnosticType =
  | 'ad_open_started'
  | 'ad_open_succeeded'
  | 'ad_open_failed'
  | 'ad_block_suspected'
  | 'ad_completed'
  | 'app_server_request_failed'
  | 'ad_unlock_failed';

interface AdDiagnosticEvent {
  area: AdDiagnosticArea;
  type: AdDiagnosticType;
  message?: string;
  context?: Record<string, unknown>;
  createdAt: string;
  platform: string;
}

const STORAGE_KEY = 'dreamary_ad_diagnostics';
const MAX_EVENTS = 50;

export function logAdDiagnostic(
  area: AdDiagnosticArea,
  type: AdDiagnosticType,
  context: Record<string, unknown> = {},
  error?: unknown
) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  const event: AdDiagnosticEvent = {
    area,
    type,
    message,
    context,
    createdAt: new Date().toISOString(),
    platform: Capacitor.getPlatform(),
  };

  const log = type.includes('failed') ? console.warn : console.info;
  log('[DreamaryAd]', event);

  try {
    const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as AdDiagnosticEvent[];
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...previous, event].slice(-MAX_EVENTS)));
  } catch {
    // 진단 로그 저장 실패는 사용자 흐름을 막지 않는다.
  }
}
