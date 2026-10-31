/**
 * The primary action: a pickup-to-destination card that overlaps the hero.
 *
 * It is intentionally two fields rather than a single "Search" pill. The sender's first decision is
 * "from here to where", and asking for it on the homepage removes a screen from the booking flow.
 * Both fields open the serviceable-city picker; the arrow only navigates once the pair is real.
 *
 * The button is the one loud element inside the card: a gold coin-size target with the campaign's own
 * accent, so the eye lands on "go" before it reads the two fields. Everything else is quiet.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppText } from '../../components/ui.tsx';
import { font, radius, shadow, spacing } from '../../theme.ts';
import { mixHex, withAlpha, type HomePalette } from '../theme.ts';

export function SearchCard({
  palette,
  originName,
  destName,
  onPressOrigin,
  onPressDest,
  onSwap,
  onSubmit,
}: {
  palette: HomePalette;
  originName: string | null;
  destName: string | null;
  onPressOrigin: () => void;
  onPressDest: () => void;
  onSwap: () => void;
  onSubmit: () => void;
}) {
  const ready = Boolean(originName && destName);
  const submitLabel = !originName
    ? 'Choose your pickup city'
    : !destName
      ? 'Choose where the parcel is going'
      : `Search travellers from ${originName} to ${destName}`;

  return (
    <View
      style={[
        styles.card,
        shadow.floating,
        { backgroundColor: palette.surface, borderColor: withAlpha(palette.navy, 0.06) },
      ]}
    >
      <View style={styles.routeMark} pointerEvents="none">
        <View style={[styles.originDot, { borderColor: palette.brand }]} />
        <View style={[styles.routeLine, { backgroundColor: withAlpha(palette.navy, 0.18) }]} />
        <View style={[styles.destDot, { backgroundColor: palette.accent }]} />
      </View>

      <View style={styles.fields}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={originName ? `From ${originName}. Change pickup city` : 'Choose pickup city'}
          onPress={onPressOrigin}
          style={({ pressed }) => [styles.field, pressed && styles.pressedField]}
        >
          <AppText style={[styles.label, { color: withAlpha(palette.navy, 0.46) }]}>FROM</AppText>
          <AppText
            style={[styles.value, { color: originName ? palette.navy : withAlpha(palette.navy, 0.36) }]}
            numberOfLines={1}
          >
            {originName ?? 'Pickup city'}
          </AppText>
        </Pressable>

        <View style={[styles.divider, { backgroundColor: withAlpha(palette.navy, 0.08) }]} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={destName ? `To ${destName}. Change destination` : 'Choose destination city'}
          onPress={onPressDest}
          style={({ pressed }) => [styles.field, pressed && styles.pressedField]}
        >
          <AppText style={[styles.label, { color: withAlpha(palette.navy, 0.46) }]}>TO</AppText>
          <AppText
            style={[styles.value, { color: destName ? palette.navy : withAlpha(palette.navy, 0.36) }]}
            numberOfLines={1}
          >
            {destName ?? 'Where to?'}
          </AppText>
        </Pressable>
      </View>

      <View style={styles.actions}>
        {ready ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Swap pickup and destination"
            onPress={onSwap}
            hitSlop={4}
            style={({ pressed }) => [styles.swap, pressed && styles.pressed]}
          >
            <Ionicons name="swap-vertical" size={17} color={withAlpha(palette.navy, 0.62)} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          onPress={onSubmit}
          style={({ pressed }) => [styles.submit, shadow.soft, pressed && styles.pressed]}
        >
          <LinearGradient
            colors={[mixHex(palette.badgeBackground, '#ffffff', 0.16), palette.badgeBackground]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name="arrow-forward" size={21} color={palette.badgeText} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: spacing.sm + 3,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.sm + 1,
  },
  routeMark: { width: 14, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center', gap: 3 },
  originDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, backgroundColor: 'transparent' },
  routeLine: { width: 1.5, flex: 1, maxHeight: 18 },
  destDot: { width: 9, height: 9, borderRadius: 2.5 },
  fields: { flex: 1 },
  field: { minHeight: 42, justifyContent: 'center' },
  label: { fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2 },
  value: { fontFamily: font.semibold, fontSize: 16, lineHeight: 21, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  swap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  pressedField: { opacity: 0.7 },
});
