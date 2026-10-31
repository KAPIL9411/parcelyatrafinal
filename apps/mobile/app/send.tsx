import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ApiError } from '../src/api/http.ts';
import { filesApi, senderApi } from '../src/api/client.ts';
import type { MatchResult, Parcel, Quote } from '../src/api/types.ts';
import { AuthGate } from '../src/components/auth-gate.tsx';
import { MatchCard } from '../src/components/match-card.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  DateTimeField,
  Divider,
  EmptyState,
  ErrorNotice,
  Field,
  LoadingBlock,
  PickerSheet,
  Row,
  Screen,
  SectionTitle,
} from '../src/components/ui.tsx';
import {
  Chip,
  IconBubble,
  InfoNote,
  MapCanvas,
  RouteTimeline,
  StickyBar,
} from '../src/components/kit.tsx';
import { useCities } from '../src/lib/cities.ts';
import { capturePhoto } from '../src/lib/photo.ts';
import { categoryLabel, formatDateTime, inr, kg, normalisePhone } from '../src/lib/format.ts';
import { colors, font, radius, spacing } from '../src/theme.ts';

const CATEGORY_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  documents: 'document-text-outline',
  educational_certificates: 'school-outline',
  business_samples: 'briefcase-outline',
  spare_parts_dry: 'construct-outline',
  cosmetics_sealed: 'sparkles-outline',
  printed_material: 'newspaper-outline',
  religious_items: 'flower-outline',
  keys: 'key-outline',
  electronics_accessories_low_value: 'headset-outline',
};

export default function SendScreen() {
  return (
    <AuthGate next="/send">
      <SendWizard />
    </AuthGate>
  );
}

function startOfTomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date;
}

function todayIn(hours: number): Date {
  const date = new Date();
  date.setHours(date.getHours() + hours, 0, 0, 0);
  return date;
}

function SendWizard() {
  const params = useLocalSearchParams<{ category?: string; origin?: string; dest?: string }>();
  const cities = useCities();
  const config = useQuery({ queryKey: ['config'], queryFn: senderApi.config, staleTime: 10 * 60_000 });
  const queryClient = useQueryClient();

  const defaultStart = useMemo(startOfTomorrow, []);
  const defaultEnd = useMemo(() => new Date(startOfTomorrow().getTime() + 6 * 60 * 60 * 1000), []);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [picker, setPicker] = useState<'origin' | 'dest' | 'originArea' | 'destArea' | 'category' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<'today' | 'tomorrow' | 'custom'>('tomorrow');

  const [originId, setOriginId] = useState('');
  const [destId, setDestId] = useState('');
  const [originArea, setOriginArea] = useState('');
  const [destArea, setDestArea] = useState('');
  const [windowStart, setWindowStart] = useState<Date>(defaultStart);
  const [windowEnd, setWindowEnd] = useState<Date>(defaultEnd);

  const [category, setCategory] = useState(
    typeof params.category === 'string' ? params.category : 'documents',
  );
  const [description, setDescription] = useState('');
  // Prefilled so the fast path is two taps: a typical document parcel already has sane numbers and
  // the user only edits them when their parcel is unusual. Nothing here is hidden — every value is
  // visible and editable in the form.
  const [weightKg, setWeightKg] = useState('0.5');
  const [dims, setDims] = useState(['20', '15', '10']);
  const [declaredRupees, setDeclaredRupees] = useState('1000');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<unknown>(null);
  const [declaration, setDeclaration] = useState(false);

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [matches, setMatches] = useState<MatchResult | null>(null);
  const [matchError, setMatchError] = useState<unknown>(null);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<unknown>(null);

  /**
   * Back inside a wizard is a step, not an exit. Step 2 returns to the route; step 1 asks before
   * throwing away typing; step 3 is left alone because the parcel already exists and re-entering the
   * form could post a duplicate.
   *
   * `beforeRemove` is a React Navigation stack event that expo-router's generic navigation type does
   * not surface, so the handler is typed here against the part of the contract this screen uses.
   */
  const navigation = useNavigation() as unknown as {
    addListener: (
      event: 'beforeRemove',
      handler: (event: { preventDefault: () => void; data: { action: { type: string } } }) => void,
    ) => () => void;
    dispatch: (action: { type: string }) => void;
  };
  const leaving = useRef(false);
  const dirty = Boolean(
    originId || destId || originArea || destArea || description.trim() || receiverName.trim() || receiverPhone.trim(),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      const actionType = event.data.action.type;
      if (actionType !== 'GO_BACK' && actionType !== 'POP') return;
      if (step === 2) {
        event.preventDefault();
        setStep(1);
        return;
      }
      if (step !== 1 || !dirty) return;
      event.preventDefault();
      Alert.alert('Discard this parcel?', 'Nothing has been posted yet, so your details will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            navigation.dispatch(event.data.action);
          },
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, step, dirty]);

  /**
   * A link from the homepage may name a city rather than an id ("Bareilly"), because the homepage is
   * content, not a form. Resolve it once, against the live city list, and only if the user has not
   * already chosen something. A name that no longer matches anything is ignored rather than guessed.
   */
  const appliedParams = useRef(false);
  useEffect(() => {
    if (appliedParams.current || cities.cities.length === 0) return;
    appliedParams.current = true;

    const resolve = (value: string | undefined) => {
      if (typeof value !== 'string') return undefined;
      const needle = value.trim().toLowerCase();
      if (!needle) return undefined;
      return (
        cities.cities.find((city) => city.name.toLowerCase() === needle) ??
        cities.cities.find((city) => city.name.toLowerCase().startsWith(needle))
      );
    };

    const from = resolve(params.origin);
    const to = resolve(params.dest);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (from) setOriginId((current) => current || from.id);
    if (to) setDestId((current) => current || to.id);
  }, [cities.cities, params.origin, params.dest]);

  const originAreas = useQuery({
    queryKey: ['areas', originId],
    queryFn: () => senderApi.areas(originId),
    enabled: Boolean(originId),
    staleTime: 10 * 60_000,
  });
  const destAreas = useQuery({
    queryKey: ['areas', destId],
    queryFn: () => senderApi.areas(destId),
    enabled: Boolean(destId),
    staleTime: 10 * 60_000,
  });

  const categories = config.data?.categories ?? [];
  const maxWeight = config.data?.limits.max_weight_kg ?? 5;
  const maxValue = config.data?.limits.max_declared_value_paise ?? 500_000;
  const maxDim = config.data?.limits.max_dimension_cm ?? 45;

  function fail(field: string, message: string, next: Record<string, string>) {
    next[field] = message;
  }

  function validateRoute(): boolean {
    const next: Record<string, string> = {};
    if (!originId) fail('origin', 'Choose where the parcel starts.', next);
    if (!destId) fail('dest', 'Choose where it is going.', next);
    if (originId && originId === destId) fail('dest', 'Origin and destination must differ.', next);
    if (originArea.trim().length < 2) fail('originArea', 'Name the pickup area.', next);
    if (destArea.trim().length < 2) fail('destArea', 'Name the delivery area.', next);
    if (windowStart.getTime() < Date.now() - 60_000) fail('windowStart', 'Pickup cannot be in the past.', next);
    if (windowEnd <= windowStart) fail('windowEnd', 'Delivery must be after pickup.', next);
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateParcel(): boolean {
    const next: Record<string, string> = {};
    if (!categories.includes(category)) fail('category', 'Choose a category.', next);
    if (description.trim().length < 5) fail('description', 'Say what is inside in a few words.', next);
    const weight = Number(weightKg);
    if (!Number.isFinite(weight) || weight <= 0 || weight > maxWeight) {
      fail('weight', `Between 0.1 and ${maxWeight} kg.`, next);
    }
    const parsedDims = dims.map((value) => Math.round(Number(value)));
    if (parsedDims.some((value) => !Number.isFinite(value) || value < 1 || value > maxDim)) {
      fail('dims', `Each side must be between 1 and ${maxDim} cm.`, next);
    }
    const rupees = Number(declaredRupees);
    if (!Number.isFinite(rupees) || rupees < 1 || rupees * 100 > maxValue) {
      fail('declared', `Between ₹1 and ${inr(maxValue)}.`, next);
    }
    if (receiverName.trim().length < 2) fail('receiverName', "Enter the receiver's name.", next);
    if (!normalisePhone(receiverPhone)) fail('receiverPhone', 'Enter a valid Indian mobile number.', next);
    if (!declaration) fail('declaration', 'Confirm the parcel is not a prohibited item.', next);
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function attachPhoto() {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const picked = await capturePhoto();
      if (!picked) return;
      const uploaded = await filesApi.upload('parcel_sealed', picked.uri, picked.contentType);
      setPhotoKey(uploaded.object_key);
    } catch (err) {
      setPhotoError(err);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function postParcel() {
    if (!validateParcel()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const created = await senderApi.createParcel({
        origin_city_id: originId,
        dest_city_id: destId,
        origin_area: originArea.trim(),
        dest_area: destArea.trim(),
        category,
        description: description.trim(),
        weight_kg: Number(weightKg),
        dims_cm: dims.map((value) => Math.round(Number(value))),
        declared_value_paise: Math.round(Number(declaredRupees) * 100),
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        receiver_name: receiverName.trim(),
        receiver_phone: normalisePhone(receiverPhone),
        ...(photoKey ? { sealed_photo_key: photoKey } : {}),
        declaration_accepted: true,
      });
      setParcel(created);
      if (created.review_required) {
        setStep(3);
        return;
      }
      await loadPricing(created.id);
      setStep(3);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  }

  async function loadPricing(parcelId: string) {
    setMatchError(null);
    setQuoteError(null);
    setQuoteNote(null);
    setQuote(null);
    setQuoteId(null);

    const [matchOutcome, quoteOutcome] = await Promise.allSettled([
      senderApi.matches(parcelId),
      senderApi.quote(parcelId),
    ]);

    if (matchOutcome.status === 'fulfilled') {
      setMatches(matchOutcome.value);
      setSelectedTrip(matchOutcome.value.matches[0]?.trip_id ?? null);
    } else {
      setMatchError(matchOutcome.reason);
      setMatches(null);
    }

    if (quoteOutcome.status === 'fulfilled') {
      setQuote(quoteOutcome.value);
      setQuoteId(quoteOutcome.value.id);
    } else {
      const reason = quoteOutcome.reason;
      // A still-valid quote can already exist after a lost response. The API answers with its id;
      // the amount is fixed and shown on the booking once created.
      if (reason instanceof ApiError && reason.code === 'CONFLICT' && typeof reason.details.quote_id === 'string') {
        setQuoteId(reason.details.quote_id);
        setQuoteNote('A price is already fixed for this parcel from a moment ago. It will be shown on the booking.');
      } else if (!(reason instanceof ApiError && reason.code === 'NO_MATCH')) {
        setQuoteError(reason);
      }
    }
  }

  async function refreshQuote() {
    if (!parcel) return;
    setQuoteError(null);
    try {
      const priced = await senderApi.quote(parcel.id);
      setQuote(priced);
      setQuoteId(priced.id);
      setQuoteNote(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT' && typeof err.details.quote_id === 'string') {
        setQuoteId(err.details.quote_id);
      } else {
        setQuoteError(err);
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

  function applySchedule(next: 'today' | 'tomorrow' | 'custom') {
    setSchedule(next);
    setErrors({});
    if (next === 'today') {
      const start = todayIn(2);
      setWindowStart(start);
      setWindowEnd(new Date(start.getTime() + 8 * 60 * 60 * 1000));
    } else if (next === 'tomorrow') {
      const start = startOfTomorrow();
      setWindowStart(start);
      setWindowEnd(new Date(start.getTime() + 6 * 60 * 60 * 1000));
    }
  }

  const cityOptions = cities.serviceable.map((city) => ({
    value: city.id,
    label: city.name,
    meta: city.state,
  }));

  const footer =
    step === 1 ? (
      <StickyBar
        label="Route"
        value="City to city"
        caption="Pickup and delivery windows"
        buttonLabel="Continue"
        onPress={() => {
          if (validateRoute()) {
            setErrors({});
            setStep(2);
          }
        }}
      />
    ) : step === 2 ? (
      <StickyBar
        label="Parcel"
        value={weightKg ? `${weightKg} kg · ${inr(Math.round(Number(declaredRupees || 0) * 100))}` : 'Add details'}
        caption={`Limits: ${maxWeight} kg, ${inr(maxValue)} value`}
        buttonLabel="Find travellers"
        onPress={postParcel}
        loading={busy}
      />
    ) : parcel?.review_required ? null : matches && matches.matches.length === 0 ? (
      <StickyBar
        label="Parcel"
        value="Posted"
        caption="Live until a traveller on this route offers"
        buttonLabel="View my parcel"
        onPress={() => router.push(`/parcels/${parcel?.id ?? ''}`)}
        disabled={!parcel}
      />
    ) : (
      <StickyBar
        label={quote ? 'Total, fixed' : 'Price'}
        value={quote ? inr(quote.total_paise) : quoteId ? 'Fixed' : '—'}
        caption={quote ? `Locked until ${formatDateTime(quote.expires_at)}` : 'Choose a traveller to continue'}
        buttonLabel={selectedTrip ? 'Book this traveller' : 'Choose a traveller'}
        onPress={book}
        loading={bookingBusy}
        disabled={!selectedTrip || !quoteId}
      />
    );

  return (
    <Screen keyboard footer={footer}>
      <Stepper step={step} />

      {step === 1 ? (
        <>
          <MapCanvas
            height={188}
            originLabel={originArea || (originId ? cities.name(originId) : 'Pickup')}
            destLabel={destArea || (destId ? cities.name(destId) : 'Drop')}
          >
            <View
              style={{
                position: 'absolute',
                top: spacing.md,
                left: spacing.md,
                backgroundColor: 'rgba(255,255,255,0.94)',
                borderRadius: radius.pill,
                paddingHorizontal: 10,
                paddingVertical: 5,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Ionicons name="navigate" size={11} color={colors.brand} />
              <AppText variant="micro" tone="brand">
                Intercity · car
              </AppText>
            </View>
          </MapCanvas>

          <View style={{ marginTop: spacing.lg }}>
            <AppText variant="heading">Where is it going?</AppText>
            <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
              City to city. Areas help you and the traveller find each other — never an exact address.
            </AppText>
          </View>

          <View style={routeCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ width: 22, alignItems: 'center' }}>
                <View
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    borderWidth: 4,
                    borderColor: colors.brand,
                    backgroundColor: colors.white,
                  }}
                />
                <View style={{ width: 2, height: 30, backgroundColor: colors.line, marginTop: 3 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPicker('origin')}
                  style={routeRow}
                >
                  <View style={{ flex: 1 }}>
                    <AppText variant="micro" tone="muted" style={{ letterSpacing: 0.5 }}>
                      PICKUP CITY
                    </AppText>
                    <AppText
                      variant="subheading"
                      tone={originId ? 'default' : 'muted'}
                      numberOfLines={1}
                      style={{ marginTop: 1 }}
                    >
                      {originId ? cities.name(originId) : 'Choose a city'}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-down" size={16} color={colors.ink300} />
                </Pressable>
                <Field
                  label="Pickup area"
                  value={originArea}
                  onChangeText={setOriginArea}
                  placeholder="e.g. Civil Lines"
                  error={errors.originArea}
                  accessory={
                    <Pressable onPress={() => setPicker('originArea')} hitSlop={8} disabled={!originId}>
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
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
              <View style={{ width: 22, alignItems: 'center', paddingTop: 6 }}>
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    backgroundColor: colors.navy,
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPicker('dest')}
                  style={routeRow}
                >
                  <View style={{ flex: 1 }}>
                    <AppText variant="micro" tone="muted" style={{ letterSpacing: 0.5 }}>
                      DROP CITY
                    </AppText>
                    <AppText
                      variant="subheading"
                      tone={destId ? 'default' : 'muted'}
                      numberOfLines={1}
                      style={{ marginTop: 1 }}
                    >
                      {destId ? cities.name(destId) : 'Choose a city'}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-down" size={16} color={colors.ink300} />
                </Pressable>
                <Field
                  label="Delivery area"
                  value={destArea}
                  onChangeText={setDestArea}
                  placeholder="e.g. Sector 62"
                  error={errors.destArea}
                  accessory={
                    <Pressable onPress={() => setPicker('destArea')} hitSlop={8} disabled={!destId}>
                      <AppText
                        variant="small"
                        tone={destId ? 'brand' : 'muted'}
                        style={{ fontFamily: font.semibold }}
                      >
                        List
                      </AppText>
                    </Pressable>
                  }
                />
              </View>
            </View>

            {errors.origin || errors.dest ? (
              <AppText variant="small" tone="danger">
                {errors.origin ?? errors.dest}
              </AppText>
            ) : null}
          </View>

          <AppText variant="label" tone="muted" style={{ marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.8 }}>
            WHEN SHOULD IT MOVE?
          </AppText>
          <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
            <Chip label="Today" icon="flash-outline" selected={schedule === 'today'} onPress={() => applySchedule('today')} />
            <Chip label="Tomorrow" icon="sunny-outline" selected={schedule === 'tomorrow'} onPress={() => applySchedule('tomorrow')} />
            <Chip label="Pick dates" icon="calendar-outline" selected={schedule === 'custom'} onPress={() => applySchedule('custom')} />
          </Row>

          {schedule === 'custom' ? (
            <Card style={{ marginTop: spacing.md }}>
              <DateTimeField
                label="Pickup from"
                value={windowStart}
                onChange={(next) => {
                  setWindowStart(next);
                  if (windowEnd <= next) setWindowEnd(new Date(next.getTime() + 6 * 60 * 60 * 1000));
                }}
                minimumDate={new Date()}
                error={errors.windowStart}
              />
              <DateTimeField
                label="Deliver by"
                value={windowEnd}
                onChange={setWindowEnd}
                minimumDate={windowStart}
                error={errors.windowEnd}
                hint="The traveller must arrive inside this window."
              />
            </Card>
          ) : (
            <View style={windowSummary}>
              <Ionicons name="time-outline" size={16} color={colors.brandDark} />
              <View style={{ flex: 1 }}>
                <AppText variant="small" style={{ fontFamily: font.semibold }}>
                  Pickup {formatDateTime(windowStart.toISOString())}
                </AppText>
                <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
                  Deliver by {formatDateTime(windowEnd.toISOString())}
                </AppText>
              </View>
            </View>
          )}

          {cities.isError ? (
            <View style={{ marginTop: spacing.md }}>
              <ErrorNotice error={cities.error} onRetry={() => void cities.refetch()} />
            </View>
          ) : null}

          <View style={{ marginTop: spacing.md }}>
            <InfoNote
              icon="shield-checkmark"
              title="Every traveller is ID-checked"
              body="Only verified travellers can be booked. Capacity and route are hard gates."
            />
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <AppText variant="heading">What is inside?</AppText>
              <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                Be specific. Prohibited items are refused and can end the account.
              </AppText>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setStep(1)} hitSlop={8}>
              <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                Edit route
              </AppText>
            </Pressable>
          </Row>

          <AppText variant="label" tone="muted" style={{ marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.8 }}>
            CATEGORY
          </AppText>
          {config.isLoading ? (
            <LoadingBlock lines={2} />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {categories.map((value) => {
                const active = category === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setCategory(value);
                      setErrors((current) => ({ ...current, category: '' }));
                    }}
                    style={{
                      width: '48%',
                      flexGrow: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      backgroundColor: active ? colors.brandTint : colors.surface,
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? colors.brand : colors.line,
                      borderRadius: radius.md,
                      padding: spacing.sm,
                    }}
                  >
                    <IconBubble
                      name={CATEGORY_ICONS[value] ?? 'cube-outline'}
                      size={32}
                      background={active ? colors.brandSoft : colors.canvas}
                      color={active ? colors.brandDark : colors.ink500}
                      iconSize={16}
                    />
                    <AppText
                      variant="micro"
                      numberOfLines={2}
                      style={{ flex: 1, color: active ? colors.brandDark : colors.ink700, lineHeight: 14 }}
                    >
                      {categoryLabel(value)}
                    </AppText>
                    {active ? <Ionicons name="checkmark-circle" size={15} color={colors.brand} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          {errors.category ? (
            <AppText variant="small" tone="danger" style={{ marginTop: 4 }}>
              {errors.category}
            </AppText>
          ) : null}

          <View style={{ marginTop: spacing.lg }}>
            <Field
              label="Description *"
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Sealed university transcripts in a folder"
              multiline
              maxLength={300}
              style={{ height: 84, textAlignVertical: 'top' }}
              error={errors.description}
            />

            <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Weight (kg) *"
                  value={weightKg}
                  onChangeText={setWeightKg}
                  keyboardType="decimal-pad"
                  placeholder={`up to ${maxWeight}`}
                  error={errors.weight}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Value (₹) *"
                  value={declaredRupees}
                  onChangeText={setDeclaredRupees}
                  keyboardType="number-pad"
                  placeholder={`up to ${maxValue / 100}`}
                  error={errors.declared}
                />
              </View>
            </Row>

            <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
              Dimensions L × W × H (cm) *
            </AppText>
            <Row gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
              {dims.map((value, index) => (
                <View key={index} style={{ flex: 1 }}>
                  <Field
                    label={['Length', 'Width', 'Height'][index]!}
                    value={value}
                    onChangeText={(text) =>
                      setDims((current) => current.map((item, position) => (position === index ? text : item)))
                    }
                    keyboardType="number-pad"
                    placeholder="cm"
                    error={index === 2 ? errors.dims : undefined}
                  />
                </View>
              ))}
            </Row>
          </View>

          <View style={sectionCard}>
            <Row gap={spacing.sm} style={{ alignItems: 'center', marginBottom: spacing.md }}>
              <IconBubble name="person-outline" size={34} background={colors.brandSoft} color={colors.brandDark} iconSize={17} />
              <View style={{ flex: 1 }}>
                <AppText variant="subheading">Who receives it?</AppText>
                <AppText variant="small" tone="muted">
                  The traveller sees a masked number, never the full one.
                </AppText>
              </View>
            </Row>
            <Field
              label="Receiver name *"
              value={receiverName}
              onChangeText={setReceiverName}
              placeholder="Who receives it"
              error={errors.receiverName}
            />
            <Field
              label="Receiver mobile *"
              value={receiverPhone}
              onChangeText={setReceiverPhone}
              keyboardType="phone-pad"
              placeholder="98765 43210"
              hint="Used for delivery coordination only."
              error={errors.receiverPhone}
            />
          </View>

          <View style={sectionCard}>
            <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
              <IconBubble name="camera-outline" size={34} background={colors.accentSoft} color={colors.warn} iconSize={17} />
              <View style={{ flex: 1 }}>
                <AppText variant="subheading">Sealed photo</AppText>
                <AppText variant="small" tone="muted">
                  Optional. A photo of the sealed parcel helps both sides at handover.
                </AppText>
              </View>
            </Row>
            {photoError ? (
              <View style={{ marginTop: spacing.sm }}>
                <ErrorNotice error={photoError} />
              </View>
            ) : null}
            <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
              <Button
                label={photoKey ? 'Replace photo' : 'Click photo'}
                variant="secondary"
                size="sm"
                loading={photoBusy}
                onPress={attachPhoto}
                fullWidth={false}
              />
              {photoKey ? (
                <>
                  <View style={photoAdded}>
                    <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                    <AppText variant="micro" tone="success">
                      Attached
                    </AppText>
                  </View>
                  <Button
                    label="Remove"
                    variant="tertiary"
                    size="sm"
                    onPress={() => setPhotoKey(null)}
                    fullWidth={false}
                  />
                </>
              ) : null}
            </Row>
          </View>

          <View style={{ marginTop: spacing.md }}>
            <Checkbox
              checked={declaration}
              onToggle={() => setDeclaration((value) => !value)}
              label="I confirm this is not cash, jewellery, medicine, food, a battery, a weapon or another prohibited item, and the details are accurate."
            />
            {errors.declaration ? (
              <AppText variant="small" tone="danger">
                {errors.declaration}
              </AppText>
            ) : null}
          </View>

          {submitError ? (
            <View style={{ marginTop: spacing.md }}>
              <ErrorNotice error={submitError} />
            </View>
          ) : null}
        </>
      ) : null}

      {step === 3 && parcel ? (
        parcel.review_required ? (
          <Card>
            <Banner
              tone="warn"
              title="This parcel needs a quick human check"
              body={parcel.review_reason ?? 'Usually within 2 hours. We will notify you when it is cleared.'}
            />
            <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
              It is saved and cannot be edited while under review. You can find it under Bookings → My parcels.
            </AppText>
            <Button label="Go to my parcels" onPress={() => router.replace('/bookings')} style={{ marginTop: spacing.lg }} />
          </Card>
        ) : (
          <>
            <View style={postedCard}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="label" tone="brand" style={{ letterSpacing: 0.8 }}>
                    PARCEL POSTED
                  </AppText>
                  <AppText variant="heading" style={{ marginTop: 2 }}>
                    {originArea} → {destArea}
                  </AppText>
                </View>
                <Badge label="Posted" tone="info" />
              </Row>
              <View style={{ marginTop: spacing.md }}>
                <RouteTimeline
                  origin={`${originArea}, ${cities.name(originId)}`}
                  dest={`${destArea}, ${cities.name(destId)}`}
                  originMeta={`Pickup ${formatDateTime(parcel.window_start)}`}
                  destMeta={`Deliver by ${formatDateTime(parcel.window_end)}`}
                  compact
                />
              </View>
              <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: 'wrap' }}>
                <FactPill icon="cube-outline" text={categoryLabel(parcel.category)} />
                <FactPill icon="scale-outline" text={kg(parcel.weight_kg)} />
                <FactPill icon="cash-outline" text={inr(parcel.declared_value_paise)} />
              </Row>
            </View>

            {quote ? (
              <View style={[sectionCard, { marginTop: spacing.md }]}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="micro" tone="muted" style={{ letterSpacing: 0.5 }}>
                      TOTAL, FIXED FOR THIS PARCEL
                    </AppText>
                    <AppText variant="hero" tone="brand" style={{ marginTop: 2 }}>
                      {inr(quote.total_paise)}
                    </AppText>
                    <AppText variant="small" tone="muted">
                      Locked until {formatDateTime(quote.expires_at)}.
                    </AppText>
                  </View>
                  <IconBubble name="pricetag" size={40} background={colors.brandSoft} color={colors.brandDark} />
                </Row>
                <View style={{ marginTop: spacing.md, gap: 6 }}>
                  {quote.breakdown.map((line) => (
                    <Row key={line.label} style={{ justifyContent: 'space-between' }}>
                      <AppText variant="small" tone="muted">
                        {line.label}
                        {line.note ? ` — ${line.note}` : ''}
                      </AppText>
                      <AppText variant="small">{inr(line.amount_paise)}</AppText>
                    </Row>
                  ))}
                  <Divider style={{ marginVertical: 4 }} />
                  <Row style={{ justifyContent: 'space-between' }}>
                    <AppText variant="small" tone="muted">
                      Traveller’s share
                    </AppText>
                    <AppText variant="small" style={{ fontFamily: font.semibold }}>
                      {inr(quote.traveller_paise)}
                    </AppText>
                  </Row>
                </View>
              </View>
            ) : quoteId ? (
              <View style={[sectionCard, { marginTop: spacing.md }]}>
                <AppText variant="heading">Price fixed</AppText>
                <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                  {quoteNote ?? 'This parcel already has a valid quote. The amount is confirmed on the booking.'}
                </AppText>
              </View>
            ) : null}

            {quoteError ? (
              <View style={{ marginTop: spacing.md }}>
                <ErrorNotice error={quoteError} onRetry={() => void refreshQuote()} />
              </View>
            ) : null}

            {matchError ? (
              <View style={{ marginTop: spacing.md }}>
                <ErrorNotice error={matchError} onRetry={() => void loadPricing(parcel.id)} />
              </View>
            ) : null}

            {matches && matches.matches.length === 0 ? (
              <Card style={{ marginTop: spacing.md }}>
                <EmptyState
                  title="No traveller on this route yet"
                  body={
                    matches.no_match_reasons.length
                      ? matches.no_match_reasons.join(' ')
                      : 'Widen the pickup or delivery window, then check again.'
                  }
                  actionLabel="Check again"
                  onAction={() => void loadPricing(parcel.id)}
                />
                <Button
                  label="View my parcel"
                  variant="secondary"
                  onPress={() => router.push(`/parcels/${parcel.id}`)}
                  style={{ marginTop: spacing.sm }}
                />
                <AppText variant="small" tone="muted" style={{ textAlign: 'center', marginTop: spacing.sm }}>
                  Your parcel is live. Travellers going that way can offer, and you choose who carries it.
                </AppText>
              </Card>
            ) : null}

            {matches && matches.matches.length > 0 ? (
              <>
                <SectionTitle title="Travellers going your way" style={{ marginTop: spacing.xl }} />
                <AppText variant="small" tone="muted" style={{ marginBottom: spacing.sm }}>
                  Ranked by fit. Capacity, route and ID checks are hard gates — a high score never overrides them.
                </AppText>
                <View style={{ gap: spacing.sm }}>
                  {matches.matches.map((match) => (
                    <MatchCard
                      key={match.trip_id}
                      match={match}
                      selected={selectedTrip === match.trip_id}
                      onSelect={() => setSelectedTrip(match.trip_id)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {bookingError ? (
              <View style={{ marginTop: spacing.md }}>
                <ErrorNotice error={bookingError} />
              </View>
            ) : null}

            {selectedTrip ? (
              <View style={{ marginTop: spacing.lg }}>
                <InfoNote
                  icon="time-outline"
                  title="The traveller has 30 minutes to accept"
                  body="Pay only after the parcel is delivered and the delivery code is confirmed. Nothing is charged at booking."
                />
              </View>
            ) : null}
          </>
        )
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
        visible={picker === 'originArea' || picker === 'destArea'}
        title={picker === 'destArea' ? 'Delivery areas' : 'Pickup areas'}
        options={((picker === 'destArea' ? destAreas.data?.items : originAreas.data?.items) ?? []).map((area) => ({
          value: area.name,
          label: area.name,
        }))}
        selected={picker === 'destArea' ? destArea : originArea}
        onSelect={(value) => {
          if (picker === 'destArea') setDestArea(value);
          else setOriginArea(value);
        }}
        onClose={() => setPicker(null)}
        emptyText="No listed areas for this city. Type the area instead."
      />

      <PickerSheet
        visible={picker === 'category'}
        title="Category"
        options={categories.map((value) => ({ value, label: categoryLabel(value) }))}
        selected={category}
        onSelect={setCategory}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['Route', 'Parcel', 'Traveller'];
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {labels.map((label, index) => {
          const position = (index + 1) as 1 | 2 | 3;
          const done = step > position;
          const active = step === position;
          return (
            <View key={label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  width: active ? 30 : 24,
                  height: active ? 30 : 24,
                  borderRadius: 15,
                  backgroundColor: done ? colors.success : active ? colors.brand : colors.surface,
                  borderWidth: active || done ? 0 : 1,
                  borderColor: colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done ? (
                  <Ionicons name="checkmark" size={13} color={colors.white} />
                ) : (
                  <AppText
                    variant="micro"
                    style={{
                      color: active ? colors.white : colors.ink300,
                      fontFamily: font.bold,
                    }}
                  >
                    {position}
                  </AppText>
                )}
              </View>
              <AppText
                variant="micro"
                style={{
                  marginLeft: 6,
                  color: active ? colors.ink900 : colors.ink500,
                  fontFamily: active ? font.bold : font.regular,
                }}
              >
                {label}
              </AppText>
              {index < labels.length - 1 ? (
                <View
                  style={{
                    flex: 1,
                    height: 2,
                    marginHorizontal: spacing.sm,
                    backgroundColor: done ? colors.success : colors.line,
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function FactPill({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
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

const routeCard = {
  backgroundColor: colors.surface,
  borderRadius: radius.xl,
  borderWidth: 1,
  borderColor: colors.line,
  padding: spacing.md,
  marginTop: spacing.md,
};

const routeRow = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: spacing.sm,
  backgroundColor: colors.canvas,
  borderRadius: radius.md,
  paddingHorizontal: spacing.md,
  paddingVertical: 10,
  marginBottom: spacing.sm,
};

const windowSummary = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: spacing.sm,
  backgroundColor: colors.brandTint,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: '#d5e2ff',
  padding: spacing.md,
  marginTop: spacing.md,
};

const sectionCard = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.line,
  padding: spacing.md,
  marginTop: spacing.md,
};

const photoAdded = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 4,
  backgroundColor: colors.successBg,
  borderRadius: radius.pill,
  paddingHorizontal: 8,
  paddingVertical: 4,
};

const postedCard = {
  backgroundColor: colors.surface,
  borderRadius: radius.xl,
  borderWidth: 1,
  borderColor: colors.line,
  padding: spacing.lg,
};
