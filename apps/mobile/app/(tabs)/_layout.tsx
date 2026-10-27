import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { Pressable, View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { notificationsApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import { colors, font } from '../../src/theme.ts';

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
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={23} color={colors.ink700} />
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

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontFamily: font.semibold, fontSize: 18, color: colors.ink900 },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.ink500,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: 'Parcel Yatra',
          headerRight: () => <Bell />,
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={typeof color === 'string' ? color : colors.ink500} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Bookings',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={typeof color === 'string' ? color : colors.ink500} />,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color, size }) => <Ionicons name="navigate-outline" size={size} color={typeof color === 'string' ? color : colors.ink500} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={typeof color === 'string' ? color : colors.ink500} />,
        }}
      />
    </Tabs>
  );
}
