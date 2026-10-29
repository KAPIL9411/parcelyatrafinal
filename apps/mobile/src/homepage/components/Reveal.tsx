/**
 * A section that fades and lifts into place once, on mount.
 *
 * This is the smallest possible entrance animation: a single opacity and translate driven by RN's
 * `Animated`, no layout work and no new dependency. It honours the OS reduced-motion setting, and on
 * web it runs on the JS driver because native-driven opacity is not available there.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export function Reveal({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // `Animated.Value` is state, not a ref: it is read during render (opacity, transform) and the React
  // compiler's ref rules correctly refuse that. A lazy state initialiser gives one stable instance.
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let cancelled = false;

    const show = (): void => {
      Animated.timing(progress, {
        toValue: 1,
        duration: 340,
        delay: Math.min(delay, 320),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    };

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) progress.setValue(1);
        else show();
      })
      .catch(() => {
        if (!cancelled) progress.setValue(1);
      });

    return () => {
      cancelled = true;
      progress.stopAnimation();
    };
  }, [delay, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
