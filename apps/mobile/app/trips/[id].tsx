import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../../src/api/http.ts';
import { senderApi, travellerApi } from '../../src/api/client.ts';
import type { Opportunity, Trip } from '../../src/api/types.ts';
import { AuthGate } from '../../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  DateTimeField,
  Divider,
  EmptyState,
  ErrorNotice,
  Field,
  LoadingBlock,
  Refresh,
  Row,
  Screen,
  Sheet,
} from '../../src/components/ui.tsx';
import { useCities } from '../../src/lib/cities.ts';
import {
  categoryLabel,
  formatDateTime,
  formatWindow,
  inr,
  kg,
  matchReasonLabel,
  modeLabel,
  statusLabel,
  statusTone,
} from '../../src/lib/format.ts';
import { colors, font, spacing } from '../../src/theme.ts';

/** Mirrors the server's sets in `apps/api/src/routes/trips.ts`. */
const LIVE_TRIP_STATUSES = new Set(['published', 'partially_booked']);
const EDITABLE_TRIP_STATUSES = new Set(['published', 'partially_booked', 'full']);

export default function TripScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return (
    <AuthGate next={`/trips/${id ?? ''}`}>
      {id ? <TripDetail id={id} /> : null}
    </AuthGate>
  );
}

function TripDetail({ id }: { id: string }) {
  const cities = useCities();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);

  const trip = useQuery({ queryKey: ['trip', id], queryFn: () => travellerApi.trip(id) });
  const live = LIVE_TRIP_STATUSES.has(trip.data?.status ?? '');

  const opportunities = useQuery({
    queryKey: ['trip-opportunities', id],
    queryFn: () => travellerApi.opportunities(id),
    enabled: live,
    refetchInterval: 60_000,
  });

  async function offer(parcel: Opportunity) {
    setOfferBusy(parcel.parcel_id);
    setOfferError(null);
    try {
      await travellerApi.offer(id, parcel.parcel_id);
      await queryClient.invalidateQueries({ queryKey: ['trip-opportunities', id] });
    } catch (err) {
      // The list was probably built a moment before someone else acted. Name the gate if it has one.
      const reason = err instanceof ApiError ? String(err.details.reason ?? err.code) : '';
      setOfferError(
        reason === 'NO_CAPACITY'
          ? `That parcel is ${kg(parcel.weight_kg)} and you have ${kg(trip.data?.capacity_kg_remaining ?? 0)} left.`
          : reason === 'PARCEL_ALREADY_ASSIGNED'
            ? 'A sender has already booked that parcel.'
            : matchReasonLabel(reason || 'PARCEL_NOT_OPEN'),
      );
      await queryClient.invalidateQueries({ queryKey: ['trip-opportunities', id] });
    } finally {
      setOfferBusy(null);
    }
  }

  async function cancelTrip() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await travellerApi.cancelTrip(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trip', id] }),
        queryClient.invalidateQueries({ queryKey: ['trips'] }),
        queryClient.invalidateQueries({ queryKey: ['trip-opportunities', id] }),
      ]);
      setCancelling(false);
    } catch (err) {
      setCancelError(err);
    } finally {
      setCancelBusy(false);
    }
  }

  if (trip.isLoading) {
    return (
      <Screen>
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      </Screen>
    );
  }

  if (trip.isError || !trip.data) {
    return (
      <Screen>
        <ErrorNotice error={trip.error ?? new Error('This trip could not be loaded.')} onRetry={() => void trip.refetch()} />
        <Button label="Back to trips" variant="secondary" onPress={() => router.replace('/trips')} style={{ marginTop: spacing.md }} />
      </Screen>
    );
  }

  const row = trip.data;
  const editable = EDITABLE_TRIP_STATUSES.has(row.status);
  const items = opportunities.data?.items ?? [];
  const blockedTotal = Object.values(opportunities.data?.blocked_counts ?? {}).reduce((sum, count) => sum + count, 0);

  return (
    <Screen
      refreshControl={
        <Refresh
          refreshing={trip.isRefetching || opportunities.isRefetching}
          onRefresh={() => {
            void trip.refetch();
            if (live) void opportunities.refetch();
          }}
        />
      }
    >
      <Card>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="title">
              {cities.name(row.origin_city_id)} → {cities.name(row.dest_city_id)}
            </AppText>
            <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
              {modeLabel(row.mode)} · departs {formatDateTime(row.departure_at)}
            </AppText>
          </View>
          <Badge label={statusLabel(row.status)} tone={statusTone(row.status)} />
        </Row>

        {row.status === 'cancelled' ? (
          <View style={{ marginTop: spacing.md }}>
            <Banner tone="danger" title="This trip was cancelled" body="Senders can no longer see it." />
          </View>
        ) : null}

        <View style={{ marginTop: spacing.md, gap: 6 }}>
          <DetailRow label="Arrives" value={formatDateTime(row.arrival_estimate_at)} />
          <DetailRow label="Space offered" value={kg(row.capacity_kg)} />
          <DetailRow label="Space left" value={kg(row.capacity_kg_remaining)} />
          <DetailRow label="Meeting point" value={row.origin_area ?? 'Not named'} />
          <DetailRow
            label="Parcels"
            value={row.accepts_documents_only ? 'Documents only' : 'Any eligible item'}
          />
        </View>

        {editable ? (
          <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <Button label="Change trip" variant="secondary" onPress={() => setEditing(true)} />
            </View>
            {row.status === 'published' ? (
              <View style={{ flex: 1 }}>
                <Button label="Cancel trip" variant="danger" onPress={() => setCancelling(true)} />
              </View>
            ) : null}
          </Row>
        ) : null}
      </Card>

      {live ? (
        <Card style={{ marginTop: spacing.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText variant="heading">Parcels on this route</AppText>
            {opportunities.isSuccess && items.length > 0 ? (
              <AppText variant="small" tone="muted">
                {items.length} fit{blockedTotal > 0 ? ` · ${blockedTotal} do not` : ''}
              </AppText>
            ) : null}
          </Row>

          <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
            Produced by the same engine senders see. An offer is a flag, not a booking — the sender still
            chooses, and nothing is reserved or charged.
          </AppText>

          {offerError ? (
            <View style={{ marginTop: spacing.md }}>
              <Banner tone="warn" title="That offer was refused" body={offerError} />
            </View>
          ) : null}

          <View style={{ marginTop: spacing.md }}>
            {opportunities.isLoading ? (
              <LoadingBlock lines={3} />
            ) : opportunities.isError ? (
              <ErrorNotice error={opportunities.error} onRetry={() => void opportunities.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                title="Nothing on this route fits your trip"
                body={
                  opportunities.data?.no_match_reasons[0]
                    ? matchReasonLabel(opportunities.data.no_match_reasons[0])
                    : 'No parcel currently passes the route, timing and capacity checks for this trip.'
                }
                actionLabel="Check again"
                onAction={() => void opportunities.refetch()}
              />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {items.map((parcel) => (
                  <OpportunityCard
                    key={parcel.parcel_id}
                    parcel={parcel}
                    busy={offerBusy === parcel.parcel_id}
                    onOffer={() => void offer(parcel)}
                  />
                ))}
              </View>
            )}
          </View>
        </Card>
      ) : (
        <Card style={{ marginTop: spacing.md }}>
          <AppText variant="subheading">No open work on this trip</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
            {row.status === 'full'
              ? 'Every kilogram is booked. Add space from “Change trip” if you can carry more.'
              : 'Only published and partly booked trips can be offered parcels.'}
          </AppText>
        </Card>
      )}

      <Card style={{ marginTop: spacing.md, backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
        <AppText variant="subheading">What carrying involves</AppText>
        <Bullet text="You carry a sealed parcel in your own vehicle, on a journey you were already making." />
        <Bullet text="You can refuse at the door if the seal is broken or the weight does not match. No penalty." />
        <Bullet text="You mark arrival yourself. There is no live tracking of your phone." />
        <Bullet text="Your share is released after delivery, once the 72-hour problem window has passed." />
      </Card>

      {editing ? (
        <TripEditSheet
          trip={row}
          onClose={() => setEditing(false)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['trip', id] });
            void queryClient.invalidateQueries({ queryKey: ['trips'] });
            void queryClient.invalidateQueries({ queryKey: ['trip-opportunities', id] });
          }}
        />
      ) : null}

      <Sheet visible={cancelling} onClose={() => setCancelling(false)} title="Cancel this trip?">
        <AppText variant="body">
          Senders will no longer see this trip. If a parcel is already booked on it, we will not let you
          cancel here — cancel the booking first, or contact support.
        </AppText>
        {cancelError ? (
          <View style={{ marginTop: spacing.md }}>
            <ErrorNotice error={cancelError} />
          </View>
        ) : null}
        <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <Button label="Keep trip" variant="secondary" onPress={() => setCancelling(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Cancel trip" variant="danger" loading={cancelBusy} onPress={cancelTrip} />
          </View>
        </Row>
      </Sheet>
    </Screen>
  );
}

function OpportunityCard({
  parcel,
  busy,
  onOffer,
}: {
  parcel: Opportunity;
  busy: boolean;
  onOffer: () => void;
}) {
  const tone = parcel.band === 'excellent' ? 'success' : parcel.band === 'good' ? 'info' : 'neutral';
  return (
    <Card style={{ padding: spacing.md, backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>
            <Badge label={parcel.band} tone={tone} />
            <Badge
              label={parcel.sender_verified ? 'Sender verified' : 'Sender not verified'}
              tone={parcel.sender_verified ? 'success' : 'neutral'}
            />
            {parcel.offered ? <Badge label="Offered" tone="info" /> : null}
          </Row>
          <AppText variant="subheading" style={{ marginTop: spacing.sm }}>
            {categoryLabel(parcel.category)} · {kg(parcel.weight_kg)}
          </AppText>
          <AppText variant="small" tone="muted">
            {parcel.origin_area} → {parcel.dest_area}
          </AppText>
          <AppText variant="small" style={{ marginTop: 2 }}>
            Window {formatWindow(parcel.window_start, parcel.window_end)}
          </AppText>
        </View>
      </Row>

      <Divider style={{ marginVertical: spacing.sm }} />

      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="small" style={{ fontFamily: font.semibold }}>
            Sender pays ~{inr(parcel.indicative_price_paise)}
          </AppText>
          <AppText variant="small" tone="muted">
            Your share is set when a sender books you.
          </AppText>
        </View>
        {parcel.offered ? (
          <AppText variant="small" tone="muted">
            The sender has been told.
          </AppText>
        ) : (
          <Button label="Offer to carry" size="sm" fullWidth={false} loading={busy} onPress={onOffer} />
        )}
      </Row>
    </Card>
  );
}

function TripEditSheet({
  trip,
  onClose,
  onSaved,
}: {
  trip: Trip;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [departure, setDeparture] = useState(new Date(trip.departure_at));
  const [arrival, setArrival] = useState(new Date(trip.arrival_estimate_at));
  const [capacity, setCapacity] = useState(String(trip.capacity_kg));
  const [area, setArea] = useState(trip.origin_area ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<{ rechecked: number } | null>(null);

  const areas = useQuery({    queryKey: ['areas', trip.origin_city_id],
    queryFn: () => senderApi.areas(trip.origin_city_id),
    staleTime: 10 * 60_000,
  });

  const booked = Math.max(0, trip.capacity_kg - trip.capacity_kg_remaining);

  function buildPatch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (departure.getTime() !== new Date(trip.departure_at).getTime()) {
      patch.departure_at = departure.toISOString();
    }
    if (arrival.getTime() !== new Date(trip.arrival_estimate_at).getTime()) {
      patch.arrival_estimate_at = arrival.toISOString();
    }
    const nextCapacity = Number(capacity);
    if (capacity.trim() !== '' && Number.isFinite(nextCapacity) && nextCapacity !== trip.capacity_kg) {
      patch.capacity_kg = nextCapacity;
    }
    const nextArea = area.trim();
    if (nextArea !== (trip.origin_area ?? '')) patch.origin_area = nextArea === '' ? null : nextArea;
    return patch;
  }

  async function save() {
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setError(
        new ApiError('VALIDATION_FAILED', 'Nothing has changed yet.', 400, null, { reason: 'nothing_to_change' }),
      );
      return;
    }
    if (arrival <= departure) {
      setError(new ApiError('TRIP_WINDOW_INVALID', 'Arrival must be after departure.', 400));
      return;
    }
    if (departure.getTime() < Date.now() - 60_000) {
      setError(new ApiError('TRIP_WINDOW_INVALID', 'Departure cannot be in the past.', 400));
      return;
    }
    const nextCapacity = Number(capacity);
    if (!Number.isFinite(nextCapacity) || nextCapacity <= 0 || nextCapacity > 20) {
      setError(new ApiError('TRIP_CAPACITY_INVALID', 'Capacity must be between 0.5 and 20 kg.', 400));
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const updated = await travellerApi.updateTrip(trip.id, patch);
      const rechecked = (updated as Trip & { bookings_rechecked?: number }).bookings_rechecked ?? 0;
      setSaved({ rechecked });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const areaOptions = (areas.data?.items ?? []).map((item) => item.name);
  const areaHint =
    area.length > 0 && !areaOptions.includes(area)
      ? 'Not in the city list. A nearby neighbourhood is fine, and we never ask for an exact address.'
      : 'A neighbourhood is enough. We never ask for an exact address.';

  return (
    <Sheet visible onClose={onClose} title="Change this trip" scroll>
      <AppText variant="small" tone="muted">
        {booked > 0
          ? `You are already carrying ${kg(booked)} on this trip. We check every booked parcel before saving, so a change that would leave one stranded is refused and nothing is written.`
          : 'Nothing is booked on this trip yet, so you can change the times, the space or the meeting point freely.'}
      </AppText>

      {saved ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="success"
            title="Saved"
            body={
              saved.rechecked === 0
                ? 'No parcel was booked on it, so nothing needed re-checking.'
                : `${saved.rechecked} booked ${saved.rechecked === 1 ? 'parcel still fits' : 'parcels still fit'}. ${
                    saved.rechecked === 1 ? 'Its sender was' : 'Their senders were'
                  } told if the timing moved.`
            }
          />
        </View>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <DateTimeField
          label="Departure"
          value={departure}
          onChange={(next) => {
            setDeparture(next);
            if (arrival <= next) setArrival(new Date(next.getTime() + 6 * 60 * 60_000));
          }}
        />
        <DateTimeField label="Estimated arrival" value={arrival} onChange={setArrival} minimumDate={departure} />
        <Field
          label="Capacity (kg)"
          value={capacity}
          onChangeText={setCapacity}
          keyboardType="decimal-pad"
          hint={booked > 0 ? `Between ${kg(booked)} and 20 kg.` : 'Between 0.5 and 20 kg.'}
        />
        <Field
          label="Meeting point"
          value={area}
          onChangeText={setArea}
          placeholder={`e.g. ${areas.data?.items[0]?.name ?? 'Indiranagar'}`}
          maxLength={80}
          hint={areaHint}
        />
      </View>

      {error ? (
        <View style={{ marginTop: spacing.sm }}>
          <ErrorNotice error={error} />
        </View>
      ) : null}

      <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button label={saved ? 'Done' : 'Keep as is'} variant="secondary" onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Save changes" loading={busy} onPress={save} />
        </View>
      </Row>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <AppText variant="small" tone="muted">
        {label}
      </AppText>
      <AppText variant="small" style={{ fontFamily: font.semibold, flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </Row>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <Row gap={spacing.sm} style={{ alignItems: 'flex-start', marginTop: 6 }}>
      <AppText variant="small" tone="brand">
        •
      </AppText>
      <AppText variant="small" style={{ flex: 1 }}>
        {text}
      </AppText>
    </Row>
  );
}
