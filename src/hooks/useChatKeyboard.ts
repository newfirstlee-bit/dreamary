import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Capacitor } from '@capacitor/core';

/** One scroll container inside the actual keyboard-resized WebView. */
export function useChatKeyboard(area: RefObject<HTMLDivElement>) {
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return;
    let cancelled = false;
    let restore: (() => Promise<void>) | undefined;
    let remove: (() => Promise<void>) | undefined;
    void import('@capacitor/keyboard').then(async ({ Keyboard, KeyboardResize }) => {
      const previous = (await Keyboard.getResizeMode()).mode;
      if (cancelled) return;
      await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
      restore = () => Keyboard.setResizeMode({ mode: previous });
      if (cancelled) { await restore(); return; }
      document.body.classList.add('chat-native-keyboard-resize');
      const scrollToBottom = () => {
        if (cancelled || !area.current) return;
        const scroll = () => {
          if (!cancelled && area.current) area.current.scrollTop = area.current.scrollHeight;
        };
        scroll();
        // Native resize and the WebView layout do not always settle in the
        // same frame as keyboardDidShow. Re-run after both layout frames so
        // the newest assistant bubble is not left behind the keyboard.
        if (typeof window !== 'undefined') {
          window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
        }
      };
      const listener = await Keyboard.addListener('keyboardDidShow', scrollToBottom);
      remove = () => listener.remove();
      if (cancelled) await remove();
    }).catch(() => console.warn('Chat keyboard resize unavailable'));
    return () => {
      cancelled = true;
      document.body.classList.remove('chat-native-keyboard-resize');
      void remove?.();
      void restore?.();
    };
  }, [area]);
}
