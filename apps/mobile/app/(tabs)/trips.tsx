import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

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
import { IconBubble, RouteTimeline, Stat } from '../../src/components/kit.tsx';
import { useCities } from '../../src/lib/cities.ts';
import { formatDateTime, kg, modeLabel, statusLabel, statusTone } from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

const LIVE_TRIP_STATUSES = new Set(['published', 'partially_booked', 'in_progress']);

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
        <View
          style={{
            backgroundColor: colors.partner,
            borderRadius: radius.xl,
            padding: spacing.xl,
            marginBottom: spacing.lg,
          }}
        >
          <AppText variant="label" style={{ color: '#bfe9db', letterSpacing: 1.1 }}>
            PARTNER
          </AppText>
          <AppText variant="title" tone="white" style={{ marginTop: 4 }}>
            Drive. Carry. Earn.
          </AppText>
          <AppText variant="small" style={{ color: '#d3ece4', marginTop: 4 }}>
            Publish the trip you are already making and carry a parcel that fits your route.
          </AppText>
        </View>
        <SignInPanel
          title="Travel and earn"
          body="Sign in to publish a trip, see parcels on your route and track what you have carried."
          next="/trips"
        />
      </Screen>
    );
  }

  const verified = verification.data?.state === 'verified';
  const items = trips.data?.items ?? [];
  const live = items.filter((trip) => LIVE_TRIP_STATUSES.has(trip.status));
  const completed = items.filter((trip) => trip.status === 'completed').length;
  const capacity = live.reduce((sum, trip) => sum + trip.capacity_kg_remaining, 0);

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
      {/* partner hero */}
      <View
        style={{
          backgroundColor: colors.partner,
          borderRadius: radius.xl,
          padding: spacing.lg,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: 170,
            height: 170,
            borderRadius: 85,
            backgroundColor: 'rgba(255,255,255,0.10)',
            right: -60,
            top: -70,
          }}
        />
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: '#bfe9db', letterSpacing: 1.1 }}>
              PARTNER
            </AppText>
            <AppText variant="title" tone="white" style={{ marginTop: 4 }}>
              Your route, your earnings
            </AppText>
            <AppText variant="small" style={{ color: '#d3ece4', marginTop: 2 }}>
              Carry what fits. You choose every request, and hand over against a code.
            </AppText>
          </View>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: 'rgba(255,255,255,0.14)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="car-sport" size={24} color={colors.white} />
          </View>
        </Row>

        <Row gap={spacing.md} style={{ marginTop: spacing.lg }}>
          <Stat value={String(live.length)} label="Live trips" tone="onDark" />
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
          <Stat value={kg(capacity)} label="Space left" tone="onDark" />
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
          <Stat value={String(completed)} label="Completed" tone="onDark" />
        </Row>

        <Button
          label="Publish a trip"
          variant="secondary"
          onPress={() => router.push('/trips/new')}
          style={{ marginTop: spacing.lg, backgroundColor: colors.white, borderColor: colors.white }}
        />
      </View>

      {!verified && !verification.isLoading ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warn"
            title="ID verification is needed to publish"
            body={
              verification.data?.state === 'pending'
                ? 'Your documents are with the review team. You can publish once approved.'
                : 'Publish is locked until your driving licence, voter ID or passport is approved.'
            }
          />
          <Button
            label={verification.data?.state === 'pending' ? 'See verification' : 'Verify your ID'}
            variant="secondary"
            onPress={() => router.push('/verification')}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      ) : null}

      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.md }}>
        <AppText variant="heading">Your trips</AppText>
        {items.length > 0 ? (
          <AppText variant="small" tone="muted">
            {items.length} published
          </AppText>
        ) : null}
      </Row>

      {trips.isLoading ? (
        <Card>
          <LoadingBlock lines={4} />
        </Card>
      ) : trips.isError ? (
        <ErrorNotice error={trips.error} onRetry={() => void trips.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No trips published"
            body="Add the route, the day you travel and the space you can spare. Senders going the same way will see you."
            actionLabel="Publish a trip"
            onAction={() => router.push('/trips/new')}
          />
        </Card>
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((trip) => {
            const total = trip.capacity_kg || 1;
            const usedRatio = Math.max(0, Math.min(1, (total - trip.capacity_kg_remaining) / total));
            return (
              <Pressable
                key={trip.id}
                accessibilityRole="button"
                onPress={() => router.push(`/trips/${trip.id}`)}
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
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Row gap={spacing.sm} style={{ flex: 1 }}>
                    <IconBubble name="car-outline" size={38} background={colors.partnerSoft} color={colors.partner} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="micro" tone="muted" style={{ letterSpacing: 0.4 }}>
                        {modeLabel(trip.mode).toUpperCase()} · {formatDateTime(trip.departure_at)}
                      </AppText>
                      <AppText variant="heading" numberOfLines={1} style={{ marginTop: 1 }}>
                        {cities.name(trip.origin_city_id)} → {cities.name(trip.dest_city_id)}
                      </AppText>
                    </View>
                  </Row>
                  <Badge label={statusLabel(trip.status)} tone={statusTone(trip.status)} />
                </Row>

                <View style={{ marginTop: spacing.md }}>
                  <RouteTimeline
                    origin={trip.origin_area ?? cities.name(trip.origin_city_id)}
                    dest={cities.name(trip.dest_city_id)}
                    originMeta={`Departs ${formatDateTime(trip.departure_at)}`}
                    destMeta={`Arrives by ${formatDateTime(trip.arrival_estimate_at)}`}
                    compact
                    tone="partner"
                  />
                </View>

                <View style={{ marginTop: spacing.md }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
                      Capacity used
                    </AppText>
                    <AppText variant="micro" style={{ fontFamily: font.semibold }}>
                      {kg(trip.capacity_kg - trip.capacity_kg_remaining)} of {kg(trip.capacity_kg)} used
                    </AppText>
                  </Row>
                  <View
                    style={{
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: colors.canvasAlt,
                      marginTop: 5,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.round(usedRatio * 100)}%`,
                        height: '100%',
                        borderRadius: 4,
                        backgroundColor: usedRatio > 0.85 ? colors.warn : colors.partner,
                      }}
                    />
                  </View>
                </View>

                <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
                  <AppText variant="small" tone="muted">
                    {trip.accepts_documents_only ? 'Documents only' : 'All allowed categories'}
                  </AppText>
                  <Row gap={4}>
                    <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                      View parcels
                    </AppText>
                    <Ionicons name="arrow-forward" size={14} color={colors.brandDark} />
                  </Row>
                </Row>
              </Pressable>
            );
          })}
        </View>
      )}

      <Card style={{ marginTop: spacing.lg, backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
        <AppText variant="subheading">How partner earnings work</AppText>
        <Fact text="Your share is fixed before you accept, and shown on the booking." />
        <Fact text="It becomes eligible 72 hours after delivery, if no case is open." />
        <Fact text="Payouts are not live in this build. The app says so instead of pretending." />
        <Fact text="Four parcels per month is the launch limit for each traveller." />
      </Card>
    </Screen>
  );
}

function Fact({ text }: { text: string }) {
  return (
    <Row gap={spacing.sm} style={{ alignItems: 'flex-start', marginTop: 6 }}>
      <Ionicons name="checkmark-circle" size={14} color={colors.partner} style={{ marginTop: 2 }} />
      <AppText variant="small" style={{ flex: 1 }}>
        {text}
      </AppText>
    </Row>
  );
}
