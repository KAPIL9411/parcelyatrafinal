/**
 * The Diwali light string on the hero, and the control that changes the theme.
 *
 * This is the app's own take on a festival theme switch: the string is the affordance, so the whole
 * string is the press target rather than a separate switch row. Pressing it turns the campaign theme
 * on or off, and the hero gradient cross-fades underneath (see `HeroSlide`).
 *
 * Motion rules, chosen so the string reads as lights rather than as a loading indicator:
 *
 *  - switching on lights the bulbs left to right, 55 ms apart, each over 220 ms with an ease-out.
 *    The sequence is the acknowledgement; the settled state must be quiet.
 *  - once settled, each bulb breathes between its halo and its glass over 1.5 s in and 1.5 s out,
 *    with a 180 ms phase offset down the string. The offsets are what make it feel hung rather than
 *    blinking in sync.
 *  - switching off fades the whole string out in 180 ms, from the right. Nothing snaps.
 *  - reduced motion gets the two end states and no sequence at all.
 *
 * Everything is opacity and scale on RN's `Animated`, native-driven on device, so the hero scroll
 * and the string never compete on the JS thread.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { withAlpha } from '../theme.ts';

/** Same geometry as the static `lamp` decoration, so the settled frame is unchanged. */
const BULBS = [
  { left: 56, drop: 10, size: 7 },
  { left: 66, drop: 18, size: 6 },
  { left: 76, drop: 26, size: 8 },
  { left: 86, drop: 15, size: 6 },
  { left: 94, drop: 8, size: 5 },
];

const ON_STAGGER_MS = 55;
const ON_DURATION_MS = 220;
const OFF_DURATION_MS = 180;
const BREATH_MS = 1_500;
const BREATH_STAGGER_MS = 180;

function pct(value: number): `${number}%` {
  return `${value}%`;
}

export function Lights({
  accent,
  text,
  on,
  onToggle,
}: {
  accent: string;
  text: string;
  on: boolean;
  onToggle: () => void;
}) {
  // `Animated.Value`s are read during render, so they are state with a lazy initialiser — the same
  // rule the rest of the animation code in this app follows.
  const [levels] = useState(() => BULBS.map(() => new Animated.Value(on ? 1 : 0)));
  const [breath] = useState(() => BULBS.map(() => new Animated.Value(0)));
  const [reduced, setReduced] = useState(false);
  const running = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduced(value);
      })
      .catch(() => {
        // The setting is an enhancement; if it cannot be read, keep the animation.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const native = Platform.OS !== 'web';
    const stopAll = (): void => {
      for (const animation of running.current) animation.stop();
      running.current = [];
    };
    stopAll();

    if (reduced) {
      levels.forEach((value) => value.setValue(on ? 1 : 0));
      breath.forEach((value) => value.setValue(0.5));
      return stopAll;
    }

    if (!on) {
      levels.forEach((value, index) => {
        Animated.timing(value, {
          toValue: 0,
          duration: OFF_DURATION_MS,
          delay: index * 12,
          easing: Easing.in(Easing.quad),
          useNativeDriver: native,
        }).start();
      });
      return stopAll;
    }

    const lightUp = levels.map((value, index) =>
      Animated.sequence([
        Animated.delay(index * ON_STAGGER_MS),
        Animated.timing(value, {
          toValue: 1,
          duration: ON_DURATION_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: native,
        }),
      ]),
    );

    const breathe = breath.map((value, index) =>
      Animated.sequence([
        Animated.delay(index * BREATH_STAGGER_MS),
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: 1,
              duration: BREATH_MS,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: native,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration: BREATH_MS,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: native,
            }),
          ]),
        ),
      ]),
    );

    const all = [...lightUp, ...breathe];
    for (const animation of all) animation.start();
    running.current = all;
    return stopAll;
  }, [breath, levels, on, reduced]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: pct(50),
          right: 0,
          top: pct(20),
          height: 1,
          backgroundColor: withAlpha(text, 0.22),
        }}
      />

      {BULBS.map((bulb, index) => {
        const halo = bulb.size * 3;
        const glass = bulb.size * 1.3;
        const level = levels[index]!;
        const pulse = breath[index]!;

        return (
          <View
            key={index}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: pct(bulb.left),
              top: pct(20) + bulb.drop,
              width: halo,
              height: halo,
              marginLeft: -halo / 2,
            }}
          >
            <Animated.View
              style={{
                position: 'absolute',
                width: halo,
                height: halo,
                borderRadius: halo / 2,
                backgroundColor: withAlpha(accent, 0.16),
                opacity: level,
                transform: [
                  {
                    scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }),
                  },
                ],
              }}
            />
            <Animated.View
              style={{
                position: 'absolute',
                left: (halo - bulb.size) / 2,
                top: (halo - glass) / 2,
                width: bulb.size,
                height: glass,
                borderRadius: bulb.size / 2,
                backgroundColor: index % 2 === 0 ? accent : text,
                opacity: level.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.96] }),
                transform: [
                  {
                    scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }),
                  },
                ],
              }}
            />
          </View>
        );
      })}

      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Diwali lights"
        accessibilityState={{ checked: on }}
        accessibilityHint={on ? 'Turns the festive lights off' : 'Turns the festive lights on'}
        hitSlop={14}
        onPress={onToggle}
        style={{
          position: 'absolute',
          left: pct(48),
          right: 0,
          top: pct(14),
          height: pct(26),
        }}
      />
    </View>
  );
}
