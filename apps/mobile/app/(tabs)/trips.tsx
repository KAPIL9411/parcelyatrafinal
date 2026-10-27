import { router } from 'expo-router';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { travellerApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import { SignInPanel } from '../../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  LoadingBlock,
  Refresh,
  Row,
  Screen,
} from '../../src/components/ui.tsx';
import { useCities } from '../../src/lib/cities.ts';
import { formatDateTime, kg, modeLabel, statusLabel, statusTone } from '../../src/lib/format.ts';
import { colors, font, spacing } from '../../src/theme.ts';

export default function TripsScreen() {
  const { status } = useSession();
  const cities = useCities();
  const trips = useQuery({
    queryKey: ['trips'],
    queryFn: travellerApi.trips,
    enabled: status === 'signed_in',
  });
  const verification = useQuery({
    queryKey: ['verification'],
    queryFn: travellerApi.verification,
    enabled: status === 'signed_in',
  });

  if (status !== 'signed_in') {
    return (
      <Screen>
        <SignInPanel
          title="Travel and earn"
          body="Publish a trip you are already making, and carry a parcel that fits your route and space."
          next="/trips"
        />
      </Screen>
    );
  }

  const verified = verification.data?.state === 'verified';

  return (
    <Screen
      refreshControl={
        <Refresh
          refreshing={trips.isRefetching || verification.isRefetching}
          onRefresh={() => {
            void trips.refetch();
            void verification.refetch();
          }}
        />
      }
    >
      {!verified && !verification.isLoading ? (
        <Banner
          tone="warn"
          title="ID verification is needed to publish"
          body={
            verification.data?.state === 'pending'
              ? 'Your documents are with the review team. You can publish once approved.'
              : 'Publish is locked until your driving licence, voter ID or passport is approved.'
          }
        />
      ) : null}

      <Button
        label="Publish a trip"
        onPress={() => router.push('/trips/new')}
        style={{ marginTop: spacing.md }}
      />

      <AppText variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Your trips
      </AppText>

      {trips.isLoading ? (
        <Card>
          <LoadingBlock lines={4} />
        </Card>
      ) : trips.isError ? (
        <ErrorNotice error={trips.error} onRetry={() => void trips.refetch()} />
      ) : (trips.data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="No trips published"
            body="Add the route, the day you travel and the space you can spare. Senders going the same way will see you."
            actionLabel="Publish a trip"
            onAction={() => router.push('/trips/new')}
          />
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {trips.data?.items.map((trip) => (
            <Card key={trip.id} onPress={() => router.push(`/trips/${trip.id}`)} style={{ padding: spacing.md }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="subheading">
                    {cities.name(trip.origin_city_id)} → {cities.name(trip.dest_city_id)}
                  </AppText>
                  <AppText variant="small" tone="muted">
                    {modeLabel(trip.mode)} · departs {formatDateTime(trip.departure_at)}
                  </AppText>
                </View>
                <Badge label={statusLabel(trip.status)} tone={statusTone(trip.status)} />
              </Row>
              <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
                <AppText variant="small" tone="muted">
                  {kg(trip.capacity_kg_remaining)} of {kg(trip.capacity_kg)} free
                </AppText>
                <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                  View parcels →
                </AppText>
              </Row>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
