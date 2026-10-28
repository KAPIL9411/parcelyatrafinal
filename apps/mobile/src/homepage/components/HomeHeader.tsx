/**
 * The compact utility row.
 *
 * Two variants, same controls: a solid bar for ordinary screens, and a transparent overlay that
 * floats on the campaign hero. The overlay deliberately drops the wordmark — at 360 dp the mark,
 * city chip, inbox, bell and avatar already fill the row, and a squeezed wordmark reads as clutter.
 * A header is chrome; the hero is the brand statement.
 */
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../../components/ui.tsx';
import { font, radius, spacing } from '../../theme.ts';
import { withAlpha, type HomePalette } from '../theme.ts';

export function HomeHeader({
  palette,
  variant = 'solid',
  originName,
  onPressOrigin,
  unreadNotifications,
  unreadMessages,
  onPressNotifications,
  onPressInbox,
  userName,
  onPressProfile,
}: {
  palette: HomePalette;
  variant?: 'solid' | 'overlay';
  originName: string | null;
  onPressOrigin: () => void;
  unreadNotifications: number;
  unreadMessages: number;
  onPressNotifications: () => void;
  onPressInbox: () => void;
  userName?: string | null;
  onPressProfile?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const overlay = variant === 'overlay';
  const showWordmark = !overlay && width >= 344;
  const ink = overlay ? '#ffffff' : palette.navy;
  const initial = userName?.trim().charAt(0).toUpperCase() ?? null;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top + (overlay ? 6 : spacing.sm),
          backgroundColor: overlay ? 'transparent' : palette.surface,
        },
      ]}
    >
      <View style={styles.brand}>
        <View
          style={[
            styles.mark,
            { backgroundColor: overlay ? '#ffffff' : palette.brand },
          ]}
        >
          <AppText style={[styles.markLetter, { color: overlay ? palette.navy : '#ffffff' }]}>
            P
          </AppText>
          <View
            style={[
              styles.markDot,
              { backgroundColor: palette.accent, borderColor: overlay ? '#ffffff' : palette.surface },
            ]}
          />
        </View>
        {showWordmark ? (
          <AppText style={[styles.wordmark, { color: palette.navy }]} numberOfLines={1}>
            Parcel Yatra
          </AppText>
        ) : null}
      </View>

      <View style={styles.utilities}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            originName ? `Pickup city: ${originName}. Change city` : 'Choose your pickup city'
          }
          onPress={onPressOrigin}
          style={({ pressed }) => [
            styles.location,
            { backgroundColor: overlay ? 'rgba(255,255,255,0.16)' : palette.brandSoft },
            pressed && { opacity: 0.75 },
          ]}
        >
          <Ionicons
            name="location-outline"
            size={13}
            color={overlay ? '#ffffff' : palette.brandDark}
          />
          <AppText numberOfLines={1} style={[styles.locationText, { color: ink }]}>
            {originName ?? 'Pickup city'}
          </AppText>
          <Ionicons name="chevron-down" size={12} color={withAlpha(ink, 0.6)} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unreadMessages ? `${unreadMessages} unread messages` : 'Inbox'}
          onPress={onPressInbox}
          hitSlop={6}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={21} color={ink} />
          {unreadMessages > 0 ? (
            <View style={[styles.dot, { backgroundColor: overlay ? palette.accent : palette.brand }]} />
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unreadNotifications ? `${unreadNotifications} unread notifications` : 'Notifications'
          }
          onPress={onPressNotifications}
          hitSlop={6}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
        >
          <Ionicons
            name={unreadNotifications ? 'notifications' : 'notifications-outline'}
            size={21}
            color={ink}
          />
          {unreadNotifications > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: overlay ? palette.accent : palette.brand },
              ]}
            >
              <AppText
                style={[styles.badgeText, { color: overlay ? palette.navy : '#ffffff' }]}
              >
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </AppText>
            </View>
          ) : null}
        </Pressable>

        {onPressProfile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={userName ? `Profile, ${userName}` : 'Profile'}
            onPress={onPressProfile}
            hitSlop={6}
            style={({ pressed }) => [
              styles.avatar,
              {
                backgroundColor: overlay ? 'rgba(255,255,255,0.2)' : palette.brandSoft,
                borderColor: overlay ? 'rgba(255,255,255,0.42)' : withAlpha(palette.brand, 0.2),
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            {initial ? (
              <AppText style={[styles.avatarText, { color: overlay ? '#ffffff' : palette.brandDark }]}>
                {initial}
              </AppText>
            ) : (
              <Ionicons name="person-outline" size={17} color={ink} />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  mark: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markLetter: { fontFamily: font.bold, fontSize: 16, lineHeight: 19 },
  markDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
  },
  wordmark: {
    fontFamily: font.bold,
    fontSize: 16,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  utilities: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    height: 32,
    maxWidth: 112,
  },
  locationText: { fontFamily: font.semibold, fontSize: 12, flexShrink: 1 },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.bold, fontSize: 9, lineHeight: 11 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  avatarText: { fontFamily: font.bold, fontSize: 14 },
});
