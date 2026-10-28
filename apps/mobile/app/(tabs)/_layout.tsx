import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { conversationsApi, notificationsApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import { colors, font, radius, shadow } from '../../src/theme.ts';

function Bell() {
  const { status } = useSession();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
    enabled: status === 'signed_in',
    refetchInterval: 60_000,
  });
  if (status !== 'signed_in') return null;
  const unread = notifications.data?.unread_count ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `${unread} unread notifications` : 'Notifications'}
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      style={{ marginRight: 16, padding: 4 }}
    >
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={22} color={colors.ink700} />
      {unread > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 3,
            borderRadius: 8,
            backgroundColor: colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.white, fontFamily: font.bold, fontSize: 10 }}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function SendButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send a parcel"
      onPress={() => router.push('/send')}
      hitSlop={10}
      style={{ marginRight: 4, padding: 4 }}
    >
      <Ionicons name="add-circle" size={24} color={colors.brand} />
    </Pressable>
  );
}

/**
 * A floating pill instead of the stock bar.
 *
 * The bar sits 24 dp above the safe area and is 64 dp tall, so the page shows through beneath it
 * rather than ending on a hard edge. It is opaque-ish (`0.97`) rather than blurred: `expo-blur` is
 * not part of this app's dependency set, and a translucent surface with a floating shadow reads the
 * same at phone sizes without another native module to ship.
 *
 * Expo Router's tab bar contract (its bundled bottom-tabs navigator, not the standalone package):
 * the bar receives a state, descriptors and a `navigateToTab` helper. Modelled structurally here so
 * this file does not depend on an internal type path.
 */
interface PillTabBarProps {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
        tabBarBadge?: string | number;
        tabBarIcon?: (props: { focused: boolean; color: string; size: number }) => ReactNode;
      };
    }
  >;
  navigateToTab: (routeKey: string) => void;
  insets: { bottom: number };
}

function PillTabBar({ state, descriptors, navigateToTab, insets }: PillTabBarProps) {
  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom: insets.bottom + 24 }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const options = descriptors[route.key];
          if (!options) return null;
          const focused = state.index === index;
          const label = options.options.title ?? route.name;
          const badge = options.options.tabBarBadge;
          const tint = focused ? colors.brand : colors.ink500;

          const icon = options.options.tabBarIcon;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={() => {
                if (!focused) navigateToTab(route.key);
              }}
              style={({ pressed }) => [
                styles.item,
                focused && styles.itemActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={styles.iconWrap}>
                {icon ? icon({ focused, color: tint, size: 21 }) : null}
                {badge !== undefined && badge !== null && badge !== '' ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.label, { color: tint }, focused && styles.labelActive]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { status } = useSession();
  const inbox = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationsApi.list,
    enabled: status === 'signed_in',
    refetchInterval: 60_000,
  });
  const unreadMessages = inbox.data?.total_unread ?? 0;

  const header = {
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.canvas },
    headerTitleStyle: { fontFamily: font.semibold, fontSize: 18, color: colors.ink900 },
    headerTintColor: colors.ink900,
  } as const;

  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        ...header,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.ink300,
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Bookings',
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <SendButton />
              <Bell />
            </View>
          ),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'cube' : 'cube-outline'} size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <SendButton />
              <Bell />
            </View>
          ),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'car-sport' : 'car-sport-outline'} size={23} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          headerRight: () => <Bell />,
          tabBarBadge: unreadMessages > 0 ? (unreadMessages > 9 ? '9+' : unreadMessages) : undefined,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerRight: () => <Bell />,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 560,
    height: 64,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(6,26,122,0.07)',
    ...shadow.floating,
  },
  item: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActive: { backgroundColor: colors.brandSoft },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  label: {
    fontFamily: font.regular,
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
  },
  labelActive: { fontFamily: font.semibold },
  badge: {
    position: 'absolute',
    top: -5,
    right: -12,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontFamily: font.bold, fontSize: 9, lineHeight: 11 },
});
