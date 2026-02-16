import { useEffect, useMemo, useState } from 'react';

type Point = { x: number; y: number };

type TargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type UseGestureControlOptions = {
  enabled: boolean;
  snapRadius?: number;
};

type UseGestureControlReturn = {
  cursor: Point;
  targetRect: TargetRect | null;
};

const CLICKABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[role="button"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function distanceToRectCenter(point: Point, rect: DOMRect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.hypot(point.x - centerX, point.y - centerY);
}

export function useGestureControl({ enabled, snapRadius = 100 }: UseGestureControlOptions): UseGestureControlReturn {
  const [cursor, setCursor] = useState<Point>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTargetRect(null);
      return;
    }

    const handleMove = (event: MouseEvent) => {
      // Temporary source for fast prototyping.
      // Replace with MediaPipe fingertip coordinates.
      setCursor({ x: event.clientX, y: event.clientY });
    };

    const handleClick = (event: MouseEvent) => {
      if (!targetRect) return;
      event.preventDefault();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('click', handleClick, true);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('click', handleClick, true);
    };
  }, [enabled, targetRect]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const candidates = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR));
    let nearest: { rect: DOMRect; distance: number } | null = null;

    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const distance = distanceToRectCenter(cursor, rect);
      if (distance > snapRadius) continue;

      if (!nearest || distance < nearest.distance) {
        nearest = { rect, distance };
      }
    }

    if (!nearest) {
      setTargetRect(null);
      return;
    }

    setTargetRect({
      left: nearest.rect.left,
      top: nearest.rect.top,
      width: nearest.rect.width,
      height: nearest.rect.height,
    });
  }, [cursor, enabled, snapRadius]);

  return useMemo(
    () => ({
      cursor,
      targetRect,
    }),
    [cursor, targetRect],
  );
}
