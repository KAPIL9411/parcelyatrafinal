import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { notificationsApi } from '../src/api/client.ts';
import type { NotificationItem } from '../src/api/types.ts';
import { AuthGate } from '../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Card,
  EmptyState,
  ErrorNotice,
  LoadingBlock,
  Refresh,
  Row,
  Screen,
} from '../src/components/ui.tsx';
import { IconBubble, Segmented } from '../src/components/kit.tsx';
import { notificationLabel, timeAgo } from '../src/lib/format.ts';
import { colors, font, radius, spacing } from '../src/theme.ts';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function templateIcon(templateId: string): { icon: IconName; tone: 'brand' | 'partner' | 'warn' | 'danger' | 'success' } {
  if (templateId.startsWith('verification')) return { icon: 'shield-checkmark', tone: 'success' };
  if (templateId.startsWith('dispute')) return { icon: 'alert-circle', tone: 'danger' };
  if (templateId.startsWith('payment') || templateId === 'payout_eligible') return { icon: 'card', tone: 'warn' };
  if (templateId.startsWith('message')) return { icon: 'chatbubble-ellipses', tone: 'brand' };
  if (templateId.startsWith('trip')) return { icon: 'car-sport', tone: 'partner' };
  if (templateId.startsWith('pickup') || templateId.startsWith('delivery') || templateId === 'otp') {
    return { icon: 'keypad', tone: 'warn' };
  }
  if (templateId === 'delivered' || templateId === 'payout_eligible') return { icon: 'checkmark-done', tone: 'success' };
  if (templateId.startsWith('booking')) return { icon: 'cube', tone: 'brand' };
  return { icon: 'notifications', tone: 'brand' };
}

const TONES = {
  brand: { bg: colors.brandSoft, fg: colors.brandDark },
  partner: { bg: colors.partnerSoft, fg: colors.partner },
  warn: { bg: colors.warnBg, fg: colors.warn },
  danger: { bg: colors.dangerBg, fg: colors.danger },
  success: { bg: colors.successBg, fg: colors.success },
} as const;

function dayBucket(iso: string): 'Today' | 'Yesterday' | 'Earlier' {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return 'Today';
  if (date.getTime() >= startOfToday - 24 * 60 * 60 * 1000) return 'Yesterday';
  return 'Earlier';
}

export default function NotificationsScreen() {
  return (
    <AuthGate next="/notifications">
      <NotificationsList />
    </AuthGate>
  );
}

function NotificationsList() {
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<'all' | 'unread'>('all');
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<unknown>(null);

  const notifications = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list });
  const unread = notifications.data?.unread_count ?? 0;
  const items = useMemo(() => notifications.data?.items ?? [], [notifications.data]);

  const visible = segment === 'unread' ? items.filter((item) => !item.read_at) : items;

  const groups = useMemo(() => {
    const map = new Map<string, NotificationItem[]>();
    for (const item of visible) {
      const bucket = dayBucket(item.created_at);
      map.set(bucket, [...(map.get(bucket) ?? []), item]);
    }
    return Array.from(map.entries());
  }, [visible]);

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
      {/* hero */}
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
            width: 150,
            height: 150,
            borderRadius: 75,
            backgroundColor: 'rgba(10,87,255,0.32)',
            right: -50,
            top: -60,
          }}
        />
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.1 }}>
              UPDATES
            </AppText>
            <AppText variant="title" tone="white" style={{ marginTop: 4 }}>
              {unread > 0 ? `${unread} unread` : 'You are up to date'}
            </AppText>
            <AppText variant="small" tone="onDark" style={{ marginTop: 2 }}>
              Booking updates, verification decisions and messages. Bodies are never stored with personal data.
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
            <Ionicons name={unread > 0 ? 'notifications' : 'notifications-outline'} size={22} color={colors.white} />
          </View>
        </Row>
        {unread > 0 ? (
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
            { value: 'unread', label: `Unread${unread ? ` (${unread})` : ''}` },
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

      {visible.length === 0 ? (
        <Card style={{ marginTop: spacing.md }}>
          <EmptyState
            title={segment === 'unread' ? 'No unread updates' : 'Nothing yet'}
            body={
              segment === 'unread'
                ? 'Everything has been read. New booking updates will appear here.'
                : 'Booking updates, messages and verification decisions appear here.'
            }
            actionLabel="Open bookings"
            onAction={() => router.push('/bookings')}
          />
        </Card>
      ) : (
        <View style={{ marginTop: spacing.md }}>
          {groups.map(([bucket, rows]) => (
            <View key={bucket} style={{ marginTop: spacing.md }}>
              <AppText
                variant="label"
                tone="muted"
                style={{ letterSpacing: 0.9, marginBottom: spacing.sm }}
              >
                {bucket.toUpperCase()}
              </AppText>
              <View style={{ gap: spacing.sm }}>
                {rows.map((item) => {
                  const meta = templateIcon(item.template_id);
                  const palette = TONES[meta.tone];
                  const unreadItem = !item.read_at;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => void open(item)}
                      style={({ pressed }) => [
                        {
                          backgroundColor: unreadItem ? colors.brandTint : colors.surface,
                          borderWidth: 1,
                          borderColor: unreadItem ? '#d5e2ff' : colors.line,
                          borderRadius: radius.lg,
                          padding: spacing.md,
                        },
                        pressed && { opacity: 0.86 },
                      ]}
                    >
                      <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
                        <IconBubble name={meta.icon} size={38} background={palette.bg} color={palette.fg} iconSize={18} />
                        <View style={{ flex: 1 }}>
                          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <AppText
                              variant="body"
                              numberOfLines={2}
                              style={{
                                flex: 1,
                                fontFamily: unreadItem ? font.semibold : font.regular,
                                lineHeight: 20,
                              }}
                            >
                              {notificationLabel(item.template_id)}
                            </AppText>
                            {unreadItem ? (
                              <View
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 4,
                                  backgroundColor: colors.brand,
                                  marginLeft: spacing.sm,
                                  marginTop: 6,
                                }}
                              />
                            ) : null}
                          </Row>
                          <AppText variant="micro" tone="muted" style={{ marginTop: 3, fontFamily: font.regular }}>
                            {item.channel.toUpperCase()} · {timeAgo(item.created_at)}
                            {item.booking_id ? ` · ${item.booking_id.slice(0, 8)}` : ''}
                          </AppText>
                          <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
                            <Badge
                              label={item.status}
                              tone={
                                item.status === 'sent' || item.status === 'delivered'
                                  ? 'success'
                                  : item.status === 'failed'
                                    ? 'danger'
                                    : 'neutral'
                              }
                            />
                            {item.booking_id ? (
                              <Row gap={3}>
                                <AppText variant="micro" tone="brand" style={{ fontFamily: font.semibold }}>
                                  Open booking
                                </AppText>
                                <Ionicons name="arrow-forward" size={11} color={colors.brandDark} />
                              </Row>
                            ) : null}
                          </Row>
                        </View>
                      </Row>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
