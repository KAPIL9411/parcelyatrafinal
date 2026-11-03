import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The system's Reduce Motion setting, as a boolean.
 *
 * Ambient animation is an enhancement: if the setting cannot be read, motion stays on. Every
 * animated layer in the hero asks this once and paints a settled frame when it is true.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduced(value);
      })
      .catch(() => {
        // Keep the motion.
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      if (!cancelled) setReduced(value);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}
