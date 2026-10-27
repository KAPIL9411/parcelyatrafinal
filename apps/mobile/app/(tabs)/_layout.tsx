import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { Pressable, View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { conversationsApi, notificationsApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import { colors, font, shadow } from '../../src/theme.ts';

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
      screenOptions={{
        ...header,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.ink300,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          borderTopWidth: 1,
          paddingTop: 6,
          ...shadow.soft,
        },
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 10.5, marginTop: 1 },
        tabBarItemStyle: { paddingBottom: 4 },
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
          tabBarBadgeStyle: {
            backgroundColor: colors.brand,
            color: colors.white,
            fontFamily: font.bold,
            fontSize: 9,
            minWidth: 16,
            height: 16,
            lineHeight: 16,
          },
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
