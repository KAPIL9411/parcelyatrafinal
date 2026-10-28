import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { bookingsApi, senderApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
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
import { SignInPanel } from '../../src/components/auth-gate.tsx';
import { IconBubble, RouteTimeline, Segmented, StatusTrack } from '../../src/components/kit.tsx';
import { categoryLabel, formatDateTime, inr, kg, statusLabel, statusTone } from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

const CLOSED_STATUSES = new Set([
  'delivered',
  'payout_eligible',
  'paid_out',
  'cancelled_by_sender',
  'cancelled_by_traveller',
  'cancelled_ineligible',
  'cancelled_safety',
  'expired',
  'refunded',
]);

type Segment = 'bookings' | 'parcels';
type Filter = 'active' | 'all' | 'closed';

export default function BookingsScreen() {
  const { status } = useSession();
  const [segment, setSegment] = useState<Segment>('bookings');
  const [filter, setFilter] = useState<Filter>('active');

  const bookings = useQuery({
    queryKey: ['bookings', 'all'],
    queryFn: () => bookingsApi.list(),
    enabled: status === 'signed_in',
  });
  const parcels = useQuery({
    queryKey: ['parcels'],
    queryFn: senderApi.myParcels,
    enabled: status === 'signed_in' && segment === 'parcels',
  });

  const items = useMemo(() => bookings.data?.items ?? [], [bookings.data]);
  const activeCount = items.filter((booking) => !CLOSED_STATUSES.has(booking.status)).length;
  const deliveredCount = items.filter((booking) => CLOSED_STATUSES.has(booking.status)).length;
  const visible = items.filter((booking) => {
    if (filter === 'active') return !CLOSED_STATUSES.has(booking.status);
    if (filter === 'closed') return CLOSED_STATUSES.has(booking.status);
    return true;
  });

  if (status !== 'signed_in') {
    return (
      <Screen contentStyle={{ paddingBottom: 128 }}>
        <SignInPanel
          title="Your bookings"
          body="Sign in to see parcels you have sent and parcels you are carrying."
          next="/bookings"
        />
      </Screen>
    );
  }

  const active = segment === 'bookings' ? bookings : parcels;

  return (
    <Screen
      contentStyle={{ paddingBottom: 128 }}
      refreshControl={<Refresh refreshing={active.isRefetching} onRefresh={() => void active.refetch()} />}
    >
      {/* summary */}
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
            width: 160,
            height: 160,
            borderRadius: 80,
            backgroundColor: 'rgba(10,87,255,0.32)',
            right: -60,
            top: -70,
          }}
        />
        <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.1 }}>
          YOUR SHIPMENTS
        </AppText>
        <AppText variant="title" tone="white" style={{ marginTop: 4 }}>
          {activeCount > 0 ? `${activeCount} on the move` : 'Nothing in transit'}
        </AppText>
        <AppText variant="small" tone="onDark" style={{ marginTop: 2 }}>
          Every parcel you send or carry, with the full status history.
        </AppText>
        <Row gap={spacing.md} style={{ marginTop: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <AppText variant="price" style={{ color: colors.white }}>
              {activeCount}
            </AppText>
            <AppText variant="micro" style={{ color: '#9fb0cc', fontFamily: font.regular }}>
              Active
            </AppText>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.16)' }} />
          <View style={{ flex: 1 }}>
            <AppText variant="price" style={{ color: colors.white }}>
              {deliveredCount}
            </AppText>
            <AppText variant="micro" style={{ color: '#9fb0cc', fontFamily: font.regular }}>
              Closed
            </AppText>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.16)' }} />
          <View style={{ flex: 1 }}>
            <AppText variant="price" style={{ color: colors.white }}>
              {items.length}
            </AppText>
            <AppText variant="micro" style={{ color: '#9fb0cc', fontFamily: font.regular }}>
              Total
            </AppText>
          </View>
        </Row>
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <Segmented
          options={[
            { value: 'bookings', label: 'Bookings' },
            { value: 'parcels', label: 'My parcels' },
          ]}
          value={segment}
          onChange={(next) => setSegment(next)}
        />
      </View>

      {segment === 'bookings' ? (
        <>
          <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: 'wrap' }}>
            <FilterChip label={`Active${activeCount ? ` ${activeCount}` : ''}`} active={filter === 'active'} onPress={() => setFilter('active')} />
            <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
            <FilterChip label="Closed" active={filter === 'closed'} onPress={() => setFilter('closed')} />
          </Row>

          {bookings.isLoading ? (
            <Card style={{ marginTop: spacing.md }}>
              <LoadingBlock lines={5} />
            </Card>
          ) : bookings.isError ? (
            <View style={{ marginTop: spacing.md }}>
              <ErrorNotice error={bookings.error} onRetry={() => void bookings.refetch()} />
            </View>
          ) : visible.length === 0 ? (
            <Card style={{ marginTop: spacing.md }}>
              <EmptyState
                title={filter === 'active' ? 'No active shipments' : 'No bookings here'}
                body={
                  filter === 'active'
                    ? 'Post a parcel and a verified traveller going your way can carry it.'
                    : 'A booking is created when you choose a traveller, or when a sender chooses you.'
                }
                actionLabel="Send a parcel"
                onAction={() => router.push('/send')}
              />
            </Card>
          ) : (
            <View style={{ marginTop: spacing.md, gap: spacing.md }}>
              {visible.map((booking) => (
                <Pressable
                  key={booking.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/bookings/${booking.id}`)}
                  style={({ pressed }) => [
                    {
                      backgroundColor: colors.surface,
                      borderRadius: radius.xl,
                      borderWidth: 1,
                      borderColor: colors.line,
                      padding: spacing.lg,
                    },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Row gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
                    <IconBubble
                      name={booking.role === 'sender' ? 'cube-outline' : 'car-outline'}
                      size={38}
                      background={booking.role === 'sender' ? colors.brandSoft : colors.partnerSoft}
                      color={booking.role === 'sender' ? colors.brandDark : colors.partner}
                    />
                    <View style={{ flex: 1 }}>
                      <AppText variant="micro" tone="muted" style={{ letterSpacing: 0.4 }}>
                        {booking.role === 'sender' ? 'YOU ARE SENDING' : 'YOU ARE CARRYING'}
                      </AppText>
                      <AppText variant="heading" numberOfLines={1} style={{ marginTop: 1 }}>
                        {booking.origin_city} → {booking.dest_city}
                      </AppText>
                      <View style={{ flexDirection: 'row', marginTop: 6 }}>
                        <Badge label={statusLabel(booking.status)} tone={statusTone(booking.status)} />
                      </View>
                    </View>
                  </Row>

                  <View style={{ marginTop: spacing.md }}>
                    <RouteTimeline
                      origin={booking.origin_city}
                      dest={booking.dest_city}
                      originMeta={`${categoryLabel(booking.category)} · ${kg(booking.weight_kg)}`}
                      destMeta={`Booked ${formatDateTime(booking.created_at)}`}
                      compact
                      tone={booking.role === 'traveller' ? 'partner' : 'brand'}
                    />
                  </View>

                  <View style={{ marginTop: spacing.md }}>
                    <StatusTrack
                      status={booking.status}
                      tone={booking.role === 'traveller' ? 'partner' : 'brand'}
                    />
                  </View>

                  <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
                    <View>
                      <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
                        {booking.role === 'sender' ? 'You pay' : 'Booking total'}
                      </AppText>
                      <AppText variant="price" style={{ fontSize: 18 }}>
                        {inr(booking.agreed_total_paise)}
                      </AppText>
                    </View>
                    <Row gap={4}>
                      <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                        View details
                      </AppText>
                      <Ionicons name="arrow-forward" size={14} color={colors.brandDark} />
                    </Row>
                  </Row>
                </Pressable>
              ))}
            </View>
          )}
        </>
      ) : parcels.isLoading ? (
        <Card style={{ marginTop: spacing.md }}>
          <LoadingBlock lines={5} />
        </Card>
      ) : parcels.isError ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={parcels.error} onRetry={() => void parcels.refetch()} />
        </View>
      ) : (parcels.data?.items.length ?? 0) === 0 ? (
        <Card style={{ marginTop: spacing.md }}>
          <EmptyState
            title="No parcels posted"
            body="Post a parcel with its route, window and contents. Travellers going that way can offer to carry it."
            actionLabel="Send a parcel"
            onAction={() => router.push('/send')}
          />
        </Card>
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          {parcels.data?.items.map((parcel) => (
            <Pressable
              key={parcel.id}
              accessibilityRole="button"
              onPress={() => router.push(`/parcels/${parcel.id}`)}
              style={({ pressed }) => [
                {
                  backgroundColor: colors.surface,
                  borderRadius: radius.xl,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: spacing.lg,
                },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Row gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
                <IconBubble name="cube-outline" size={38} background={colors.accentSoft} color={colors.warn} />
                <View style={{ flex: 1 }}>
                  <AppText variant="micro" tone="muted" style={{ letterSpacing: 0.4 }}>
                    {categoryLabel(parcel.category).toUpperCase()}
                  </AppText>
                  <AppText variant="heading" numberOfLines={1} style={{ marginTop: 1 }}>
                    {parcel.origin_area} → {parcel.dest_area}
                  </AppText>
                  <View style={{ flexDirection: 'row', marginTop: 6 }}>
                    <Badge label={statusLabel(parcel.status)} tone={statusTone(parcel.status)} />
                  </View>
                </View>
              </Row>

              <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: 'wrap' }}>
                <MiniFact icon="scale-outline" text={kg(parcel.weight_kg)} />
                <MiniFact icon="calendar-outline" text={formatDateTime(parcel.window_start)} />
                <MiniFact icon="cash-outline" text={inr(parcel.declared_value_paise)} />
              </Row>

              <Row style={{ justifyContent: 'space-between', marginTop: spacing.md, flexWrap: 'wrap', gap: spacing.sm }}>
                <Row gap={6}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: parcel.interests_count > 0 ? colors.success : colors.ink300,
                    }}
                  />
                  <AppText
                    variant="small"
                    tone={parcel.interests_count > 0 ? 'success' : 'muted'}
                    style={{ fontFamily: font.semibold }}
                  >
                    {parcel.interests_count > 0
                      ? `${parcel.interests_count} traveller${parcel.interests_count === 1 ? '' : 's'} offered`
                      : 'Waiting for offers'}
                  </AppText>
                </Row>
                {parcel.booking_id ? (
                  <Button
                    label="Open booking"
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.push(`/bookings/${parcel.booking_id}`)}
                  />
                ) : (
                  <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                    View parcel →
                  </AppText>
                )}
              </Row>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        backgroundColor: active ? colors.navy : colors.surface,
        borderWidth: 1,
        borderColor: active ? colors.navy : colors.line,
        borderRadius: radius.pill,
        paddingHorizontal: 14,
        paddingVertical: 7,
      }}
    >
      <AppText
        variant="small"
        style={{
          color: active ? colors.white : colors.ink700,
          fontFamily: font.semibold,
          fontSize: 12,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function MiniFact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.canvas,
        borderRadius: radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <Ionicons name={icon} size={11} color={colors.ink500} />
      <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
        {text}
      </AppText>
    </View>
  );
}
