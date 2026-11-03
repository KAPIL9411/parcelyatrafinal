/**
 * The category strip.
 *
 * Five destinations, one row, always the same order until a campaign changes it. The tile is a soft
 * brand wash rather than a coloured square per category: the icons already differentiate the
 * destinations, and five competing colours is what makes a homepage look like a market stall.
 *
 * The strip is horizontally scrollable but never paginated — a partial fifth tile at the edge is the
 * affordance that tells you it scrolls.
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { HomeItem } from '@py/domain';
import { AppText } from '../../components/ui.tsx';
import { font, radius, spacing } from '../../theme.ts';
import { withAlpha, type HomePalette } from '../theme.ts';

export function CategoryStrip({
  items,
  palette,
  activeId,
  onPress,
}: {
  items: HomeItem[];
  palette: HomePalette;
  activeId?: string | null;
  onPress: (item: HomeItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="list"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityState={{ selected: active }}
            onPress={() => onPress(item)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <View
              style={[
                styles.tile,
                {
                  backgroundColor: active ? palette.brand : withAlpha(palette.brand, 0.08),
                  borderColor: active ? palette.brand : withAlpha(palette.brand, 0.14),
                },
              ]}
            >
              <Ionicons
                name={item.icon ?? 'cube-outline'}
                size={24}
                color={active ? '#ffffff' : palette.brandDark}
              />
              {item.badge ? (
                <View style={[styles.badge, { backgroundColor: palette.accent }]}>
                  <AppText style={[styles.badgeText, { color: palette.navy }]} numberOfLines={1}>
                    {item.badge}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText
              numberOfLines={2}
              style={[styles.label, { color: active ? palette.brandDark : palette.navy }]}
            >
              {item.title}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    paddingBottom: 2,
  },
  item: { width: 74, alignItems: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  tile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    borderRadius: radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: { fontFamily: font.bold, fontSize: 9, lineHeight: 12 },
  label: {
    marginTop: 6,
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
});
