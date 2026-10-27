import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { bookingsApi, senderApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
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
  Button,
} from '../../src/components/ui.tsx';
import { SignInPanel } from '../../src/components/auth-gate.tsx';
import { categoryLabel, formatDateTime, inr, kg, statusLabel, statusTone } from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

export default function BookingsScreen() {
  const { status } = useSession();
  const [segment, setSegment] = useState<'bookings' | 'parcels'>('bookings');

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

  if (status !== 'signed_in') {
    return (
      <Screen>
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
      refreshControl={<Refresh refreshing={active.isRefetching} onRefresh={() => void active.refetch()} />}
    >
      <View style={{ flexDirection: 'row', backgroundColor: '#e8ecf3', borderRadius: radius.md, padding: 4, marginBottom: spacing.lg }}>
        <SegmentButton
          label="Bookings"
          active={segment === 'bookings'}
          onPress={() => setSegment('bookings')}
        />
        <SegmentButton label="My parcels" active={segment === 'parcels'} onPress={() => setSegment('parcels')} />
      </View>

      {segment === 'bookings' ? (
        bookings.isLoading ? (
          <Card>
            <LoadingBlock lines={5} />
          </Card>
        ) : bookings.isError ? (
          <ErrorNotice error={bookings.error} onRetry={() => void bookings.refetch()} />
        ) : (bookings.data?.items.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              title="No bookings yet"
              body="A booking is created when you choose a traveller for a parcel, or when a sender chooses you."
              actionLabel="Send a parcel"
              onAction={() => router.push('/send')}
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {bookings.data?.items.map((booking) => (
              <Card
                key={booking.id}
                onPress={() => router.push(`/bookings/${booking.id}`)}
                style={{ padding: spacing.md }}
              >
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="subheading">
                      {booking.origin_city} → {booking.dest_city}
                    </AppText>
                    <AppText variant="small" tone="muted">
                      {booking.role === 'sender' ? 'Sending' : 'Carrying'} · {categoryLabel(booking.category)} ·{' '}
                      {kg(booking.weight_kg)}
                    </AppText>
                  </View>
                  <Badge label={statusLabel(booking.status)} tone={statusTone(booking.status)} />
                </Row>
                <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
                  <AppText variant="small" tone="muted">
                    {formatDateTime(booking.created_at)}
                  </AppText>
                  <AppText variant="small" style={{ fontFamily: font.semibold }}>
                    {inr(booking.agreed_total_paise)}
                  </AppText>
                </Row>
              </Card>
            ))}
          </View>
        )
      ) : parcels.isLoading ? (
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      ) : parcels.isError ? (
        <ErrorNotice error={parcels.error} onRetry={() => void parcels.refetch()} />
      ) : (parcels.data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="No parcels posted"
            body="Post a parcel with its route, window and contents. Travellers going that way can offer to carry it."
            actionLabel="Send a parcel"
            onAction={() => router.push('/send')}
          />
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {parcels.data?.items.map((parcel) => (
            <Card
              key={parcel.id}
              onPress={() => router.push(`/parcels/${parcel.id}`)}
              style={{ padding: spacing.md }}
            >
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="subheading">
                    {parcel.origin_area} → {parcel.dest_area}
                  </AppText>
                  <AppText variant="small" tone="muted">
                    {categoryLabel(parcel.category)} · {kg(parcel.weight_kg)} ·{' '}
                    {formatDateTime(parcel.window_start)}
                  </AppText>
                </View>
                <Badge label={statusLabel(parcel.status)} tone={statusTone(parcel.status)} />
              </Row>
              <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
                <AppText variant="small" tone={parcel.interests_count > 0 ? 'brand' : 'muted'} style={{ fontFamily: font.semibold }}>
                  {parcel.interests_count > 0
                    ? `${parcel.interests_count} traveller${parcel.interests_count === 1 ? '' : 's'} offered`
                    : 'No offers yet'}
                </AppText>
                {parcel.booking_id ? (
                  <Button
                    label="Open booking"
                    variant="tertiary"
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.push(`/bookings/${parcel.booking_id}`)}
                  />
                ) : null}
              </Row>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: active ? colors.surface : 'transparent',
        borderRadius: radius.sm,
        paddingVertical: 8,
        alignItems: 'center',
      }}
    >
      <AppText
        variant="small"
        tone={active ? 'default' : 'muted'}
        onPress={onPress}
        style={{ fontFamily: font.semibold }}
      >
        {label}
      </AppText>
    </View>
  );
}
