/**
 * The 2-up category grid.
 *
 * Cream cards, copy top-left, artwork bleeding off the bottom-right corner. The art is the item's
 * icon at low contrast unless an editor uploaded a transparent illustration, which is drawn at full
 * strength. The grid is data-driven: the server decides which categories exist, in what order, and
 * which one is pre-selected in the send flow.
 */
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { HomeItem } from '@py/domain';
import { AppText } from '../../components/ui.tsx';
import { font, radius, shadow, spacing } from '../../theme.ts';
import { mixHex, readableOn, withAlpha, type HomePalette } from '../theme.ts';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

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
  const cardWidth = Math.floor((width - spacing.lg * 2 - spacing.sm) / 2);
  if (items.length === 0) return null;

  const cream = mixHex(palette.surface, palette.accent, 0.12);

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
            {item.badge ? (
              <View style={[styles.badge, { backgroundColor: palette.badgeBackground }]}>
                <AppText style={[styles.badgeText, { color: palette.badgeText }]} numberOfLines={1}>
                  {item.badge}
                </AppText>
              </View>
            ) : null}

            <AppText
              style={[styles.title, { color: readableOn(undefined, cream, palette.navy) }]}
              numberOfLines={2}
            >
              {item.title}
            </AppText>

            <View pointerEvents="none" style={styles.art}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="contain" />
              ) : (
                <>
                  <View style={[styles.blob, { backgroundColor: withAlpha(palette.accent, 0.35) }]} />
                  <Ionicons
                    name={(item.icon ?? 'cube-outline') as IconName}
                    size={52}
                    color={withAlpha(palette.navy, 0.24)}
                  />
                </>
              )}
            </View>
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
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  card: {
    height: 104,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: 2,
    maxWidth: '80%',
  },
  badgeText: { fontFamily: font.bold, fontSize: 8.5, letterSpacing: 0.5 },
  title: { fontFamily: font.semibold, fontSize: 14.5, lineHeight: 19, maxWidth: '76%' },
  art: {
    position: 'absolute',
    right: -4,
    bottom: -6,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  blob: { position: 'absolute', right: -12, bottom: -14, width: 74, height: 74, borderRadius: 37 },
  image: { width: 74, height: 74 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
});
