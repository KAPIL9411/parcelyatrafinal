import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '../../src/api/http.ts';
import { senderApi } from '../../src/api/client.ts';
import type { MatchResult, Quote } from '../../src/api/types.ts';
import { AuthGate } from '../../src/components/auth-gate.tsx';
import { MatchCard } from '../../src/components/match-card.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  ErrorNotice,
  LoadingBlock,
  Refresh,
  Row,
  Screen,
  SectionTitle,
} from '../../src/components/ui.tsx';
import { Avatar, IconBubble, RouteTimeline } from '../../src/components/kit.tsx';
import { useCities } from '../../src/lib/cities.ts';
import {
  categoryLabel,
  formatDateTime,
  inr,
  kg,
  modeLabel,
  statusLabel,
  statusTone,
} from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

export default function ParcelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate next={`/parcels/${id}`}>
      <ParcelDetail parcelId={id} />
    </AuthGate>
  );
}

function ParcelDetail({ parcelId }: { parcelId: string }) {
  const queryClient = useQueryClient();
  const cities = useCities();
  const parcelQuery = useQuery({ queryKey: ['parcel', parcelId], queryFn: () => senderApi.parcel(parcelId) });
  const offersQuery = useQuery({
    queryKey: ['parcel-offers', parcelId],
    queryFn: () => senderApi.interests(parcelId),
  });

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchResult | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingError, setPricingError] = useState<unknown>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<unknown>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const parcel = parcelQuery.data;
  const offers = offersQuery.data?.items ?? [];
  const openForBooking = parcel && !parcel.booking_id && ['posted', 'matched'].includes(parcel.status);

  async function loadPricing() {
    if (!parcel) return;
    setPricingBusy(true);
    setPricingError(null);
    try {
      const [matchOutcome, quoteOutcome] = await Promise.allSettled([
        senderApi.matches(parcel.id),
        senderApi.quote(parcel.id),
      ]);
      if (matchOutcome.status === 'fulfilled') {
        setMatches(matchOutcome.value);
        setSelectedTrip((current) => current ?? matchOutcome.value.matches[0]?.trip_id ?? null);
      } else {
        setPricingError(matchOutcome.reason);
      }
      if (quoteOutcome.status === 'fulfilled') {
        setQuote(quoteOutcome.value);
        setQuoteId(quoteOutcome.value.id);
        setQuoteNote(null);
      } else {
        const reason = quoteOutcome.reason;
        if (reason instanceof ApiError && reason.code === 'CONFLICT' && typeof reason.details.quote_id === 'string') {
          setQuoteId(reason.details.quote_id);
          setQuoteNote('A price from a moment ago is still valid. The amount is confirmed on the booking.');
        } else if (!(reason instanceof ApiError && reason.code === 'NO_MATCH')) {
          setPricingError(reason);
        }
      }
    } finally {
      setPricingBusy(false);
    }
  }

  async function refreshQuote() {
    if (!parcel) return;
    setPricingError(null);
    try {
      const priced = await senderApi.quote(parcel.id);
      setQuote(priced);
      setQuoteId(priced.id);
      setQuoteNote(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT' && typeof err.details.quote_id === 'string') {
        setQuoteId(err.details.quote_id);
      } else {
        setPricingError(err);
      }
    }
  }

  async function book() {
    if (!parcel || !selectedTrip || !quoteId) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const created = await senderApi.book(parcel.id, selectedTrip, quoteId);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['parcels'] });
      queryClient.invalidateQueries({ queryKey: ['parcel', parcel.id] });
      router.replace(`/bookings/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'QUOTE_EXPIRED' || err.code === 'QUOTE_MISMATCH')) {
        await refreshQuote();
      }
      setBookingError(err);
    } finally {
      setBookingBusy(false);
    }
  }

  function confirmCancel() {
    if (!parcel) return;
    Alert.alert(
      'Cancel this parcel?',
      'Travellers who offered will no longer see it. A parcel with an active booking cannot be cancelled here.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel parcel',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCancelBusy(true);
              try {
                await senderApi.cancelParcel(parcel.id);
                await parcelQuery.refetch();
                queryClient.invalidateQueries({ queryKey: ['parcels'] });
              } catch (err) {
                Alert.alert('Could not cancel', err instanceof Error ? err.message : 'Try again.');
              } finally {
                setCancelBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (parcelQuery.isLoading) {
    return (
      <Screen>
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      </Screen>
    );
  }

  if (parcelQuery.isError || !parcel) {
    return (
      <Screen>
        <ErrorNotice error={parcelQuery.error} onRetry={() => void parcelQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <Refresh
          refreshing={parcelQuery.isRefetching || offersQuery.isRefetching}
          onRefresh={() => {
            void parcelQuery.refetch();
            void offersQuery.refetch();
          }}
        />
      }
    >
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.line,
          padding: spacing.lg,
        }}
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Row gap={spacing.sm}>
            <IconBubble name="cube" size={38} background={colors.accentSoft} color={colors.warn} iconSize={18} />
            <View>
              <AppText variant="label" tone="muted" style={{ letterSpacing: 0.8 }}>
                PARCEL
              </AppText>
              <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
                Posted {formatDateTime(parcel.created_at)}
              </AppText>
            </View>
          </Row>
          <Badge label={statusLabel(parcel.status)} tone={statusTone(parcel.status)} />
        </Row>

        <View style={{ marginTop: spacing.md }}>
          <RouteTimeline
            origin={parcel.origin_area}
            dest={parcel.dest_area}
            originMeta={[cities.city(parcel.origin_city_id)?.name, `Pickup ${formatDateTime(parcel.window_start)}`]
              .filter(Boolean)
              .join(' · ')}
            destMeta={[cities.city(parcel.dest_city_id)?.name, `By ${formatDateTime(parcel.window_end)}`]
              .filter(Boolean)
              .join(' · ')}
          />
        </View>

        <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: 'wrap' }}>
          <FactPill icon="pricetag-outline" text={categoryLabel(parcel.category)} />
          <FactPill icon="scale-outline" text={kg(parcel.weight_kg)} />
          <FactPill icon="cash-outline" text={inr(parcel.declared_value_paise)} />
        </Row>
      </View>

      <Card style={{ marginTop: spacing.md }}>
        <AppText variant="subheading">Shipment details</AppText>
        <View style={{ marginTop: spacing.sm }}>
          <DetailRow label="Category" value={categoryLabel(parcel.category)} />
          <DetailRow label="Weight" value={kg(parcel.weight_kg)} />
          <DetailRow label="Size" value={`${parcel.dims_cm.join(' × ')} cm`} />
          <DetailRow label="Declared value" value={inr(parcel.declared_value_paise)} />
          <DetailRow
            label="Pickup window"
            value={`${formatDateTime(parcel.window_start)} – ${formatDateTime(parcel.window_end)}`}
          />
          <DetailRow label="Contents" value={parcel.description} />
        </View>
      </Card>

      {parcel.review_required ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warn"
            title="A quick human check is in progress"
            body={parcel.review_reason ?? 'You will be notified when it clears.'}
          />
        </View>
      ) : null}

      {parcel.booking_id ? (
        <Card style={{ marginTop: spacing.md }}>
          <AppText variant="heading">A traveller is booked</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
            The booking holds this parcel. Status updates and the handover codes live there.
          </AppText>
          <Button
            label="Open booking"
            onPress={() => router.push(`/bookings/${parcel.booking_id}`)}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : null}

      <SectionTitle title={`Offers (${offers.length})`} style={{ marginTop: spacing.xl }} />
      <AppText variant="small" tone="muted" style={{ marginBottom: spacing.sm }}>
        An offer means a traveller can carry it. Nothing is committed until you book one of them.
      </AppText>
      {offers.length === 0 ? (
        <Card>
          <AppText variant="small" tone="muted">
            Nobody has offered yet. Travellers see this parcel in their trip’s opportunities when the route and
            space fit.
          </AppText>
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {offers.map((offer) => (
            <Card key={offer.trip_id} style={{ padding: spacing.md }}>
              <Row gap={spacing.sm} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Avatar name={offer.traveller_first_name} size={38} tone="partner" />
                <View style={{ flex: 1 }}>
                  <AppText variant="subheading">{offer.traveller_first_name ?? 'A traveller'}</AppText>
                  <AppText variant="small" tone="muted">
                    {modeLabel(offer.mode)} · {offer.verification_state === 'verified' ? 'ID verified' : 'ID not verified'} ·{' '}
                    {kg(offer.capacity_kg_remaining)} free
                  </AppText>
                  <AppText variant="small" tone="muted">
                    Departs {formatDateTime(offer.departure_at)}
                  </AppText>
                </View>
                <Badge
                  label={offer.verification_state === 'verified' ? 'Verified' : 'Unverified'}
                  tone={offer.verification_state === 'verified' ? 'success' : 'warn'}
                />
              </Row>
            </Card>
          ))}
        </View>
      )}

      {openForBooking ? (
        <>
          <SectionTitle title="Book a traveller" style={{ marginTop: spacing.xl }} />
          {!matches && !quoteId ? (
            <Card>
              <AppText variant="small" tone="muted">
                Fetch the current price and everyone who fits this route and window. The quote is fixed for a short
                window.
              </AppText>
              <Button
                label="See price and travellers"
                onPress={() => void loadPricing()}
                loading={pricingBusy}
                style={{ marginTop: spacing.md }}
              />
              {pricingError ? (
                <View style={{ marginTop: spacing.md }}>
                  <ErrorNotice error={pricingError} onRetry={() => void loadPricing()} />
                </View>
              ) : null}
            </Card>
          ) : (
            <>
              {quote ? (
                <Card>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <AppText variant="heading">Price</AppText>
                    <AppText variant="title" tone="brand">
                      {inr(quote.total_paise)}
                    </AppText>
                  </Row>
                  <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                    Fixed until {formatDateTime(quote.expires_at)}.
                  </AppText>
                </Card>
              ) : (
                <Card>
                  <AppText variant="subheading">Price already fixed</AppText>
                  <AppText variant="small" tone="muted">
                    {quoteNote ?? 'The amount is confirmed on the booking.'}
                  </AppText>
                </Card>
              )}

              {pricingError ? (
                <View style={{ marginTop: spacing.sm }}>
                  <ErrorNotice error={pricingError} onRetry={() => void refreshQuote()} />
                </View>
              ) : null}

              {matches && matches.matches.length === 0 ? (
                <Card style={{ marginTop: spacing.sm }}>
                  <AppText variant="subheading">No traveller fits right now</AppText>
                  <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                    {matches.no_match_reasons.length
                      ? matches.no_match_reasons.join(' ')
                      : 'Widen the window, or wait for a new trip on this route.'}
                  </AppText>
                  <Button
                    label="Check again"
                    variant="secondary"
                    onPress={() => void loadPricing()}
                    loading={pricingBusy}
                    style={{ marginTop: spacing.md }}
                  />
                </Card>
              ) : null}

              {matches && matches.matches.length > 0 ? (
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  {matches.matches.map((match) => (
                    <MatchCard
                      key={match.trip_id}
                      match={match}
                      selected={selectedTrip === match.trip_id}
                      onSelect={() => setSelectedTrip(match.trip_id)}
                    />
                  ))}
                </View>
              ) : null}

              {bookingError ? (
                <View style={{ marginTop: spacing.sm }}>
                  <ErrorNotice error={bookingError} />
                </View>
              ) : null}

              <Button
                label={selectedTrip ? 'Book this traveller' : 'Choose a traveller'}
                onPress={book}
                loading={bookingBusy}
                disabled={!selectedTrip || !quoteId}
                style={{ marginTop: spacing.lg }}
              />
            </>
          )}
        </>
      ) : null}

      {!parcel.booking_id && parcel.status === 'posted' ? (
        <Button
          label="Cancel this parcel"
          variant="tertiary"
          onPress={confirmCancel}
          loading={cancelBusy}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 4 }}>
      <AppText variant="small" tone="muted" style={{ width: 120 }}>
        {label}
      </AppText>
      <AppText variant="small" style={{ flex: 1, textAlign: 'right', fontFamily: font.semibold }}>
        {value}
      </AppText>
    </Row>
  );
}

function FactPill({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.canvas,
        borderRadius: radius.pill,
        paddingHorizontal: 9,
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
