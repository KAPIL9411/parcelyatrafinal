/**
 * The campaign hero, drawn edge to edge under the status bar.
 *
 * The composition is the page's loudest surface, so the rules are strict:
 *
 *  - the background is a real multi-stop gradient (`expo-linear-gradient`) or artwork behind a scrim,
 *    never a flat block;
 *  - the header floats over it, which is why a soft top scrim is always drawn — white controls must
 *    stay legible on a pale campaign image as well as on deep blue;
 *  - the copy is bottom-anchored and reserves room for the search card that overlaps the seam, so a
 *    long subtitle can never push the copy under it;
 *  - the height derives from the screen width, clamping at 320–460 dp, so 360 px and 430 px phones
 *    both get a composed hero rather than a crop.
 */
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { HomeHero } from '@py/domain';
import { AppText } from '../../components/ui.tsx';
import { font, radius, spacing } from '../../theme.ts';
import { Decoration, Scrim } from './Decorations.tsx';
import { withAlpha, type HomePalette } from '../theme.ts';

const ROTATE_MS = 6_500;

/** Room left at the bottom of every slide for the search card that overlaps the hero. */
export const HERO_SEAM = 40;

/**
 * How far the copy sits above the hero's bottom edge. Scrolling the copy up past the overlap keeps
 * a clear band of blue between the trust badges and the card instead of letting them touch.
 */
export const HERO_COPY_CLEARANCE = HERO_SEAM + spacing.lg;

/** The hero height agrees with the list offset used to switch the sticky header, so share it. */
export function heroHeight(width: number, topInset: number): number {
  return Math.round(Math.min(460, Math.max(320, width * 0.98))) + topInset;
}

function useCountdown(target: string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  const active = Boolean(target) && !Number.isNaN(new Date(target ?? 0).getTime());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  if (!target) return null;
  const end = new Date(target).getTime();
  if (Number.isNaN(end)) return null;
  const remaining = end - now;
  if (remaining <= 0) return null;

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number): string => String(value).padStart(2, '0');

  return days > 0 ? `${days}d ${two(hours)}:${two(minutes)}` : `${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

export function HeroCarousel({
  heroes,
  palette,
  width,
  topInset,
  greeting,
}: {
  heroes: HomeHero[];
  palette: HomePalette;
  width: number;
  topInset: number;
  greeting: string;
}) {
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const height = heroHeight(width, topInset);

  useEffect(() => {
    if (index < heroes.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIndex(0);
    scroller.current?.scrollTo({ x: 0, animated: false });
  }, [heroes.length, index]);

  useEffect(() => {
    if (heroes.length < 2 || dragging) return;
    const timer = setInterval(() => {
      const next = (index + 1) % heroes.length;
      scroller.current?.scrollTo({ x: next * width, animated: true });
      setIndex(next);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [heroes.length, index, dragging, width]);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
    setIndex(Math.max(0, Math.min(heroes.length - 1, next)));
  };

  if (heroes.length === 0) return null;

  return (
    <View style={{ height }}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => setDragging(true)}
        onScrollEndDrag={() => setDragging(false)}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
      >
        {heroes.map((hero) => (
          <HeroSlide
            key={hero.id}
            hero={hero}
            palette={palette}
            width={width}
            height={height}
            topInset={topInset}
            greeting={greeting}
          />
        ))}
      </ScrollView>

      {heroes.length > 1 ? (
        <View style={styles.pagination} pointerEvents="none">
          {heroes.map((hero, dot) => (
            <View
              key={hero.id}
              style={[
                styles.paginationDot,
                dot === index
                  ? { width: 20, backgroundColor: '#ffffff' }
                  : { backgroundColor: 'rgba(255,255,255,0.4)' },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HeroSlide({
  hero,
  palette,
  width,
  height,
  topInset,
  greeting,
}: {
  hero: HomeHero;
  palette: HomePalette;
  width: number;
  height: number;
  topInset: number;
  greeting: string;
}) {
  const countdown = useCountdown(hero.countdown_to);
  const hasImage = Boolean(hero.image_url);
  const text = hasImage ? '#ffffff' : (hero.text_color ?? palette.heroText);
  const muted = hasImage ? 'rgba(255,255,255,0.84)' : palette.heroMuted;
  const gradient = hero.gradient ?? palette.heroGradient;

  return (
    <View style={{ width, height }}>
      {hero.image_url ? (
        <>
          <Image source={{ uri: hero.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <LinearGradient
            colors={['rgba(11,18,38,0.72)', 'rgba(11,18,38,0.18)', 'rgba(8,18,38,0.86)']}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        <LinearGradient
          colors={gradient as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Decoration kind={hasImage ? 'none' : palette.decoration} accent={palette.accent} text={text} />

      {/* The header floats above this slide; without the wash its white controls disappear on pale art. */}
      <LinearGradient
        colors={['rgba(6,12,32,0.5)', 'rgba(6,12,32,0)']}
        style={[styles.topScrim, { height: topInset + 76 }]}
        pointerEvents="none"
      />

      <View style={[styles.copy, { paddingBottom: HERO_COPY_CLEARANCE }]}>
        <View style={styles.eyebrowRow}>
          <AppText style={[styles.greeting, { color: text }]} numberOfLines={1}>
            {greeting}
          </AppText>
          {countdown ? (
            <View style={styles.countdown}>
              <Ionicons name="time-outline" size={12} color={text} />
              <AppText style={[styles.countdownText, { color: text }]}>{countdown}</AppText>
            </View>
          ) : null}
        </View>

        <AppText style={[styles.headline, { color: text }]} numberOfLines={3}>
          {hero.headline}
        </AppText>
        {hero.subtitle ? (
          <AppText style={[styles.subtitle, { color: muted }]} numberOfLines={2}>
            {hero.subtitle}
          </AppText>
        ) : null}

        {hero.trust_badges?.length ? (
          <View style={styles.badges}>
            {hero.trust_badges.map((badge) => (
              <View key={badge} style={styles.badge}>
                <Ionicons name="shield-checkmark" size={11} color={palette.accent} />
                <AppText style={[styles.badgeText, { color: text }]} numberOfLines={1}>
                  {badge}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  copy: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: 0,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  greeting: {
    flexShrink: 1,
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  countdownText: { fontFamily: font.semibold, fontSize: 11 },
  headline: {
    fontFamily: font.bold,
    fontSize: 30,
    lineHeight: 35,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 6,
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: { fontFamily: font.semibold, fontSize: 10.5 },
  pagination: {
    position: 'absolute',
    bottom: HERO_COPY_CLEARANCE + 10,
    right: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  paginationDot: { height: 6, width: 6, borderRadius: 3 },
});
