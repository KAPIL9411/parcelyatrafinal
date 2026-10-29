import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { bookingsApi, disputesApi, filesApi } from '../../src/api/client.ts';
import { ApiError } from '../../src/api/http.ts';
import type { Booking, ChatThread, Dispute, PaymentIntent } from '../../src/api/types.ts';
import { AuthGate } from '../../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Choice,
  Divider,
  ErrorNotice,
  Field,
  LoadingBlock,
  Refresh,
  Row,
  Screen,
  SectionTitle,
  Sheet,
} from '../../src/components/ui.tsx';
import { Avatar, RouteTimeline, StatusTrack } from '../../src/components/kit.tsx';
import { LiveTrackingView } from '../../src/components/LiveTrackingView.tsx';
import { startDriverLocationService, stopDriverLocationService } from '../../src/tracking/LocationService.ts';
import { pickPhoto } from '../../src/lib/photo.ts';
import {
  CANCEL_REASONS,
  DISPUTE_CATEGORY_LABELS,
  REVIEW_TAGS,
  disputeCategoryLabel,
  formatDateTime,
  inr,
  payoutLabel,
  payoutTone,
  statusHint,
  statusLabel,
  statusTone,
} from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

const HANDOVER_CHECK_STATUSES = ['payment_pending', 'confirmed', 'pickup_ready'];
const DELIVERED_STATUSES = ['delivered', 'payout_eligible', 'paid_out'];
const INCIDENT_STATUSES = ['picked_up', 'in_transit', 'arrived', 'delivery_attempt_failed'];

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate next={`/bookings/${id}`}>
      <BookingDetail bookingId={id} />
    </AuthGate>
  );
}

function BookingDetail({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();

  const bookingQ = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => bookingsApi.get(bookingId),
  });
  const booking = bookingQ.data;

  // A server that predates `viewer_role` leaves the field out; the list still says which side the
  // caller is on, so the screen works against either version.
  const listQ = useQuery({
    queryKey: ['bookings', 'all'],
    queryFn: () => bookingsApi.list(),
    staleTime: 15_000,
    enabled: Boolean(booking) && !booking?.viewer_role,
  });
  const role =
    booking?.viewer_role ?? listQ.data?.items.find((item) => item.id === bookingId)?.role ?? null;

  const threadQ = useQuery({
    queryKey: ['thread', bookingId],
    queryFn: () => bookingsApi.thread(bookingId),
    refetchInterval: 10_000,
    enabled: Boolean(booking),
  });
  const unread = threadQ.data?.unread_count ?? 0;

  useEffect(() => {
    if (unread === 0) return;
    void bookingsApi
      .markThreadRead(bookingId)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['inbox'] });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => {
        // The poll retries; a failed read receipt is not worth an error on the booking.
      });
  }, [unread, bookingId, queryClient]);

  useEffect(() => {
    if (role === 'traveller' && booking?.status === 'in_transit') {
      void startDriverLocationService(bookingId);
      return () => {
        void stopDriverLocationService();
      };
    }
  }, [role, booking?.status, bookingId]);

  async function refreshBooking() {
    await bookingQ.refetch();
    void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    if (booking?.parcel_id) void queryClient.invalidateQueries({ queryKey: ['parcel', booking.parcel_id] });
    if (booking?.dispute) void queryClient.invalidateQueries({ queryKey: ['dispute', booking.dispute.id] });
  }

  if (bookingQ.isLoading) {
    return (
      <Screen>
        <Card>
          <LoadingBlock lines={6} />
        </Card>
      </Screen>
    );
  }

  if (bookingQ.isError || !booking) {
    return (
      <Screen>
        <ErrorNotice error={bookingQ.error} onRetry={() => void bookingQ.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      refreshControl={
        <Refresh
          refreshing={bookingQ.isRefetching || threadQ.isRefetching}
          onRefresh={() => {
            void bookingQ.refetch();
            void threadQ.refetch();
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
          <Row gap={spacing.sm} style={{ flex: 1 }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: role === 'traveller' ? colors.partner : colors.brand,
              }}
            />
            <AppText
              variant="label"
              style={{
                letterSpacing: 0.8,
                color: role === 'traveller' ? colors.partner : colors.brandDark,
              }}
            >
              {role === 'traveller' ? 'YOU ARE CARRYING' : role === 'sender' ? 'YOU ARE SENDING' : 'BOOKING'}
            </AppText>
          </Row>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Badge label={statusLabel(booking.status)} tone={statusTone(booking.status)} />
            <Badge label={payoutLabel(booking.payout_state)} tone={payoutTone(booking.payout_state)} />
          </View>
        </Row>

        <View style={{ marginTop: spacing.md }}>
          <RouteTimeline
            origin={booking.pickup_area ?? 'Pickup'}
            dest={booking.drop_area ?? 'Drop'}
            originMeta={
              booking.pickup_window_start && booking.pickup_window_end
                ? `${formatDateTime(booking.pickup_window_start)} – ${formatDateTime(booking.pickup_window_end)}`
                : 'Agree a time in the chat below'
            }
            destMeta={`Booking ${booking.id.slice(0, 8)} · ${formatDateTime(booking.created_at)}`}
            tone={role === 'traveller' ? 'partner' : 'brand'}
          />
        </View>

        <View style={{ marginTop: spacing.md }}>
          <StatusTrack status={booking.status} tone={role === 'traveller' ? 'partner' : 'brand'} />
        </View>
        {['picked_up', 'in_transit', 'arrived'].includes(booking.status) ? (
          <View style={{ marginTop: spacing.md }}>
            <LiveTrackingView parcelId={booking.parcel_id} bookingId={booking.id} />
          </View>
        ) : null}

        <View
          style={{
            backgroundColor: colors.canvas,
            borderRadius: radius.md,
            padding: spacing.md,
            marginTop: spacing.md,
          }}
        >
          <AppText variant="small" tone="muted">
            {role ? statusHint(booking.status, role) : 'Status update in progress.'}
          </AppText>
        </View>

        <Divider style={{ marginVertical: spacing.md }} />

        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {booking.counterparty ? (
            <Row gap={spacing.sm} style={{ flex: 1 }}>
              <Avatar
                name={booking.counterparty.first_name}
                size={38}
                tone={role === 'traveller' ? 'brand' : 'partner'}
              />
              <View style={{ flex: 1 }}>
                <AppText variant="subheading" numberOfLines={1}>
                  {booking.counterparty.first_name ?? 'The other side'}
                </AppText>
                <Row gap={4}>
                  <AppText variant="micro" tone="muted" numberOfLines={1} style={{ fontFamily: font.regular }}>
                    {booking.counterparty.phone_masked ?? 'Number hidden'}
                  </AppText>
                  {booking.counterparty.verification_state === 'verified' ? (
                    <Ionicons name="shield-checkmark" size={12} color={colors.success} />
                  ) : null}
                </Row>
              </View>
            </Row>
          ) : (
            <AppText variant="small" tone="muted">
              The other side
            </AppText>
          )}
          <View style={{ alignItems: 'flex-end' }}>
            <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
              Total
            </AppText>
            <AppText variant="price" tone="brand" style={{ fontSize: 20 }}>
              {inr(booking.agreed_total_paise)}
            </AppText>
          </View>
        </Row>
      </View>

      {role ? <ActionPanel booking={booking} role={role} onChanged={refreshBooking} /> : listQ.isError ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warn"
            title="We could not tell which side you are on"
            body="The booking is shown read-only. Pull down to try again."
          />
        </View>
      ) : null}

      <ChatCard bookingId={booking.id} thread={threadQ} onRetry={() => void threadQ.refetch()} />

      <TimelineCard booking={booking} role={role} />

      {role === 'sender' && HANDOVER_CHECK_STATUSES.includes(booking.status) ? (
        <Card style={{ marginTop: spacing.md }}>
          <SectionTitle title="What to check at handover" />
          {[
            'The parcel is still sealed with the tape you applied.',
            'The weight matches what you declared.',
            'Nothing has been added since you took the photo.',
          ].map((line) => (
            <Row key={line} style={{ alignItems: 'flex-start', marginBottom: 6 }} gap={8}>
              <Text style={{ color: colors.success, fontFamily: font.bold }}>✓</Text>
              <AppText variant="small" style={{ flex: 1 }}>
                {line}
              </AppText>
            </Row>
          ))}
          <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
            Give the pickup code to the traveller only after they have the parcel in hand.
          </AppText>
        </Card>
      ) : null}

      <Card style={{ marginTop: spacing.md }}>
        <SectionTitle title="Money" />
        <DetailRow label="Sender pays" value={inr(booking.agreed_total_paise)} />
        <DetailRow label="Traveller’s share" value={inr(booking.traveller_share_paise)} />
        <DetailRow label="Payout" value={payoutLabel(booking.payout_state)} />
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm }}>
          Payments run through a sandbox in this build. No money leaves an account and no payout is released
          automatically.
        </AppText>
      </Card>

      <View style={{ marginTop: spacing.md }}>
        <Banner
          tone="danger"
          title={role === 'traveller' ? 'The parcel is not insured.' : 'Your parcel is not insured.'}
          body="We can help investigate and may offer a goodwill amount, but we cannot repay the full declared value."
        />
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------- actions

function ActionPanel({
  booking,
  role,
  onChanged,
}: {
  booking: Booking;
  role: 'sender' | 'traveller';
  onChanged: () => Promise<void>;
}) {
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);

  const now = useTick(Boolean(booking.accept_by) || Boolean(booking.dispute_deadline));
  const acceptRemaining = remainingMs(booking.accept_by, now);
  const disputeRemaining = remainingMs(booking.dispute_deadline, now);
  const disputeExpired = Boolean(booking.dispute_deadline) && disputeRemaining <= 0;
  const can = (command: string) => booking.allowed_commands.includes(command);

  async function act(command: string, extra: Record<string, unknown> = {}) {
    setActing(command);
    setError(null);
    try {
      await bookingsApi.transition(booking.id, command, extra);
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setActing(null);
    }
  }

  function confirmIncident() {
    Alert.alert(
      'Open a case?',
      'The traveller’s payout is frozen while support reviews it. Only one case can be open per booking.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open a case', style: 'destructive', onPress: () => void act('report_incident') },
      ],
    );
  }

  return (
    <View style={{ gap: spacing.md, marginTop: spacing.md }}>
      {booking.status === 'pending_traveller_acceptance' ? (
        <Card>
          <AppText variant="heading">
            {role === 'sender' ? 'Waiting for the traveller to accept' : 'A sender has asked you to carry a parcel'}
          </AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
            {acceptRemaining > 0
              ? `${role === 'sender' ? 'They have' : 'You have'} ${countdownLabel(acceptRemaining)} left to decide.`
              : 'The 30-minute acceptance window has closed.'}
          </AppText>
          {role === 'traveller' ? (
            <Row style={{ marginTop: spacing.md }} gap={spacing.sm}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Decline"
                  variant="secondary"
                  onPress={() => void act('decline')}
                  loading={acting === 'decline'}
                  disabled={acting !== null}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Accept"
                  onPress={() => void act('accept')}
                  loading={acting === 'accept'}
                  disabled={acting !== null || !can('accept')}
                />
              </View>
            </Row>
          ) : null}
        </Card>
      ) : null}

      {booking.status === 'payment_pending' && role === 'sender' ? (
        <PaymentPanel booking={booking} onPaid={onChanged} />
      ) : null}

      {booking.status === 'payment_pending' && role === 'traveller' ? (
        <Banner
          tone="info"
          title="Accepted. Waiting for the sender to pay"
          body="The booking confirms as soon as the payment completes. You do not need to do anything."
        />
      ) : null}

      {booking.status === 'confirmed' ? (
        <Banner
          tone="info"
          title="Both sides are committed"
          body={
            role === 'sender'
              ? 'Pickup opens when the window starts. The six-digit code appears here.'
              : 'Pickup opens when the window starts. Ask the sender for the code at the door.'
          }
        />
      ) : null}

      {booking.status === 'pickup_ready' ? (
        role === 'sender' ? (
          <SenderCodePanel booking={booking} phase="pickup" />
        ) : (
          <HandoverPanel booking={booking} phase="pickup" onDone={onChanged} />
        )
      ) : null}

      {booking.status === 'picked_up' && role === 'traveller' ? (
        <Card>
          <AppText variant="heading">You have the parcel</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
            Keep it sealed. Start the journey when you set off; the sender sees the update.
          </AppText>
          <Button
            label="I’m on the way"
            onPress={() => void act('start_transit')}
            loading={acting === 'start_transit'}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : null}

      {booking.status === 'in_transit' && role === 'traveller' ? (
        <Card>
          <AppText variant="heading">On the way</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
            Mark arrival when you reach the destination city. The delivery code is issued then.
          </AppText>
          <Button
            label="I’ve arrived"
            onPress={() => void act('arrive')}
            loading={acting === 'arrive'}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : null}

      {booking.status === 'arrived' && role === 'traveller' ? (
        <HandoverPanel booking={booking} phase="delivery" onDone={onChanged} />
      ) : null}

      {booking.status === 'arrived' && role === 'sender' ? (
        <SenderCodePanel booking={booking} phase="delivery" />
      ) : null}

      {booking.status === 'delivery_attempt_failed' ? (
        <Card>
          <AppText variant="heading">The receiver was not available</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
            {role === 'traveller'
              ? 'Keep the parcel sealed and contact support. Do not leave it with a neighbour or at the door without the code.'
              : 'The traveller is still holding your parcel. Support can help arrange the next attempt.'}
          </AppText>
          <Row style={{ marginTop: spacing.md }} gap={spacing.sm}>
            {can('report_incident') ? (
              <View style={{ flex: 1 }}>
                <Button
                  label="Open a case"
                  variant="secondary"
                  onPress={confirmIncident}
                  loading={acting === 'report_incident'}
                />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button label="Contact support" variant="tertiary" onPress={() => router.push('/help')} />
            </View>
          </Row>
        </Card>
      ) : null}

      {DELIVERED_STATUSES.includes(booking.status) ? (
        <DeliveredPanel booking={booking} role={role} onChanged={onChanged} />
      ) : null}

      {booking.dispute ? <CasePanel booking={booking} onChanged={onChanged} /> : null}

      {['locked_for_review', 'incident_open'].includes(booking.status) ? (
        <Banner
          tone="danger"
          title="This booking is paused"
          body="Our team is checking it and will contact both sides. Do not hand over the parcel or any code until this clears."
        />
      ) : null}

      {INCIDENT_STATUSES.includes(booking.status) && can('report_incident') ? (
        <Button
          label="Report a problem"
          variant="tertiary"
          onPress={confirmIncident}
          loading={acting === 'report_incident'}
        />
      ) : null}

      {error ? <ErrorNotice error={error} /> : null}

      {can('cancel') ? (
        <Card style={{ padding: spacing.md }}>
          <Row style={{ justifyContent: 'space-between' }} gap={spacing.md}>
            <AppText variant="small" tone="muted" style={{ flex: 1 }}>
              {role === 'sender'
                ? booking.status === 'pending_traveller_acceptance'
                  ? 'You can cancel free until the traveller accepts.'
                  : 'If you cancel now, the traveller keeps their share and the rest is returned.'
                : 'Cancelling after accepting affects your ranking.'}
            </AppText>
            <Button
              label="Cancel"
              variant="danger"
              size="sm"
              fullWidth={false}
              onPress={() => {
                setCancelReason(null);
                setCancelOpen(true);
              }}
            />
          </Row>
        </Card>
      ) : null}

      {booking.status === 'delivered' && can('raise_dispute') ? (
        <Card style={{ padding: spacing.md }}>
          <Row style={{ justifyContent: 'space-between' }} gap={spacing.md}>
            <AppText variant="small" tone="muted" style={{ flex: 1 }}>
              {booking.dispute_deadline
                ? disputeRemaining > 0
                  ? `Problems can be raised until ${formatDateTime(booking.dispute_deadline)} — about ${Math.ceil(
                      disputeRemaining / 3_600_000,
                    )} hours left.`
                  : 'The problem window has closed.'
                : 'The problem window has closed.'}
            </AppText>
            <Button
              label="Raise a problem"
              variant="danger"
              size="sm"
              fullWidth={false}
              disabled={disputeExpired}
              onPress={() => setDisputeOpen(true)}
            />
          </Row>
        </Card>
      ) : null}

      <Sheet visible={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this booking?">
        <AppText variant="small" tone="muted">
          {['pending_traveller_acceptance', 'draft'].includes(booking.status)
            ? 'Nothing has been charged, so this cancellation is free.'
            : role === 'sender'
              ? `The traveller keeps their share of ${inr(booking.traveller_share_paise)} and the rest is returned. We do not control how long a bank takes to post it.`
              : 'Cancelling after accepting affects your ranking.'}
        </AppText>
        <View style={{ marginTop: spacing.md }}>
          {CANCEL_REASONS.map((reason) => (
            <Choice
              key={reason.value}
              label={reason.label}
              selected={cancelReason === reason.value}
              onPress={() => setCancelReason(reason.value)}
            />
          ))}
        </View>
        <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Keep booking" variant="secondary" onPress={() => setCancelOpen(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Cancel booking"
              variant="danger"
              disabled={!cancelReason}
              loading={acting === 'cancel'}
              onPress={() => {
                if (!cancelReason) return;
                setCancelOpen(false);
                void act('cancel', { reason_code: cancelReason });
              }}
            />
          </View>
        </Row>
      </Sheet>

      <DisputeSheet
        booking={booking}
        visible={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        onDone={async () => {
          setDisputeOpen(false);
          await onChanged();
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------- payment

function PaymentPanel({ booking, onPaid }: { booking: Booking; onPaid: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'creating' | 'awaiting'>('idle');
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function createIntent() {
    setState('creating');
    setError(null);
    try {
      const created = await bookingsApi.paymentIntent(booking.id);
      setIntent(created);
      // No provider checkout exists in this build: the intent is real, the money is not. The panel
      // says so instead of pretending the booking is paid.
      setState('awaiting');
      await onPaid();
    } catch (err) {
      setError(err);
      setState('idle');
      if (err instanceof ApiError && err.code === 'PAYMENT_ALREADY_EXISTS') await onPaid();
    }
  }

  return (
    <Card>
      <AppText variant="heading">Confirm and pay</AppText>
      <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
        The traveller accepted. Your price is fixed at {inr(booking.agreed_total_paise)} and comes from the stored
        quote.
      </AppText>

      {state === 'awaiting' ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warn"
            title="Payment requested, not taken"
            body={`A payment of ${inr(
              intent?.amount_paise ?? booking.agreed_total_paise,
            )} was created, but this build has no checkout connected to a payment provider. No money has moved and the booking stays unpaid until a provider confirms a capture.`}
          />
          {intent ? (
            <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm }}>
              Payment reference {intent.id.slice(0, 8)} · sandbox {String(intent.sandbox)}
            </AppText>
          ) : null}
        </View>
      ) : (
        <Button
          label={`Create payment request · ${inr(booking.agreed_total_paise)}`}
          onPress={() => void createIntent()}
          loading={state === 'creating'}
          style={{ marginTop: spacing.md }}
        />
      )}

      {error ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={error} />
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------- handover codes

function SenderCodePanel({ booking, phase }: { booking: Booking; phase: 'pickup' | 'delivery' }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const codeQ = useQuery({
    queryKey: ['handover-code', booking.id, phase],
    queryFn: () => bookingsApi.handoverCode(booking.id, phase),
    retry: false,
    staleTime: 30_000,
  });

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      await bookingsApi.regenerateCode(booking.id, phase);
      await codeQ.refetch();
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const pickup = phase === 'pickup';

  return (
    <Card>
      <AppText variant="heading">{pickup ? 'Pickup code' : 'Delivery code'}</AppText>
      <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
        {pickup
          ? 'Give this to the traveller only after they have the parcel in hand. Do not send it in a message.'
          : 'Share this with the receiver, not the traveller. It proves the parcel reached the right person.'}
      </AppText>

      {codeQ.data ? (
        <View
          style={{
            marginTop: spacing.md,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.line,
            borderRadius: radius.md,
            backgroundColor: colors.canvas,
            paddingVertical: spacing.xl,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 34, letterSpacing: 9, color: colors.ink900 }}>
            {codeQ.data.code}
          </Text>
          <AppText variant="small" tone="muted" style={{ marginTop: 6 }}>
            Valid until {formatDateTime(codeQ.data.expires_at)}. Six digits; read it out.
          </AppText>
        </View>
      ) : (
        <View style={{ marginTop: spacing.md, backgroundColor: colors.canvas, borderRadius: radius.md, padding: spacing.md }}>
          <AppText variant="small" tone="muted">
            {codeQ.isError
              ? 'No active code. If this step is open, send a new code.'
              : 'Loading your code…'}
          </AppText>
        </View>
      )}

      {error ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={error} />
        </View>
      ) : null}

      <Row style={{ marginTop: spacing.md }} gap={spacing.sm}>
        <Button
          label="Send a new code"
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={busy}
          onPress={() => void regenerate()}
        />
        <Button label="Need help?" variant="tertiary" size="sm" fullWidth={false} onPress={() => router.push('/help')} />
      </Row>
    </Card>
  );
}

function HandoverPanel({
  booking,
  phase,
  onDone,
}: {
  booking: Booking;
  phase: 'pickup' | 'delivery';
  onDone: () => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sealIntact, setSealIntact] = useState(false);
  const [weightMatches, setWeightMatches] = useState(false);
  const [receiverConfirmed, setReceiverConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const pickup = phase === 'pickup';
  const checklistOk = pickup ? sealIntact && weightMatches : receiverConfirmed;

  async function attach() {
    setUploading(true);
    setError(null);
    try {
      const photo = await pickPhoto();
      if (!photo) return;
      const uploaded = await filesApi.upload(pickup ? 'parcel_sealed' : 'parcel_delivery', photo.uri, photo.contentType);
      setPhotoKey(uploaded.object_key);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await bookingsApi.confirmHandover(booking.id, phase, {
        otp: code,
        photo_key: photoKey,
        ...(pickup
          ? { checklist: { seal_intact: sealIntact, weight_matches_declaration: weightMatches } }
          : { receiver_name_confirmed: receiverConfirmed }),
      });
      await onDone();
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <AppText variant="heading">{pickup ? 'Confirm pickup' : 'Confirm delivery'}</AppText>
      <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
        {pickup
          ? 'Check the seal, weigh the parcel, then ask the sender for the six-digit code.'
          : 'Hand the parcel to the named receiver, then ask them for the six-digit delivery code.'}
      </AppText>

      <Field
        label={pickup ? 'Pickup code from the sender' : 'Delivery code from the receiver'}
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        style={{ letterSpacing: 8, fontSize: 22, fontFamily: font.semibold }}
      />

      <View style={{ marginTop: spacing.xs }}>
        {pickup ? (
          <>
            <Checkbox
              label="The seal is intact. If it is not, refuse the handover — there is no penalty."
              checked={sealIntact}
              onToggle={() => setSealIntact((v) => !v)}
            />
            <Checkbox
              label="The weight matches the declaration."
              checked={weightMatches}
              onToggle={() => setWeightMatches((v) => !v)}
            />
          </>
        ) : (
          <Checkbox
            label="I handed it to the named receiver."
            checked={receiverConfirmed}
            onToggle={() => setReceiverConfirmed((v) => !v)}
          />
        )}
      </View>

      <Row style={{ marginTop: spacing.sm, justifyContent: 'space-between' }}>
        <Button
          label={photoKey ? 'Photo attached' : pickup ? 'Attach sealed-parcel photo' : 'Attach handover photo'}
          variant={photoKey ? 'secondary' : 'tertiary'}
          size="sm"
          fullWidth={false}
          loading={uploading}
          onPress={() => void attach()}
        />
        {photoKey ? <Badge label="Ready" tone="success" /> : null}
      </Row>

      {error ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={error} />
        </View>
      ) : null}

      <Button
        label={pickup ? 'Confirm pickup' : 'Confirm delivery'}
        onPress={() => void submit()}
        loading={busy}
        disabled={code.length !== 6 || !photoKey || !checklistOk}
        style={{ marginTop: spacing.lg }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------- delivered & reviews

function DeliveredPanel({
  booking,
  role,
  onChanged,
}: {
  booking: Booking;
  role: 'sender' | 'traveller';
  onChanged: () => Promise<void>;
}) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await bookingsApi.review(booking.id, stars, tags);
      setDone(true);
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const copy =
    booking.status === 'delivered'
      ? role === 'sender'
        ? 'The problem window is open. After it closes, the traveller is paid.'
        : 'The sender can raise a problem for 72 hours. Your payout follows after that.'
      : booking.status === 'payout_eligible'
        ? role === 'sender'
          ? 'No problem was raised in time. The traveller’s share is now due.'
          : 'No problem was raised in time. Your share is now due.'
        : role === 'sender'
          ? 'The traveller has been paid.'
          : 'Your share has been paid.';

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{statusLabel(booking.status)}</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
            {copy}
          </AppText>
        </View>
        <Badge label={payoutLabel(booking.payout_state)} tone={payoutTone(booking.payout_state)} />
      </Row>

      <Divider style={{ marginVertical: spacing.md }} />

      <AppText variant="subheading">Rate this {role === 'sender' ? 'traveller' : 'sender'}</AppText>
      <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
        A rating is separate from any case. A good rating never hides a report.
      </AppText>

      {done ? (
        <View style={{ marginTop: spacing.sm }}>
          <Banner tone="success" title="Thanks — your rating is recorded." />
        </View>
      ) : (
        <>
          <Row gap={6} style={{ marginTop: spacing.md }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
                accessibilityState={{ selected: stars >= value }}
                onPress={() => setStars(value)}
                hitSlop={4}
              >
                <Text style={{ fontSize: 30, color: value <= stars ? colors.accent : colors.line }}>★</Text>
              </Pressable>
            ))}
          </Row>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            {REVIEW_TAGS.map((tag) => {
              const active = tags.includes(tag.value);
              return (
                <Pressable
                  key={tag.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() =>
                    setTags((prev) => (active ? prev.filter((t) => t !== tag.value) : [...prev, tag.value]))
                  }
                  style={{
                    borderWidth: 1,
                    borderColor: active ? colors.brand : colors.line,
                    backgroundColor: active ? '#eef4ff' : colors.surface,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: 7,
                  }}
                >
                  <AppText variant="small" tone={active ? 'brand' : 'default'} style={{ fontFamily: font.semibold }}>
                    {tag.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {error ? (
            <View style={{ marginTop: spacing.md }}>
              <ErrorNotice error={error} />
            </View>
          ) : null}

          <Button
            label="Submit rating"
            onPress={() => void submit()}
            loading={busy}
            disabled={stars === 0}
            style={{ marginTop: spacing.md }}
          />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- cases

function CasePanel({ booking, onChanged }: { booking: Booking; onChanged: () => Promise<void> }) {
  const disputeId = booking.dispute?.id ?? '';
  const queryClient = useQueryClient();
  const caseQ = useQuery({
    queryKey: ['dispute', disputeId],
    queryFn: () => disputesApi.get(disputeId),
    enabled: Boolean(disputeId),
  });

  const [note, setNote] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  const dispute: Dispute | undefined = caseQ.data;
  const state = dispute?.state ?? booking.dispute?.state ?? 'open';
  const closed = ['resolved', 'closed'].includes(state);

  async function attach() {
    setUploading(true);
    setError(null);
    try {
      const photo = await pickPhoto();
      if (!photo) return;
      const uploaded = await filesApi.upload('dispute_evidence', photo.uri, photo.contentType);
      setPhotoKey(uploaded.object_key);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await disputesApi.addEvidence(disputeId, note.trim(), photoKey ?? undefined);
      setNote('');
      setPhotoKey(null);
      setSent(true);
      await caseQ.refetch();
      await queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ borderColor: '#f5c9c4' }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">Case open</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
            Case {disputeId.slice(0, 8)}
          </AppText>
        </View>
        <Badge label={state.replace(/_/g, ' ')} tone={closed ? 'success' : 'warn'} />
      </Row>

      <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm }}>
        Payout is frozen until this is resolved. Support contacts both sides. Add photos or a description of what you
        saw below.
      </AppText>

      <DetailRow
        label="Category"
        value={disputeCategoryLabel(dispute?.category ?? booking.dispute?.category ?? '')}
      />
      <DetailRow
        label="Opened"
        value={formatDateTime(dispute?.created_at ?? booking.dispute?.created_at ?? booking.updated_at)}
      />

      <Divider style={{ marginVertical: spacing.md }} />
      <AppText variant="subheading">What has been added</AppText>
      {caseQ.isLoading ? (
        <View style={{ marginTop: spacing.sm }}>
          <LoadingBlock lines={2} />
        </View>
      ) : (dispute?.evidence.length ?? 0) === 0 ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
          Nothing yet. The description from when the case opened is already on file.
        </AppText>
      ) : (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {dispute?.evidence.map((item) => (
            <View
              key={item.id}
              style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.canvas, padding: spacing.sm }}
            >
              <AppText variant="small">{item.note}</AppText>
              <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                {formatDateTime(item.created_at)}
                {item.object_key ? ' · photo attached' : ''}
              </AppText>
            </View>
          ))}
        </View>
      )}

      {closed ? (
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
          This case is closed. Evidence can no longer be added.
        </AppText>
      ) : (
        <>
          <Field
            label="Add to the case"
            value={note}
            onChangeText={(text) => {
              setNote(text);
              setSent(false);
            }}
            placeholder="What did you see, when, and in what condition?"
            multiline
            maxLength={1000}
            style={{ minHeight: 84 }}
            hint="Facts only. This is read by a person."
          />
          <Row style={{ justifyContent: 'space-between', marginBottom: spacing.sm }}>
            <Button
              label={photoKey ? 'Photo attached' : 'Attach a photo'}
              variant={photoKey ? 'secondary' : 'tertiary'}
              size="sm"
              fullWidth={false}
              loading={uploading}
              onPress={() => void attach()}
            />
            {photoKey ? <Badge label="Ready" tone="success" /> : null}
          </Row>

          {error ? (
            <View style={{ marginBottom: spacing.sm }}>
              <ErrorNotice error={error} />
            </View>
          ) : null}
          {sent ? (
            <View style={{ marginBottom: spacing.sm }}>
              <Banner tone="success" title="Added. Support sees it on the case." />
            </View>
          ) : null}

          <Button label="Add to the case" onPress={() => void submit()} loading={busy} disabled={!note.trim()} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- chat

function ChatCard({
  bookingId,
  thread,
  onRetry,
}: {
  bookingId: string;
  thread: UseQueryResult<ChatThread, Error>;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await bookingsApi.sendMessage(bookingId, body);
      setDraft('');
      await thread.refetch();
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  const items = thread.data?.items ?? [];
  const closed = thread.data?.closed ?? false;

  return (
    <Card style={{ marginTop: spacing.md }}>
      <SectionTitle title="Messages" />
      <AppText variant="small" tone="muted">
        Arrange the handover here. Never send the six-digit code in a message.
      </AppText>

      {thread.isLoading ? (
        <View style={{ marginTop: spacing.md }}>
          <LoadingBlock lines={3} />
        </View>
      ) : thread.isError ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={thread.error} onRetry={onRetry} />
        </View>
      ) : items.length === 0 ? (
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
          No messages yet. Say hello and agree where to meet.
        </AppText>
      ) : (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {items.map((message) => (
            <View
              key={message.id}
              style={{
                alignSelf: message.mine ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                backgroundColor: message.kind === 'system' ? colors.warnBg : message.mine ? '#eef4ff' : colors.canvas,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              }}
            >
              <AppText variant="small" tone={message.kind === 'system' ? 'muted' : 'default'}>
                {message.body}
              </AppText>
              <AppText variant="small" tone="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {message.kind === 'system' ? 'Parcel Yatra' : message.mine ? 'You' : message.sender_name} ·{' '}
                {formatDateTime(message.created_at)}
              </AppText>
            </View>
          ))}
        </View>
      )}

      {closed ? (
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
          This conversation is closed because the booking has ended.
        </AppText>
      ) : (
        <>
          <Field
            label="Message"
            value={draft}
            onChangeText={setDraft}
            placeholder="Where should we meet?"
            maxLength={2000}
            multiline
            style={{ minHeight: 44 }}
            hint="Messages are limited to 20 a minute."
          />
          {error ? (
            <View style={{ marginBottom: spacing.sm }}>
              <ErrorNotice error={error} />
            </View>
          ) : null}
          <Button
            label="Send"
            size="sm"
            onPress={() => void send()}
            loading={sending}
            disabled={!draft.trim()}
          />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- timeline

function TimelineCard({ booking, role }: { booking: Booking; role: 'sender' | 'traveller' | null }) {
  return (
    <Card style={{ marginTop: spacing.md }}>
      <SectionTitle title="Status history" />
      <AppText variant="small" tone="muted" style={{ marginBottom: spacing.sm }}>
        Updates come from the people involved, not from a map.
      </AppText>
      {booking.timeline.length === 0 ? (
        <AppText variant="small" tone="muted">
          No events recorded yet.
        </AppText>
      ) : (
        <View>
          {booking.timeline.map((event, index) => (
            <Row key={`${event.occurred_at}-${index}`} style={{ alignItems: 'flex-start', marginBottom: spacing.sm }} gap={spacing.sm}>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  marginTop: 6,
                  backgroundColor: index === booking.timeline.length - 1 ? colors.brand : colors.line,
                }}
              />
              <View style={{ flex: 1 }}>
                <AppText variant="small" style={{ fontFamily: font.semibold }}>
                  {event.from_state ? `${statusLabel(event.from_state)} → ` : ''}
                  {statusLabel(event.to_state)}
                </AppText>
                <AppText variant="small" tone="muted">
                  {actorLabel(event.actor_role, event.actor_kind, role)} · {formatDateTime(event.occurred_at)}
                  {event.reason_code ? ` · ${event.reason_code.replace(/_/g, ' ').toLowerCase()}` : ''}
                </AppText>
              </View>
            </Row>
          ))}
        </View>
      )}
    </Card>
  );
}

function actorLabel(
  actorRole: 'sender' | 'traveller' | null | undefined,
  actorKind: string,
  viewerRole: 'sender' | 'traveller' | null,
): string {
  if (actorRole) {
    if (actorRole === viewerRole) return 'You';
    return actorRole === 'sender' ? 'The sender' : 'The traveller';
  }
  if (actorKind === 'system') return 'Parcel Yatra';
  return actorKind.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------- dispute sheet

function DisputeSheet({
  booking,
  visible,
  onClose,
  onDone,
}: {
  booking: Booking;
  visible: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [category, setCategory] = useState('damaged');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await disputesApi.open(booking.id, category, description.trim());
      setDescription('');
      await onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Raise a problem" scroll>
      <Banner
        tone="danger"
        title="Raising this pauses the traveller’s payment"
        body="It stays frozen until a person reviews the case. Only one case can be open per booking."
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
        {Object.entries(DISPUTE_CATEGORY_LABELS).map(([value, label]) => {
          const active = category === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setCategory(value)}
              style={{
                borderWidth: 1,
                borderColor: active ? colors.brand : colors.line,
                backgroundColor: active ? '#eef4ff' : colors.surface,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: 8,
              }}
            >
              <AppText variant="small" tone={active ? 'brand' : 'default'} style={{ fontFamily: font.semibold }}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Field
        label="What happened?"
        value={description}
        onChangeText={setDescription}
        placeholder="Tell us what you found and when."
        multiline
        maxLength={2000}
        style={{ minHeight: 90 }}
        hint={`${description.trim().length}/2000 · at least 10 characters`}
      />

      {error ? (
        <View style={{ marginBottom: spacing.sm }}>
          <ErrorNotice error={error} />
        </View>
      ) : null}

      <Row gap={spacing.sm}>
        <View style={{ flex: 1 }}>
          <Button label="Not now" variant="secondary" onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Open a case"
            variant="danger"
            loading={busy}
            disabled={description.trim().length < 10}
            onPress={() => void submit()}
          />
        </View>
      </Row>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------- helpers

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 3 }}>
      <AppText variant="small" tone="muted" style={{ width: 120 }}>
        {label}
      </AppText>
      <AppText variant="small" style={{ flex: 1, textAlign: 'right', fontFamily: font.semibold }}>
        {value}
      </AppText>
    </Row>
  );
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function remainingMs(iso: string | null, now: number): number {
  if (!iso) return 0;
  const at = new Date(iso).getTime();
  return Number.isNaN(at) ? 0 : Math.max(0, at - now);
}

function countdownLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
