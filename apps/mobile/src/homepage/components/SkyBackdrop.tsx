/**
 * The sky behind the home hero: what sits where the wordmark and then the weather tile used to.
 *
 * One instance is drawn over the whole hero (not per slide, and not as a sticker in the header), so
 * the light is part of the page rather than an element sitting on it. The disc is anchored to the
 * top-left corner and is wider than its offset, so the screen edge clips it: the sun or moon looks
 * like it is rising from behind the corner of the app.
 *
 * What it draws, from the back:
 *
 *  - an ambient wash over the campaign gradient — warm at dawn and sunset, cool and deep at night;
 *    it tints the admin's gradient instead of replacing it, so every campaign keeps its identity;
 *  - soft light shafts fanning away from the disc into the empty right side of the hero;
 *  - the disc itself: a graded sun with a broad soft bloom, or a crescent moon with earthshine and a
 *    cool halo;
 *  - a twinkling star field by night.
 *
 * Motion: the disc shimmers on 6.4 s, the shafts drift ±2° on 34 s and breathe on 9 s, stars twinkle
 * out of phase on 2–4 s. Everything is opacity and transform on RN's `Animated`, native-driven on
 * device, so the page scroll stays on the UI thread. With reduced motion the settled frame is painted
 * and nothing runs.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { withAlpha } from '../theme.ts';
import { skyScene, timeOfDay, type SkyScene as Sky } from '../time-of-day.ts';

interface LoopOptions {
  from: number;
  to: number;
  duration: number;
  delay?: number;
  enabled: boolean;
}

function useLoop({ from, to, duration, delay = 0, enabled }: LoopOptions): Animated.Value {
  const [value] = useState(() => new Animated.Value(from));

  useEffect(() => {
    if (!enabled) {
      value.setValue(from);
      return;
    }
    const step = (target: number): Animated.CompositeAnimation =>
      Animated.timing(value, {
        toValue: target,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: Platform.OS !== 'web',
      });
    const animation = Animated.loop(Animated.sequence([step(to), step(from)]));
    const timer = delay > 0 ? setTimeout(() => animation.start(), delay) : null;
    if (!timer) animation.start();
    return () => {
      if (timer) clearTimeout(timer);
      animation.stop();
    };
  }, [value, from, to, duration, delay, enabled]);

  return value;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduced(value);
      })
      .catch(() => {
        // The setting is an enhancement; if it cannot be read, keep the motion.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return reduced;
}

/**
 * The broad glow, drawn as one gradient field rather than a stack of circles.
 *
 * A stack of translucent discs can be solved to any falloff, but every disc rim is an edge in the
 * composite, and with fifty-odd shells those edges read as concentric rings. A single gradient over
 * the whole hero has no interior edges: its iso-lines are parallel bands running diagonally into the
 * page, which is the shape light takes anyway when it comes from a corner. The stops follow an
 * exponential falloff, so the corner is hot and the far half of the hero is untouched.
 *
 * The hue is the scene's own light — the warm tint of the campaign at any hour, pale blue for the
 * moon — lifted toward white so it reads as light falling on the page rather than as a coloured film.
 */
const GLOW_STOPS = [0, 0.074, 0.148, 0.221, 0.295, 0.406, 0.554, 0.74, 0.87, 1] as const;
const GLOW_ALPHAS = [1, 0.567, 0.322, 0.178, 0.1, 0.044, 0.014, 0.004, 0.001, 0] as const;

function liftedChannels(hex: string, lift: number): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const base = (value >> shift) & 0xff;
    return Math.round(base + (255 - base) * lift);
  };
  return [channel(16), channel(8), channel(0)];
}

function GlowField({ body, tint }: { body: 'sun' | 'moon'; tint: string }) {
  const sun = body === 'sun';
  const [r, g, b] = liftedChannels(sun ? tint : '#dbe7ff', sun ? 0.72 : 0.45);
  const peak = sun ? 0.9 : 0.47;
  const colors = GLOW_ALPHAS.map((alpha) => `rgba(${r},${g},${b},${(alpha * peak).toFixed(3)})`);

  return (
    <LinearGradient
      colors={colors as unknown as [string, string, ...string[]]}
      locations={GLOW_STOPS}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.62, y: 0.55 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

const SUN_STOPS = ['#ffffff', '#fff8e6', '#ffe9b0', '#ffd98a'] as const;
const MOON_STOPS = ['#ffffff', '#eaf1fc', '#c8d3e9'] as const;

function Sun({ size, reduced }: { size: number; reduced: boolean }) {
  const shimmer = useLoop({ from: 0, to: 1, duration: 6_400, enabled: !reduced });
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });

  return (
    <Animated.View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          borderRadius: size / 2,
          opacity,
        },
      ]}
    >
      <LinearGradient
        colors={SUN_STOPS as unknown as [string, string, ...string[]]}
        start={{ x: 0.15, y: 0.1 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function Moon({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: size / 2 },
      ]}
    >
      <LinearGradient
        colors={MOON_STOPS as unknown as [string, string, ...string[]]}
        start={{ x: 0.2, y: 0.12 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Earthshine: the unlit limb is not cut away, it stays part of the disc, dimmed — which is
          what a crescent actually looks like, and stops the shadow reading as a hole in the sky. */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.36,
          top: -size * 0.14,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(22,32,84,0.72)',
        }}
      />
    </View>
  );
}

const RAY_STEPS = [
  { width: 7, alpha: 0.13 },
  { width: 2.5, alpha: 0.09 },
  { width: 4, alpha: 0.06 },
  { width: 3, alpha: 0.11 },
] as const;

function Rays({ count, width, reduced }: { count: number; width: number; reduced: boolean }) {
  const breathe = useLoop({ from: 0, to: 1, duration: 9_000, enabled: !reduced });
  const swing = useLoop({ from: 0, to: 1, duration: 34_000, enabled: !reduced });
  const opacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const rotate = swing.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] });

  return (
    <Animated.View style={[styles.anchor, { opacity, transform: [{ rotate }] }]}>
      {Array.from({ length: count }, (_, index) => {
        const step = RAY_STEPS[index % RAY_STEPS.length]!;
        const angle = 8 + (index * 76) / Math.max(count - 1, 1);
        const length = (0.5 + (index % 3) * 0.22) * width;
        return (
          <View key={index} style={[styles.anchor, { transform: [{ rotate: `${angle}deg` }] }]}>
            <LinearGradient
              colors={[`rgba(255,244,214,${step.alpha})`, 'rgba(255,240,200,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                width: length,
                height: step.width,
                marginTop: -step.width / 2,
                borderRadius: step.width / 2,
              }}
            />
          </View>
        );
      })}
    </Animated.View>
  );
}

const STARS = [
  { x: 0.3, y: 0.1, size: 2.4 },
  { x: 0.38, y: 0.22, size: 1.6 },
  { x: 0.52, y: 0.08, size: 2 },
  { x: 0.62, y: 0.18, size: 1.5 },
  { x: 0.72, y: 0.3, size: 2.2 },
  { x: 0.82, y: 0.12, size: 1.7 },
  { x: 0.9, y: 0.42, size: 2 },
  { x: 0.46, y: 0.36, size: 1.5 },
  { x: 0.28, y: 0.44, size: 1.8 },
  { x: 0.58, y: 0.47, size: 2.1 },
  { x: 0.94, y: 0.2, size: 1.6 },
] as const;

function Star({
  x,
  y,
  size,
  index,
  reduced,
}: {
  x: number;
  y: number;
  size: number;
  index: number;
  reduced: boolean;
}) {
  const twinkle = useLoop({
    from: 0,
    to: 1,
    duration: 1_800 + (index % 4) * 520,
    delay: index * 260,
    enabled: !reduced,
  });
  const opacity = twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <Animated.View
      style={[
        styles.star,
        {
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
        },
      ]}
    />
  );
}

export function SkyBackdrop({
  now,
  width,
  topInset,
  height,
}: {
  now: Date;
  width: number;
  topInset: number;
  height: number;
}) {
  const scene: Sky = skyScene(timeOfDay(now));
  const reduced = useReducedMotion();

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width, height }}>
      <LinearGradient
        colors={[
          withAlpha(scene.tint[0], scene.tintOpacity),
          withAlpha(scene.tint[1], scene.tintOpacity * 0.55),
          withAlpha(scene.tint[0], 0),
        ]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <GlowField body={scene.body} tint={scene.tint[0]} />

      {Array.from({ length: scene.stars }, (_, index) => {
        const star = STARS[index]!;
        return <Star key={index} {...star} index={index} reduced={reduced} />;
      })}

      {scene.rays > 0 ? (
        <View style={[styles.anchor, { left: scene.x, top: topInset + scene.y }]}>
          <Rays count={scene.rays} width={width} reduced={reduced} />
        </View>
      ) : null}

      <View style={[styles.anchor, { left: scene.x, top: topInset + scene.y }]}>
        {scene.body === 'sun' ? (
          <Sun size={scene.core} reduced={reduced} />
        ) : (
          <Moon size={scene.core} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** A zero-size point: children hang off it with negative margins, so it can be rotated in place. */
  anchor: { position: 'absolute', width: 0, height: 0 },
  disc: { position: 'absolute', overflow: 'hidden' },
  star: { position: 'absolute', backgroundColor: '#ffffff' },
});
