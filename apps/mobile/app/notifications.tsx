import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { notificationsApi } from '../src/api/client.ts';
import type { NotificationItem } from '../src/api/types.ts';
import { AuthGate } from '../src/components/auth-gate.tsx';
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
} from '../src/components/ui.tsx';
import { notificationLabel, timeAgo } from '../src/lib/format.ts';
import { colors, font, radius, spacing } from '../src/theme.ts';

export default function NotificationsScreen() {
  return (
    <AuthGate next="/notifications">
      <NotificationsList />
    </AuthGate>
  );
}

function NotificationsList() {
  const queryClient = useQueryClient();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<unknown>(null);

  const notifications = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list });
  const unread = notifications.data?.unread_count ?? 0;
  const items = notifications.data?.items ?? [];

  async function markAll() {
    setMarking(true);
    setMarkError(null);
    try {
      await notificationsApi.readAll();
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      setMarkError(err);
    } finally {
      setMarking(false);
    }
  }

  async function open(item: NotificationItem) {
    if (!item.read_at) {
      try {
        await notificationsApi.read(item.id);
        await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        // Reading a row is best-effort: not being able to clear the dot must not block the booking.
      }
    }
    if (item.booking_id) router.push(`/bookings/${item.booking_id}`);
  }

  if (notifications.isLoading) {
    return (
      <Screen>
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      </Screen>
    );
  }

  if (notifications.isError) {
    return (
      <Screen>
        <ErrorNotice error={notifications.error} onRetry={() => void notifications.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <Refresh refreshing={notifications.isRefetching} onRefresh={() => void notifications.refetch()} />
      }
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Notifications</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
            What we sent, and when. Bodies are never stored with personal data.
          </AppText>
        </View>
        {unread > 0 ? <Badge label={`${unread} unread`} tone="info" /> : null}
      </Row>

      {unread > 0 ? (
        <Button
          label="Mark all as read"
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={marking}
          onPress={markAll}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      {markError ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={markError} />
        </View>
      ) : null}

      {items.length === 0 ? (
        <Card style={{ marginTop: spacing.lg }}>
          <EmptyState
            title="Nothing yet"
            body="Booking updates, messages and verification decisions appear here."
          />
        </Card>
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => void open(item)}
              style={({ pressed }) => [
                {
                  backgroundColor: item.read_at ? colors.surface : '#f2f6ff',
                  borderWidth: 1,
                  borderColor: item.read_at ? colors.line : '#d5e2ff',
                  borderRadius: radius.lg,
                  padding: spacing.md,
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Row gap={6}>
                    {!item.read_at ? (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />
                    ) : null}
                    <AppText
                      variant="body"
                      style={{ fontFamily: item.read_at ? font.regular : font.semibold, flex: 1 }}
                    >
                      {notificationLabel(item.template_id)}
                    </AppText>
                  </Row>
                  <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
                    {item.channel.toUpperCase()} · {timeAgo(item.created_at)}
                    {item.booking_id ? ` · booking ${item.booking_id.slice(0, 8)}` : ''}
                  </AppText>
                </View>
                <Badge
                  label={item.status}
                  tone={item.status === 'sent' || item.status === 'delivered' ? 'success' : item.status === 'failed' ? 'danger' : 'neutral'}
                />
              </Row>
              {item.booking_id ? (
                <AppText variant="small" tone="brand" style={{ marginTop: spacing.sm, fontFamily: font.semibold }}>
                  Open booking →
                </AppText>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
