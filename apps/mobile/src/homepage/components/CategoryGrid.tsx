/**
 * The category grid.
 *
 * Three compact tiles per row instead of two tall ones. The earlier 2-up cards were 104 dp tall and
 * mostly empty, so six categories filled more than a screen of scrolling before a sender reached the
 * rest of the page — the opposite of the two-tap feel the rest of the flow aims for. A tile now reads
 * icon first, label second, and the whole set fits in two rows.
 *
 * The grid is data-driven: the server decides which categories exist, in what order, and which one is
 * pre-selected in the send flow.
 */
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { HomeItem } from '@py/domain';
import { AppText } from '../../components/ui.tsx';
import { font, radius, shadow, spacing } from '../../theme.ts';
import { mixHex, readableOn, withAlpha, type HomePalette } from '../theme.ts';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const COLUMNS = 3;
const GAP = spacing.sm;

export function CategoryGrid({
  items,
  palette,
  onPress,
  activeId,
}: {
  items: HomeItem[];
  palette: HomePalette;
  onPress: (item: HomeItem) => void;
  activeId?: string | null;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - spacing.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  if (items.length === 0) return null;

  const cream = mixHex(palette.surface, palette.accent, 0.12);
  const ink = readableOn(undefined, cream, palette.navy);

  return (
    <View style={styles.grid}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.badge ? `${item.title}, ${item.badge}` : item.title}
            onPress={() => onPress(item)}
            style={({ pressed }) => [
              styles.card,
              shadow.soft,
              {
                width: cardWidth,
                backgroundColor: cream,
                borderColor: active ? palette.brand : withAlpha(palette.navy, 0.05),
              },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.iconBubble, { backgroundColor: withAlpha(palette.accent, 0.4) }]}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="contain" />
              ) : (
                <Ionicons
                  name={(item.icon ?? 'cube-outline') as IconName}
                  size={22}
                  color={withAlpha(palette.navy, 0.72)}
                />
              )}
            </View>

            <AppText style={[styles.title, { color: ink }]} numberOfLines={2}>
              {item.title}
            </AppText>

            {item.badge ? (
              <View style={[styles.badge, { backgroundColor: palette.badgeBackground }]}>
                <AppText style={[styles.badgeText, { color: palette.badgeText }]} numberOfLines={1}>
                  {item.badge}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: spacing.lg,
  },
  card: {
    minHeight: 92,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: 26, height: 26 },
  title: {
    fontFamily: font.semibold,
    fontSize: 12,
    lineHeight: 15,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    maxWidth: '80%',
  },
  badgeText: { fontFamily: font.bold, fontSize: 8, letterSpacing: 0.4 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
});
