import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
  SelectField,
  SectionTitle,
} from '../src/components/ui.tsx';
import { useCities } from '../src/lib/cities.ts';
import { pickPhoto } from '../src/lib/photo.ts';
import { categoryLabel, formatDateTime, inr, kg, normalisePhone } from '../src/lib/format.ts';
import { colors, font, spacing } from '../src/theme.ts';

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

function SendWizard() {
  const params = useLocalSearchParams<{ category?: string }>();
  const cities = useCities();
  const config = useQuery({ queryKey: ['config'], queryFn: senderApi.config, staleTime: 10 * 60_000 });
  const queryClient = useQueryClient();

  const defaultStart = useMemo(startOfTomorrow, []);
  const defaultEnd = useMemo(() => new Date(startOfTomorrow().getTime() + 6 * 60 * 60 * 1000), []);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [picker, setPicker] = useState<'origin' | 'dest' | 'originArea' | 'destArea' | 'category' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
  const [weightKg, setWeightKg] = useState('');
  const [dims, setDims] = useState(['', '', '']);
  const [declaredRupees, setDeclaredRupees] = useState('');
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
      const picked = await pickPhoto();
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

  const cityOptions = cities.serviceable.map((city) => ({
    value: city.id,
    label: city.name,
    meta: city.state,
  }));

  return (
    <Screen keyboard>
      <Stepper step={step} />

      {step === 1 ? (
        <Card>
          <AppText variant="heading">Where is it going?</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2, marginBottom: spacing.lg }}>
            City to city. The areas help the traveller and you find each other.
          </AppText>

          <SelectField
            label="From city"
            value={originId ? cities.name(originId) : null}
            placeholder="Choose origin"
            onPress={() => setPicker('origin')}
            error={errors.origin}
          />
          <Field
            label="Pickup area"
            value={originArea}
            onChangeText={setOriginArea}
            placeholder="e.g. Indiranagar"
            error={errors.originArea}
            accessory={
              <Pressable onPress={() => setPicker('originArea')} hitSlop={8} disabled={!originId}>
                <AppText variant="small" tone={originId ? 'brand' : 'muted'} style={{ fontFamily: font.semibold }}>
                  List
                </AppText>
              </Pressable>
            }
          />
          <SelectField
            label="To city"
            value={destId ? cities.name(destId) : null}
            placeholder="Choose destination"
            onPress={() => setPicker('dest')}
            error={errors.dest}
          />
          <Field
            label="Delivery area"
            value={destArea}
            onChangeText={setDestArea}
            placeholder="e.g. HSR Layout"
            error={errors.destArea}
            accessory={
              <Pressable onPress={() => setPicker('destArea')} hitSlop={8} disabled={!destId}>
                <AppText variant="small" tone={destId ? 'brand' : 'muted'} style={{ fontFamily: font.semibold }}>
                  List
                </AppText>
              </Pressable>
            }
          />
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

          {cities.isError ? <ErrorNotice error={cities.error} onRetry={() => void cities.refetch()} /> : null}

          <Button
            label="Continue"
            onPress={() => {
              if (validateRoute()) {
                setErrors({});
                setStep(2);
              }
            }}
            style={{ marginTop: spacing.sm }}
          />
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <AppText variant="heading">What is inside?</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2, marginBottom: spacing.lg }}>
            Be specific. Prohibited items are refused and can end the account.
          </AppText>

          <SelectField
            label="Category"
            value={categoryLabel(category)}
            onPress={() => setPicker('category')}
            error={errors.category}
          />
          <Field
            label="Description"
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
                label="Weight (kg)"
                value={weightKg}
                onChangeText={setWeightKg}
                keyboardType="decimal-pad"
                placeholder={`up to ${maxWeight}`}
                error={errors.weight}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Value (₹)"
                value={declaredRupees}
                onChangeText={setDeclaredRupees}
                keyboardType="number-pad"
                placeholder={`up to ${maxValue / 100}`}
                error={errors.declared}
              />
            </View>
          </Row>

          <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
            Dimensions L × W × H (cm)
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

          <Field
            label="Receiver name"
            value={receiverName}
            onChangeText={setReceiverName}
            placeholder="Who receives it"
            error={errors.receiverName}
          />
          <Field
            label="Receiver mobile"
            value={receiverPhone}
            onChangeText={setReceiverPhone}
            keyboardType="phone-pad"
            placeholder="98765 43210"
            hint="Used for delivery coordination. The traveller sees a masked number."
            error={errors.receiverPhone}
          />

          <Card style={{ backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
            <Row style={{ justifyContent: 'space-between' }}>
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
                label={photoKey ? 'Replace photo' : 'Choose photo'}
                variant="secondary"
                size="sm"
                loading={photoBusy}
                onPress={attachPhoto}
                fullWidth={false}
              />
              {photoKey ? (
                <Button
                  label="Remove"
                  variant="tertiary"
                  size="sm"
                  onPress={() => setPhotoKey(null)}
                  fullWidth={false}
                />
              ) : null}
            </Row>
          </Card>

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

          <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button label="Back" variant="secondary" onPress={() => setStep(1)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button label="Find travellers" onPress={postParcel} loading={busy} />
            </View>
          </Row>
        </Card>
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
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="heading">
                    {originArea} → {destArea}
                  </AppText>
                  <AppText variant="small" tone="muted">
                    {categoryLabel(parcel.category)} · {kg(parcel.weight_kg)} · pickup{' '}
                    {formatDateTime(parcel.window_start)}
                  </AppText>
                </View>
                <Badge label="Posted" tone="info" />
              </Row>
            </Card>

            {quote ? (
              <Card style={{ marginTop: spacing.md }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <AppText variant="heading">Price</AppText>
                  <AppText variant="title" tone="brand">
                    {inr(quote.total_paise)}
                  </AppText>
                </Row>
                <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                  Fixed for this parcel until {formatDateTime(quote.expires_at)}.
                </AppText>
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
                      Traveller's share
                    </AppText>
                    <AppText variant="small">{inr(quote.traveller_paise)}</AppText>
                  </Row>
                </View>
              </Card>
            ) : quoteId ? (
              <Card style={{ marginTop: spacing.md }}>
                <AppText variant="heading">Price fixed</AppText>
                <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                  {quoteNote ?? 'This parcel already has a valid quote. The amount is confirmed on the booking.'}
                </AppText>
              </Card>
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

            <Button
              label={selectedTrip ? 'Book this traveller' : 'Choose a traveller'}
              onPress={book}
              loading={bookingBusy}
              disabled={!selectedTrip || !quoteId}
              style={{ marginTop: spacing.lg }}
            />
            <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
              The traveller has 30 minutes to accept. A payment request follows acceptance; no money moves until
              the provider confirms.
            </AppText>
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
          else setOriginId(value);
          setErrors({});
        }}
        onClose={() => setPicker(null)}
        emptyText={cities.isLoading ? 'Loading cities…' : 'No serviceable cities loaded.'}
      />

      <PickerSheet
        visible={picker === 'originArea' || picker === 'destArea'}
        title="Pickup areas"
        options={((picker === 'destArea' ? destAreas.data?.items : originAreas.data?.items) ?? []).map((area) => ({ value: area.id, label: area.name }))}
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
    <Row style={{ marginBottom: spacing.lg, justifyContent: 'space-between' }}>
      {labels.map((label, index) => {
        const position = (index + 1) as 1 | 2 | 3;
        const active = step >= position;
        return (
          <Row key={label} gap={6}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: active ? colors.brand : '#e2e7f0',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText variant="small" style={{ color: active ? colors.white : colors.ink500, fontFamily: font.bold }}>
                {position}
              </AppText>
            </View>
            <AppText variant="small" tone={active ? 'default' : 'muted'} style={{ fontFamily: font.semibold }}>
              {label}
            </AppText>
          </Row>
        );
      })}
    </Row>
  );
}

