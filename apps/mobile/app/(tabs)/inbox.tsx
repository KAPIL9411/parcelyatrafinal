import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { bookingsApi, conversationsApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import { SignInPanel } from '../../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  LoadingBlock,
  Refresh,
  Row,
  Screen,
} from '../../src/components/ui.tsx';
import { Avatar, Segmented } from '../../src/components/kit.tsx';
import { statusLabel, statusTone, timeAgo } from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

export default function InboxScreen() {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<'all' | 'unread'>('all');
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<unknown>(null);

  const inbox = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationsApi.list,
    enabled: status === 'signed_in',
  });
  const bookings = useQuery({
    queryKey: ['bookings', 'all'],
    queryFn: () => bookingsApi.list(),
    enabled: status === 'signed_in',
  });

  const routes = useMemo(() => {
    const map = new Map<string, { origin: string; dest: string }>();
    for (const booking of bookings.data?.items ?? []) {
      map.set(booking.id, { origin: booking.origin_city, dest: booking.dest_city });
    }
    return map;
  }, [bookings.data]);

  if (status !== 'signed_in') {
    return (
      <Screen contentStyle={{ paddingBottom: 128 }}>
        <SignInPanel
          title="Your messages"
          body="Sign in to coordinate pickup and delivery with the other side of each booking."
          next="/inbox"
        />
      </Screen>
    );
  }

  const items = inbox.data?.items ?? [];
  const visible = segment === 'unread' ? items.filter((item) => item.unread_count > 0) : items;
  const totalUnread = inbox.data?.total_unread ?? 0;

  async function markAll() {
    setMarking(true);
    setMarkError(null);
    try {
      await Promise.all(
        items.filter((item) => item.unread_count > 0).map((item) => bookingsApi.markThreadRead(item.booking_id)),
      );
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      setMarkError(err);
    } finally {
      setMarking(false);
    }
  }

  return (
    <Screen
      contentStyle={{ paddingBottom: 128 }}
      refreshControl={
        <Refresh
          refreshing={inbox.isRefetching || bookings.isRefetching}
          onRefresh={() => {
            void inbox.refetch();
            void bookings.refetch();
          }}
        />
      }
    >
      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: radius.xl,
          padding: spacing.lg,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: 140,
            height: 140,
            borderRadius: 70,
            backgroundColor: 'rgba(10,87,255,0.35)',
            top: -60,
            right: -40,
          }}
        />
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.1 }}>
              MESSAGES
            </AppText>
            <AppText variant="title" tone="white" style={{ marginTop: 4 }}>
              {totalUnread > 0 ? `${totalUnread} unread` : 'You are all caught up'}
            </AppText>
            <AppText variant="small" tone="onDark" style={{ marginTop: 2 }}>
              Chat opens when a booking exists, and stays attached to it. No phone numbers are shown.
            </AppText>
          </View>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chatbubbles" size={22} color={colors.white} />
          </View>
        </Row>
        {totalUnread > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={markAll}
            style={{
              alignSelf: 'flex-start',
              marginTop: spacing.md,
              backgroundColor: colors.accent,
              borderRadius: radius.pill,
              paddingHorizontal: 14,
              paddingVertical: 7,
              opacity: marking ? 0.6 : 1,
            }}
          >
            <AppText variant="micro" style={{ color: colors.navy, fontFamily: font.bold }}>
              {marking ? 'Marking…' : 'Mark all as read'}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <Segmented
          options={[
            { value: 'all', label: `All${items.length ? ` (${items.length})` : ''}` },
            { value: 'unread', label: `Unread${totalUnread ? ` (${totalUnread})` : ''}` },
          ]}
          value={segment}
          onChange={setSegment}
        />
      </View>

      {markError ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={markError} />
        </View>
      ) : null}

      {inbox.isLoading ? (
        <Card style={{ marginTop: spacing.md }}>
          <LoadingBlock lines={5} />
        </Card>
      ) : inbox.isError ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />
        </View>
      ) : visible.length === 0 ? (
        <Card style={{ marginTop: spacing.md }}>
          <EmptyState
            title={segment === 'unread' ? 'No unread messages' : 'No conversations yet'}
            body="A thread opens when a booking is created. Pickup and delivery coordination stays here, with the booking."
            actionLabel="View bookings"
            onAction={() => router.push('/bookings')}
          />
        </Card>
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {visible.map((item) => {
            const route = routes.get(item.booking_id);
            const unread = item.unread_count > 0;
            return (
              <Pressable
                key={item.conversation_id}
                accessibilityRole="button"
                onPress={() => router.push(`/bookings/${item.booking_id}`)}
                style={({ pressed }) => [
                  {
                    backgroundColor: unread ? colors.brandTint : colors.surface,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: unread ? '#d5e2ff' : colors.line,
                    padding: spacing.md,
                  },
                  pressed && { opacity: 0.86 },
                ]}
              >
                <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
                  <View>
                    <Avatar name={item.counterparty ?? (item.role === 'sender' ? 'Traveller' : 'Sender')} size={44} />
                    {unread ? (
                      <View
                        style={{
                          position: 'absolute',
                          top: -2,
                          right: -2,
                          minWidth: 18,
                          height: 18,
                          paddingHorizontal: 4,
                          borderRadius: 9,
                          backgroundColor: colors.brand,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <AppText style={{ color: colors.white, fontFamily: font.bold, fontSize: 9 }}>
                          {item.unread_count > 9 ? '9+' : item.unread_count}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <AppText variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
                        {item.counterparty ?? (item.role === 'sender' ? 'Your traveller' : 'The sender')}
                      </AppText>
                      <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
                        {item.last_at ? timeAgo(item.last_at) : '—'}
                      </AppText>
                    </Row>
                    {route ? (
                      <AppText variant="micro" tone="brand" numberOfLines={1} style={{ marginTop: 1 }}>
                        {route.origin} → {route.dest}
                      </AppText>
                    ) : null}
                    <AppText
                      variant="small"
                      tone={unread ? 'default' : 'muted'}
                      numberOfLines={2}
                      style={{ marginTop: 3, fontFamily: unread ? font.semibold : font.regular }}
                    >
                      {item.last_message ?? 'No messages yet. Say hello and agree a pickup point.'}
                    </AppText>
                    <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
                      <Badge label={statusLabel(item.booking_status)} tone={statusTone(item.booking_status)} />
                      <AppText variant="micro" tone="brand" style={{ fontFamily: font.semibold }}>
                        Open chat →
                      </AppText>
                    </Row>
                  </View>
                </Row>
              </Pressable>
            );
          })}
        </View>
      )}

      <Button
        label="Go to bookings"
        variant="secondary"
        onPress={() => router.push('/bookings')}
        style={{ marginTop: spacing.lg }}
      />
    </Screen>
  );
}
