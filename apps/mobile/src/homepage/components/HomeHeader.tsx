/**
 * The compact utility row that floats on the campaign hero.
 *
 * It carries the pickup city, inbox, bell and avatar — no wordmark and no badge: the sky behind the
 * hero is the only mark at the top-left, and a squeezed logo beside four controls reads as clutter.
 * The row belongs to the hero and leaves with it; past the fold there is no header at all.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../../components/ui.tsx';
import { font, radius, spacing } from '../../theme.ts';
import { withAlpha, type HomePalette } from '../theme.ts';

export function HomeHeader({
  palette,
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
  const ink = '#ffffff';
  const initial = userName?.trim().charAt(0).toUpperCase() ?? null;

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top + 6, backgroundColor: 'transparent' },
      ]}
    >
      <View style={styles.utilities}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            originName ? `Pickup city: ${originName}. Change city` : 'Choose your pickup city'
          }
          onPress={onPressOrigin}
          style={({ pressed }) => [
            styles.location,
            { backgroundColor: 'rgba(255,255,255,0.16)' },
            pressed && { opacity: 0.75 },
          ]}
        >
          <Ionicons name="location-outline" size={13} color="#ffffff" />
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
            <View style={[styles.dot, { backgroundColor: palette.accent }]} />
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
                { backgroundColor: palette.accent },
              ]}
            >
              <AppText
                style={[styles.badgeText, { color: palette.navy }]}
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
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderColor: 'rgba(255,255,255,0.42)',
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            {initial ? (
              <AppText style={[styles.avatarText, { color: '#ffffff' }]}>
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
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
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
