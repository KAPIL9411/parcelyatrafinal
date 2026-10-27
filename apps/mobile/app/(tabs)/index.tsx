import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
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
  SectionTitle,
} from '../../src/components/ui.tsx';
import { categoryLabel, inr, statusLabel, statusTone } from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

export default function HomeScreen() {
  const { status, user } = useSession();

  const config = useQuery({ queryKey: ['config'], queryFn: senderApi.config, staleTime: 10 * 60_000 });
  const bookings = useQuery({
    queryKey: ['bookings', 'recent'],
    queryFn: () => bookingsApi.list(),
    enabled: status === 'signed_in',
  });

  const refreshing = config.isRefetching || bookings.isRefetching;
  const recent = (bookings.data?.items ?? []).slice(0, 3);

  return (
    <Screen
      refreshControl={
        <Refresh
          refreshing={refreshing}
          onRefresh={() => {
            void config.refetch();
            if (status === 'signed_in') void bookings.refetch();
          }}
        />
      }
    >
      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: radius.xl,
          padding: spacing.xl,
          overflow: 'hidden',
        }}
      >
        <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.2 }}>
          INTERCITY · CARRIED BY TRAVELLERS
        </AppText>
        <AppText variant="display" tone="white" style={{ marginTop: spacing.md }}>
          Send it with someone already going.
        </AppText>
        <AppText variant="body" tone="onDark" style={{ marginTop: spacing.sm }}>
          Post your parcel, pick a verified traveller on that route, and share one-time codes at pickup and
          delivery.
        </AppText>

        <Button
          label="Send a parcel"
          onPress={() => router.push('/send')}
          style={{ marginTop: spacing.lg }}
        />
        <Button
          label="I'm travelling — carry a parcel"
          variant="secondary"
          onPress={() => router.push('/trips/new')}
          style={{ marginTop: spacing.sm, backgroundColor: 'transparent', borderColor: '#3b4f70' }}
        />
      </View>

      {status === 'signed_in' ? (
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
          Signed in as {user?.name ?? (user?.phone_last4 ? `…${user.phone_last4}` : 'you')}.
        </AppText>
      ) : (
        <Card style={{ marginTop: spacing.md }}>
          <AppText variant="subheading">New to Parcel Yatra?</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
            Sign in with a phone code to post a parcel or publish a trip. Your bookings stay on your account.
          </AppText>
          <Button
            label="Sign in"
            variant="secondary"
            onPress={() => router.push({ pathname: '/sign-in', params: { next: '/send' } })}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      )}

      <SectionTitle title="What can travel" style={{ marginTop: spacing.xl }} />
      <Card>
        {config.isLoading ? (
          <LoadingBlock lines={2} />
        ) : config.isError ? (
          <ErrorNotice error={config.error} onRetry={() => void config.refetch()} />
        ) : (
          <>
            <Row style={{ flexWrap: 'wrap', gap: spacing.sm }}>
              {(config.data?.categories ?? []).map((category) => (
                <Pressable
                  key={category}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/send', params: { category } })}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.line,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: 7,
                    backgroundColor: colors.surface,
                  }}
                >
                  <AppText variant="small">{categoryLabel(category)}</AppText>
                </Pressable>
              ))}
            </Row>
            <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
              Up to {config.data?.limits.max_weight_kg ?? 5} kg and{' '}
              {inr(config.data?.limits.max_declared_value_paise ?? 500_000)} declared value. No cash, jewellery,
              medicines, food, lithium batteries or live animals.
            </AppText>
          </>
        )}
      </Card>

      <SectionTitle title="How it works" style={{ marginTop: spacing.xl }} />
      <Card>
        <Step number="1" title="Post the parcel" body="City to city, with a pickup window and what is inside." />
        <Step number="2" title="Choose a traveller" body="See who is already going, how verified they are, and the price before you book." />
        <Step number="3" title="Hand over with a code" body="One code at pickup, another at delivery. The chat stays with the booking." />
      </Card>

      {status === 'signed_in' ? (
        <View style={{ marginTop: spacing.xl }}>
          <SectionTitle
            title="Your bookings"
            actionLabel="See all"
            onAction={() => router.push('/bookings')}
          />
          {bookings.isLoading ? (
            <Card>
              <LoadingBlock lines={3} />
            </Card>
          ) : bookings.isError ? (
            <ErrorNotice error={bookings.error} onRetry={() => void bookings.refetch()} />
          ) : recent.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing booked yet"
                body="When you send a parcel or carry one, it appears here."
                actionLabel="Send a parcel"
                onAction={() => router.push('/send')}
              />
            </Card>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {recent.map((booking) => (
                <Card key={booking.id} onPress={() => router.push(`/bookings/${booking.id}`)} style={{ padding: spacing.md }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <AppText variant="subheading">
                      {booking.origin_city} → {booking.dest_city}
                    </AppText>
                    <Badge label={statusLabel(booking.status)} tone={statusTone(booking.status)} />
                  </Row>
                  <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
                    <AppText variant="small" tone="muted">
                      {booking.role === 'sender' ? 'You sent' : 'You carried'} · {categoryLabel(booking.category)}
                    </AppText>
                    <AppText variant="small" style={{ fontFamily: font.semibold }}>
                      {inr(booking.agreed_total_paise)}
                    </AppText>
                  </Row>
                </Card>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <Row gap={spacing.md} style={{ alignItems: 'flex-start', marginBottom: spacing.md }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: '#eaf1ff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText variant="small" tone="brand" style={{ fontFamily: font.bold }}>
          {number}
        </AppText>
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="subheading">{title}</AppText>
        <AppText variant="small" tone="muted">
          {body}
        </AppText>
      </View>
    </Row>
  );
}
