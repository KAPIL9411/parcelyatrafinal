import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { RoutePreview } from '../api/types.ts';
import { AppText } from './ui.tsx';
import { useReducedMotion } from '../homepage/use-reduced-motion.ts';
import { routeMapHtml } from './route-map-html.ts';
import { MapFrame, type MapFrameHandle } from './MapFrame';
import { colors, font, radius, spacing } from '../theme.ts';

const HTML = routeMapHtml();

export interface RouteMapCardProps {
  /** The routed shape, or the previous one while a new pair is still in flight. */
  route: RoutePreview | null;
  fetching: boolean;
  /** Server message when the route could not be drawn. Never paired with a line. */
  error: string | null;
  onRetry: () => void;
  originLabel: string;
  destLabel: string;
  /** True once both cities are chosen; before that the map shows the country and a hint. */
  ready: boolean;
  height?: number;
}

/**
 * The route the traveller would actually drive, drawn on a real map.
 *
 * Pan and pinch go to the map; everything that reads as Parcel Yatra — the labels, the pills, the
 * loading and failure states — is React Native on top of it, so the card belongs to the form rather
 * than looking like an embedded web page.
 */
export function RouteMapCard({
  route,
  fetching,
  error,
  onRetry,
  originLabel,
  destLabel,
  ready,
  height = 208,
}: RouteMapCardProps) {
  const frame = useRef<MapFrameHandle>(null);
  const mounted = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!mapReady) return;
    const handle = frame.current;
    if (!handle) return;

    if (!route) {
      // Only clear what was drawn once, so the first paint of an empty map stays put.
      if (mounted.current) handle.run('window.__pyReset()');
      return;
    }
    mounted.current = true;
    handle.run(
      `window.__pyRoute(${JSON.stringify({
        points: route.polyline,
        animate: !reduceMotion,
      })})`,
    );
  }, [mapReady, route, reduceMotion]);

  const showSkeleton = !route && fetching;
  const showFailure = !route && !fetching && Boolean(error);

  return (
    <View
      style={[styles.card, { height }]}
      accessibilityRole="image"
      accessibilityLabel={
        route
          ? `Road route from ${originLabel} to ${destLabel}, about ${Math.round(route.distance_km)} kilometres`
          : 'Route map'
      }
    >
      <MapFrame ref={frame} html={HTML} height={height} onReady={() => setMapReady(true)} />

      <View pointerEvents="none" style={styles.overlay}>
        <View style={styles.topRow}>
          <View style={styles.pill}>
            <Ionicons name="navigate" size={11} color={colors.brand} />
            <AppText variant="micro" tone="brand">
              Intercity · Car
            </AppText>
          </View>
          {route ? (
            <View style={styles.pill}>
              <Ionicons name="time-outline" size={11} color={colors.ink500} />
              <AppText variant="micro" tone="muted">
                {Math.round(route.distance_km)} km · {formatDuration(route.duration_minutes)}
              </AppText>
            </View>
          ) : null}
        </View>

        {ready ? (
          <View style={styles.bottomRow}>
            <View style={[styles.place, { flex: 1 }]}>
              <View style={[styles.placeDot, { backgroundColor: colors.brand }]} />
              <AppText variant="micro" numberOfLines={1} style={{ flexShrink: 1 }}>
                {originLabel}
              </AppText>
            </View>
            <View style={styles.place}>
              <Ionicons name="flag" size={10} color={colors.navy} />
              <AppText variant="micro" numberOfLines={1} style={{ maxWidth: 120 }}>
                {destLabel}
              </AppText>
            </View>
          </View>
        ) : null}
      </View>

      {showSkeleton ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.brand} />
          <AppText variant="small" tone="muted" style={{ marginTop: 6 }}>
            Finding the road…
          </AppText>
        </View>
      ) : null}

      {showFailure ? (
        <View style={styles.state}>
          <AppText variant="small" style={{ textAlign: 'center' }} numberOfLines={2}>
            {error ?? 'The road between these cities could not be drawn.'}
          </AppText>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
            <Ionicons name="refresh" size={12} color={colors.white} />
            <AppText variant="micro" style={{ color: colors.white, fontFamily: font.semibold }}>
              Try again
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {!ready && !fetching && !error ? (
        <View style={[styles.state, { backgroundColor: 'rgba(255,255,255,0.72)' }]}>
          <AppText variant="small" tone="muted" style={{ textAlign: 'center' }} numberOfLines={2}>
            Choose a pickup city and a drop city to see the road between them.
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

const shadow = {
  shadowColor: '#061a7a',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 6,
  elevation: 3,
};

const fill: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: '#eaeef5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  overlay: {
    ...fill,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    ...shadow,
  },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    maxWidth: 170,
    ...shadow,
  },
  placeDot: { width: 8, height: 8, borderRadius: 4 },
  state: {
    ...fill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  retry: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
