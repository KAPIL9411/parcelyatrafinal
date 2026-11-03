import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { senderApi, travellerApi } from '../../src/api/client.ts';
import { AuthGate } from '../../src/components/auth-gate.tsx';
import {
  AppText,
  Banner,
  Button,
  Card,
  Checkbox,
  DateTimeField,
  ErrorNotice,
  Field,
  LoadingBlock,
  PickerSheet,
  Row,
  Screen,
  SelectField,
} from '../../src/components/ui.tsx';
import { InfoNote, StickyBar } from '../../src/components/kit.tsx';
import { useCities } from '../../src/lib/cities.ts';
import {
  formatDateTime,
  kg,
  modeLabel,
  verificationReason,
} from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

export default function NewTripScreen() {
  return (
    <AuthGate next="/trips/new">
      <PublishTrip />
    </AuthGate>
  );
}

function tomorrowAt(hour: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function PublishTrip() {
  const cities = useCities();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: senderApi.config, staleTime: 10 * 60_000 });
  const verification = useQuery({ queryKey: ['verification'], queryFn: travellerApi.verification });

  const defaultDeparture = useMemo(() => tomorrowAt(9), []);
  const defaultArrival = useMemo(() => tomorrowAt(18), []);

  const [originId, setOriginId] = useState('');
  const [destId, setDestId] = useState('');
  const [originArea, setOriginArea] = useState('');
  const [departure, setDeparture] = useState<Date>(defaultDeparture);
  const [arrival, setArrival] = useState<Date>(defaultArrival);
  const [capacity, setCapacity] = useState('5');
  const [documentsOnly, setDocumentsOnly] = useState(false);
  const [picker, setPicker] = useState<'origin' | 'dest' | 'area' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const areas = useQuery({
    queryKey: ['areas', originId],
    queryFn: () => senderApi.areas(originId),
    enabled: Boolean(originId),
    staleTime: 10 * 60_000,
  });

  const state = verification.data?.state ?? 'not_started';
  const verified = state === 'verified';
  const modes = config.data?.modes ?? ['car'];

  const cityOptions = cities.serviceable.map((city) => ({
    value: city.id,
    label: city.name,
    meta: city.state,
  }));

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!originId) next.origin = 'Choose the city you are leaving from.';
    if (!destId) next.dest = 'Choose the city you are going to.';
    if (originId && originId === destId) next.dest = 'Origin and destination must differ.';
    if (departure.getTime() < Date.now() - 60_000) next.departure = 'Departure cannot be in the past.';
    if (arrival <= departure) next.arrival = 'Arrival must be after departure.';
    const kgValue = Number(capacity);
    if (!Number.isFinite(kgValue) || kgValue <= 0 || kgValue > 20) {
      next.capacity = 'Capacity must be between 0.5 and 20 kg.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function publish() {
    if (!validate()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const created = await travellerApi.createTrip({
        origin_city_id: originId,
        dest_city_id: destId,
        ...(originArea.trim().length >= 2 ? { origin_area: originArea.trim() } : {}),
        mode: modes[0] ?? 'car',
        departure_at: departure.toISOString(),
        arrival_estimate_at: arrival.toISOString(),
        capacity_kg: Number(capacity),
        accepts_documents_only: documentsOnly,
      });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      router.replace(`/trips/${created.id}`);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  }

  if (verification.isLoading) {
    return (
      <Screen>
        <Card>
          <LoadingBlock lines={3} />
        </Card>
      </Screen>
    );
  }

  if (verification.isError) {
    return (
      <Screen>
        <ErrorNotice error={verification.error} onRetry={() => void verification.refetch()} />
      </Screen>
    );
  }

  if (!verified) {
    return (
      <Screen>
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
              width: 160,
              height: 160,
              borderRadius: 80,
              backgroundColor: 'rgba(255,255,255,0.10)',
              right: -55,
              top: -70,
            }}
          />
          <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                backgroundColor: 'rgba(255,255,255,0.16)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={state === 'pending' ? 'time' : state === 'rejected' ? 'alert-circle' : 'shield-checkmark'}
                size={24}
                color={colors.white}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="label" style={{ color: '#bfe9db', letterSpacing: 1.1 }}>
                PARTNER
              </AppText>
              <AppText variant="title" tone="white" style={{ marginTop: 3 }}>
                {state === 'pending'
                  ? 'Your verification is with our team'
                  : state === 'rejected'
                    ? 'Your last verification was not accepted'
                    : 'Verify your ID before publishing'}
              </AppText>
            </View>
          </Row>
          <AppText variant="small" style={{ color: '#d3ece4', marginTop: spacing.sm }}>
            {state === 'pending'
              ? 'Usually within 24 hours. A person checks your ID, and publishing stays locked until then.'
              : state === 'rejected'
                ? `${verificationReason(verification.data?.reason_code ?? null)} You can read the reason, then try once more.`
                : 'A person checks one photo ID and a selfie. It usually takes under 24 hours. We never ask for Aadhaar.'}
          </AppText>
        </View>

        <Card style={{ marginTop: spacing.md }}>
          {state === 'pending' ? (
            <Banner
              tone="warn"
              title="Nothing is published in the meantime"
              body="You can still post parcels and look around as a sender."
            />
          ) : (
            <InfoNote
              icon="lock-closed"
              title="Publishing stays locked until a person approves"
              body="Senders see your first name, your route and your verification badge — never your ID document."
            />
          )}

          <Button
            label={state === 'rejected' ? 'Review verification' : state === 'pending' ? 'See verification' : 'Start verification'}
            onPress={() => router.push('/verification')}
            style={{ marginTop: spacing.lg }}
          />
          <Button label="Contact support" variant="secondary" onPress={() => router.push('/help')} style={{ marginTop: spacing.sm }} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      footer={
        <StickyBar
          label="Your trip"
          value={originId && destId ? `${cities.name(originId)} → ${cities.name(destId)}` : 'Choose a route'}
          caption={`${formatDateTime(departure.toISOString())} · ${kg(Number(capacity) || 0)} of space`}
          buttonLabel="Publish trip"
          onPress={publish}
          loading={busy}
          disabled={!originId || !destId || !capacity}
        />
      }
    >
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
            width: 160,
            height: 160,
            borderRadius: 80,
            backgroundColor: 'rgba(255,255,255,0.10)',
            right: -55,
            top: -70,
          }}
        />
        <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.16)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="car-sport" size={24} color={colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: '#bfe9db', letterSpacing: 1.1 }}>
              PARTNER
            </AppText>
            <AppText variant="title" tone="white" style={{ marginTop: 3 }}>
              Publish a trip
            </AppText>
          </View>
        </Row>
        <AppText variant="small" style={{ color: '#d3ece4', marginTop: spacing.sm }}>
          Tell us the drive you are already making. Senders see the route, the time and the space — not your
          phone number.
        </AppText>
        <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: 'wrap' }}>
          <View style={heroPill}>
            <Ionicons name="car" size={11} color={colors.accent} />
            <AppText variant="micro" style={{ color: colors.white, fontFamily: font.regular }}>
              Car only at launch
            </AppText>
          </View>
          <View style={heroPill}>
            <Ionicons name="cube" size={11} color={colors.accent} />
            <AppText variant="micro" style={{ color: colors.white, fontFamily: font.regular }}>
              4 parcels a month
            </AppText>
          </View>
        </Row>
      </View>

      <View style={{ marginTop: spacing.md }}>
        <InfoNote
          icon="shield-checkmark"
          title="You choose every request"
          body="An offer is a flag, not a booking. The sender still chooses, and nothing is reserved until they do."
        />
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <AppText variant="heading">Where are you going?</AppText>

        <View style={{ marginTop: spacing.md }}>
          <SelectField
            label="Leaving from"
            value={originId ? cities.name(originId) : null}
            placeholder="Choose a city"
            onPress={() => setPicker('origin')}
            error={errors.origin}
          />
          <Field
            label="Area you are leaving from (optional)"
            value={originArea}
            onChangeText={setOriginArea}
            placeholder="e.g. Indiranagar"
            maxLength={80}
            hint="A neighbourhood is enough. We never ask for an exact address."
            error={errors.area}
            accessory={
              <Pressable onPress={() => setPicker('area')} hitSlop={8} disabled={!originId}>
                <AppText
                  variant="small"
                  tone={originId ? 'brand' : 'muted'}
                  style={{ fontFamily: font.semibold }}
                >
                  List
                </AppText>
              </Pressable>
            }
          />
          <SelectField
            label="Going to"
            value={destId ? cities.name(destId) : null}
            placeholder="Choose a city"
            onPress={() => setPicker('dest')}
            error={errors.dest}
          />
          <DateTimeField
            label="Departure"
            value={departure}
            onChange={(next) => {
              setDeparture(next);
              if (arrival <= next) setArrival(new Date(next.getTime() + 6 * 60 * 60_000));
            }}
            minimumDate={new Date()}
            error={errors.departure}
          />
          <DateTimeField
            label="Estimated arrival"
            value={arrival}
            onChange={setArrival}
            minimumDate={departure}
            error={errors.arrival}
            hint="Your honest estimate, not a promise."
          />
        </View>

        {cities.isError ? (
          <View style={{ marginBottom: spacing.md }}>
            <ErrorNotice error={cities.error} onRetry={() => void cities.refetch()} />
          </View>
        ) : null}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <AppText variant="heading">How much can you carry?</AppText>

        <Row gap={spacing.md} style={{ alignItems: 'flex-start', marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Capacity (kg)"
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="decimal-pad"
              placeholder="up to 20"
              error={errors.capacity}
              hint="Between 0.5 and 20 kg."
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Travel mode" value={modeLabel(modes[0] ?? 'car')} editable={false} />
          </View>
        </Row>

        <Checkbox
          checked={documentsOnly}
          onToggle={() => setDocumentsOnly((value) => !value)}
          label="I will carry documents only"
        />
        <AppText variant="small" tone="muted">
          Optional. It narrows the requests you receive to paper documents.
        </AppText>

        <View
          style={{
            backgroundColor: colors.canvas,
            borderRadius: radius.md,
            padding: spacing.md,
            marginTop: spacing.md,
          }}
        >
          <AppText variant="subheading">What you are agreeing to</AppText>
          <Agreement text="The parcel is sealed before you receive it, and you can refuse it at the door." />
          <Agreement text="You hand it to the named receiver only, against a six-digit code." />
          <Agreement text="You are not a courier service: four parcels per month is the launch limit." />
          <Agreement text="Your share is released after delivery, once the 72-hour problem window has passed." />
        </View>
      </Card>

      {submitError ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={submitError} />
        </View>
      ) : null}

      <PickerSheet
        visible={picker === 'origin' || picker === 'dest'}
        title={picker === 'dest' ? 'Destination city' : 'Origin city'}
        options={cityOptions}
        selected={picker === 'dest' ? destId : originId}
        onSelect={(value) => {
          if (picker === 'dest') setDestId(value);
          else {
            setOriginId(value);
            setOriginArea('');
          }
          setErrors({});
        }}
        onClose={() => setPicker(null)}
        emptyText={cities.isLoading ? 'Loading cities…' : 'No serviceable cities loaded.'}
      />

      <PickerSheet
        visible={picker === 'area'}
        title="Pickup areas"
        options={(areas.data?.items ?? []).map((area) => ({ value: area.name, label: area.name }))}
        selected={originArea}
        onSelect={setOriginArea}
        onClose={() => setPicker(null)}
        emptyText="No listed areas for this city. Type the area instead."
      />
    </Screen>
  );
}

const heroPill = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 5,
  backgroundColor: 'rgba(255,255,255,0.12)',
  borderRadius: radius.pill,
  paddingHorizontal: 10,
  paddingVertical: 5,
};

function Agreement({ text }: { text: string }) {
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
