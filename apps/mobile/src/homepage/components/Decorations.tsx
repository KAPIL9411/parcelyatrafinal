/**
 * Small visual primitives for the hero and promo cards.
 *
 * Gradients are drawn by `expo-linear-gradient`, the same native surface the hero uses. An earlier
 * version stacked a handful of opacity bands to avoid the dependency; on a 152 dp promo card the
 * seams between those bands read as stripes, so the real gradient replaced it.
 *
 * The scrim is a gradient for the same reason: stepped darkness over a photograph looks like a
 * rendering fault, and white type needs an even wash underneath it.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { HomeDecoration } from '@py/domain';

import { withAlpha } from '../theme.ts';

/** A percentage string with the narrow type React Native's style props expect. */
function pct(value: number): `${number}%` {
  return `${value}%`;
}

export function FauxGradient({
  from,
  to,
  style,
  children,
}: {
  from: string;
  to: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <View style={[{ backgroundColor: from, overflow: 'hidden' }, style]}>
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(to, 0), to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

/** A bottom-weighted scrim, smooth enough to sit over a photograph without banding. */
export function Scrim({ strength = 0.62, heightRatio = 0.85 }: { strength?: number; heightRatio?: number }) {
  const from = withAlpha('#081226', strength);
  const to = withAlpha('#081226', 0);
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[from, to]}
      start={{ x: 0.5, y: 1 }}
      end={{ x: 0.5, y: 0 }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: pct(heightRatio * 100),
      }}
    />
  );
}

/**
 * Decorative marks shipped with the app. They sit behind the copy, never over it, and are drawn in
 * the campaign's own accent so a Diwali hero can sparkle without an image at all.
 */
export function Decoration({
  kind,
  accent,
  text,
}: {
  kind: HomeDecoration | undefined;
  accent: string;
  text: string;
}) {
  if (!kind || kind === 'none') return null;

  if (kind === 'route') {
    const dots = [
      { left: 68, top: 16, size: 5, alpha: 0.55 },
      { left: 73, top: 27, size: 4, alpha: 0.45 },
      { left: 79, top: 39, size: 4, alpha: 0.38 },
      { left: 85, top: 51, size: 5, alpha: 0.3 },
      { left: 90, top: 64, size: 4, alpha: 0.22 },
    ];
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View
          style={{
            position: 'absolute',
            right: pct(6),
            top: pct(8),
            width: 74,
            height: 74,
            borderRadius: 37,
            borderWidth: 1,
            borderColor: withAlpha(text, 0.16),
          }}
        />
        <View
          style={{
            position: 'absolute',
            right: pct(13),
            top: pct(15),
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: accent,
            opacity: 0.85,
          }}
        />
        {dots.map((dot, index) => (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: pct(dot.left),
              top: pct(dot.top),
              width: dot.size,
              height: dot.size,
              borderRadius: dot.size / 2,
              backgroundColor: text,
              opacity: dot.alpha,
            }}
          />
        ))}
      </View>
    );
  }

  if (kind === 'sparkle') {
    const marks = [
      { right: 8, top: 14, size: 14, alpha: 0.9 },
      { right: 22, top: 30, size: 8, alpha: 0.6 },
      { right: 14, top: 46, size: 6, alpha: 0.45 },
      { right: 32, top: 12, size: 5, alpha: 0.5 },
    ];
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {marks.map((mark, index) => (
          <View
            key={index}
            style={{
              position: 'absolute',
              right: pct(mark.right),
              top: pct(mark.top),
              width: mark.size,
              height: mark.size,
              backgroundColor: index % 2 === 0 ? accent : text,
              opacity: mark.alpha,
              transform: [{ rotate: '45deg' }],
              borderRadius: 2,
            }}
          />
        ))}
      </View>
    );
  }

  if (kind === 'confetti') {
    const pieces = [
      { left: 62, top: 18, size: 9, colour: accent, rotate: '18deg', alpha: 0.85 },
      { left: 72, top: 32, size: 6, colour: text, rotate: '-24deg', alpha: 0.55 },
      { left: 84, top: 22, size: 7, colour: accent, rotate: '40deg', alpha: 0.6 },
      { left: 88, top: 48, size: 5, colour: text, rotate: '12deg', alpha: 0.4 },
      { left: 66, top: 52, size: 4, colour: accent, rotate: '-8deg', alpha: 0.5 },
    ];
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {pieces.map((piece, index) => (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: pct(piece.left),
              top: pct(piece.top),
              width: piece.size,
              height: piece.size * 1.6,
              borderRadius: 2,
              backgroundColor: piece.colour,
              opacity: piece.alpha,
              transform: [{ rotate: piece.rotate }],
            }}
          />
        ))}
      </View>
    );
  }

  // 'lamp' — a slack string of bulbs across the upper third. Bright enough to read as festive,
  // low enough that the hero copy and the floating header never sit on top of a bulb.
  const bulbs = [
    { left: 56, drop: 10, size: 7 },
    { left: 66, drop: 18, size: 6 },
    { left: 76, drop: 26, size: 8 },
    { left: 86, drop: 15, size: 6 },
    { left: 94, drop: 8, size: 5 },
  ];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          left: pct(50),
          right: 0,
          top: pct(20),
          height: 1,
          backgroundColor: withAlpha(text, 0.22),
        }}
      />
      {bulbs.map((bulb, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            left: pct(bulb.left),
            top: pct(20) + bulb.drop,
            width: bulb.size * 3,
            height: bulb.size * 3,
            marginLeft: -(bulb.size * 1.5),
            borderRadius: bulb.size * 1.5,
            backgroundColor: withAlpha(accent, 0.16),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: bulb.size,
              height: bulb.size * 1.3,
              borderRadius: bulb.size / 2,
              backgroundColor: index % 2 === 0 ? accent : text,
              opacity: 0.92,
            }}
          />
        </View>
      ))}
    </View>
  );
}
