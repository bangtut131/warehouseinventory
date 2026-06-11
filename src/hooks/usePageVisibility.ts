'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook to track page/tab visibility.
 * Returns `isVisible` — false when user switches tab or minimizes browser.
 * Use this to pause polling intervals and reduce VPS load.
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Set initial state
    setIsVisible(document.visibilityState === 'visible');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

/**
 * Hook that runs a callback on an interval, but ONLY when the page is visible.
 * Automatically pauses when tab is in background, resumes when tab is focused.
 * Optionally runs the callback immediately when the page becomes visible again.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true,
  runOnVisible: boolean = true
) {
  const savedCallback = useRef(callback);
  const isVisible = usePageVisibility();

  // Always keep the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !isVisible) return;

    // Run immediately when becoming visible again
    if (runOnVisible) {
      savedCallback.current();
    }

    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, isVisible, runOnVisible]);
}
