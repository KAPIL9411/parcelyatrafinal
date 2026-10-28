import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { filesApi, travellerApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/http.ts';
import type { IdType } from '../src/lib/format.ts';
import { AuthGate } from '../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Choice,
  ErrorNotice,
  LoadingBlock,
  Row,
  Screen,
} from '../src/components/ui.tsx';
import { useSession } from '../src/session.tsx';
import { pickPhoto } from '../src/lib/photo.ts';
import {
  ID_TYPES,
  ID_TYPE_LABELS,
  formatDateTime,
  statusLabel,
  statusTone,
  verificationReason,
} from '../src/lib/format.ts';
import { colors, font, radius, spacing } from '../src/theme.ts';

export default function VerificationScreen() {
  return (
    <AuthGate next="/verification">
      <VerificationFlow />
    </AuthGate>
  );
}

function VerificationFlow() {
  const queryClient = useQueryClient();
  const { refreshProfile } = useSession();
  const verification = useQuery({ queryKey: ['verification'], queryFn: travellerApi.verification });

  const [idType, setIdType] = useState<IdType>('driving_licence');
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [backKey, setBackKey] = useState<string | null>(null);
  const [selfieKey, setSelfieKey] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState<'front' | 'back' | 'selfie' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const record = verification.data;
  const state = record?.state ?? 'not_started';
  const attemptsLeft = Math.max(0, 3 - (record?.attempts ?? 0));
  const showForm = state === 'not_started' || (state === 'rejected' && retrying);
  const canSubmit = Boolean(frontKey && selfieKey && consent) && !busy;

  function startRetry() {
    // A rejection starts a new attempt, so the old uploads are not carried into it.
    setFrontKey(null);
    setBackKey(null);
    setSelfieKey(null);
    setConsent(false);
    setError(null);
    setRetrying(true);
  }

  async function attach(
    purpose: 'kyc_id' | 'kyc_selfie',
    setKey: (key: string) => void,
    label: 'front' | 'back' | 'selfie',
  ) {
    setUploading(label);
    setError(null);
    try {
      const picked = await pickPhoto();
      if (!picked) return;
      const uploaded = await filesApi.upload(purpose, picked.uri, picked.contentType);
      setKey(uploaded.object_key);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    if (!frontKey || !selfieKey || !consent) return;
    setBusy(true);
    setError(null);
    try {
      await travellerApi.submitVerification({
        id_type: idType,
        id_front_key: frontKey,
        ...(backKey ? { id_back_key: backKey } : {}),
        selfie_key: selfieKey,
        consent_version: 'v1',
      });
      setRetrying(false);
      await queryClient.invalidateQueries({ queryKey: ['verification'] });
      await refreshProfile();
    } catch (err) {
      setError(err);
      // The stored keys no longer resolve, so pressing submit again would repeat the refusal.
      if (
        err instanceof ApiError &&
        (err.code === 'UPLOAD_EXPIRED' || (err.code === 'VALIDATION_FAILED' && err.details.field === 'object_key'))
      ) {
        setFrontKey(null);
        setBackKey(null);
        setSelfieKey(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (verification.isLoading) {
    return (
      <Screen>
        <Card>
          <LoadingBlock lines={5} />
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

  return (
    <Screen>
      <View
        style={{
          backgroundColor: colors.navy,
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
            backgroundColor: 'rgba(10,87,255,0.32)',
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
              backgroundColor: 'rgba(232,179,60,0.18)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="shield-checkmark" size={24} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.1 }}>
              TRAVELLER VERIFICATION
            </AppText>
            <AppText variant="title" tone="white" style={{ marginTop: 3 }}>
              Verify your ID
            </AppText>
          </View>
          <Badge label={statusLabel(state)} tone={statusTone(state)} />
        </Row>
        <AppText variant="small" tone="onDark" style={{ marginTop: spacing.sm }}>
          One photo ID and a selfie. A person checks them. It usually takes under 24 hours.
        </AppText>
        <VerifySteps state={state} />
      </View>

      {state === 'verified' ? (
        <Card style={{ marginTop: spacing.lg }}>
          <Banner tone="success" title="You are verified to carry parcels" />
          <AppText variant="body" style={{ marginTop: spacing.md }}>
            {record?.decided_at ? `Approved on ${formatDateTime(record.decided_at)}. ` : ''}
            You can publish a trip now.
          </AppText>
          <Button label="Publish a trip" onPress={() => router.push('/trips/new')} style={{ marginTop: spacing.lg }} />
          <Button label="See my trips" variant="secondary" onPress={() => router.replace('/trips')} style={{ marginTop: spacing.sm }} />
        </Card>
      ) : null}

      {state === 'pending' ? (
        <Card style={{ marginTop: spacing.lg }}>
          <Banner
            tone="warn"
            title="Your verification is with our team"
            body="Usually within 24 hours. We will tell you when it is decided. Publishing stays locked until then."
          />
          <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
            Submitted {record ? formatDateTime(record.created_at) : ''} using{' '}
            {record?.id_type ? ID_TYPE_LABELS[record.id_type as IdType] ?? record.id_type : 'a photo ID'}.
          </AppText>
          <Button label="Contact support" variant="secondary" onPress={() => router.push('/help')} style={{ marginTop: spacing.lg }} />
        </Card>
      ) : null}

      {state === 'rejected' ? (
        <Card style={{ marginTop: spacing.lg }}>
          <Banner tone="danger" title="This verification was not accepted" body={verificationReason(record?.reason_code ?? null)} />
          <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
            {attemptsLeft > 0
              ? `You have ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left. Check the reason above, then submit again with clearer photos.`
              : 'You have used all three attempts. Contact support and a person will help you continue.'}
          </AppText>
          <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
            {attemptsLeft > 0 && !retrying ? (
              <View style={{ flex: 1 }}>
                <Button label="Try again" variant="secondary" onPress={startRetry} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button label="Contact support" variant="tertiary" onPress={() => router.push('/help')} />
            </View>
          </Row>
        </Card>
      ) : null}

      {showForm ? (
        <Card style={{ marginTop: spacing.lg }}>
          <AppText variant="heading">Your ID</AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: 2, marginBottom: spacing.md }}>
            Use the original document, not a photocopy.
          </AppText>

          <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
            Document type
          </AppText>
          {ID_TYPES.map((type) => (
            <Choice
              key={type}
              label={ID_TYPE_LABELS[type]}
              selected={idType === type}
              onPress={() => setIdType(type)}
            />
          ))}

          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            <PhotoRow
              label="Front of the ID"
              hint="All four corners visible, no glare, number readable."
              attached={Boolean(frontKey)}
              busy={uploading === 'front'}
              onPick={() => void attach('kyc_id', setFrontKey, 'front')}
              onClear={() => setFrontKey(null)}
            />
            <PhotoRow
              label="Back of the ID (optional)"
              hint="Only if your document has information on the back."
              attached={Boolean(backKey)}
              busy={uploading === 'back'}
              onPick={() => void attach('kyc_id', setBackKey, 'back')}
              onClear={() => setBackKey(null)}
            />
            <PhotoRow
              label="A selfie"
              hint="Your face and the ID in the same photo, both clear."
              attached={Boolean(selfieKey)}
              busy={uploading === 'selfie'}
              onPick={() => void attach('kyc_selfie', setSelfieKey, 'selfie')}
              onClear={() => setSelfieKey(null)}
            />
          </View>

          <Checkbox
            checked={consent}
            onToggle={() => setConsent((value) => !value)}
            label="I agree to my ID being checked for this purpose. The photos are used to decide this verification and are not shown to senders."
          />

          {error ? (
            <View style={{ marginTop: spacing.sm }}>
              <ErrorNotice error={error} />
            </View>
          ) : null}

          <Button
            label="Submit for verification"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
            style={{ marginTop: spacing.md }}
          />
          <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm }}>
            A person decides. Nothing is verified automatically, and nothing is published in the meantime.
          </AppText>
        </Card>
      ) : null}

      <Card style={{ marginTop: spacing.lg, backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
        <AppText variant="subheading">What we ask for, and what we do not</AppText>
        <Fact text="A driving licence, voter ID or passport, plus a selfie holding or beside it." />
        <Fact text="We never ask for Aadhaar, and we do not accept it if offered." />
        <Fact text="Photos are visible only to the reviewer. They are not shown to senders." />
        <Fact text="Three failed attempts need a person: contact support to continue." />
      </Card>
    </Screen>
  );
}

function PhotoRow({
  label,
  hint,
  attached,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  attached: boolean;
  busy: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: attached ? '#c6e5d3' : colors.line,
        backgroundColor: attached ? colors.successBg : colors.surface,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <AppText variant="subheading">{label}</AppText>
      <AppText variant="small" tone="muted">
        {hint}
      </AppText>
      <Row gap={spacing.sm} style={{ marginTop: spacing.sm, alignItems: 'center' }}>
        <Button
          label={attached ? 'Replace photo' : 'Choose photo'}
          variant="secondary"
          size="sm"
          loading={busy}
          fullWidth={false}
          onPress={onPick}
        />
        {attached ? (
          <>
            <AppText variant="small" tone="success" style={{ fontFamily: font.semibold }}>
              Attached
            </AppText>
            <Button label="Remove" variant="tertiary" size="sm" fullWidth={false} onPress={onClear} />
          </>
        ) : null}
      </Row>
    </View>
  );
}

function Fact({ text }: { text: string }) {
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

function VerifySteps({ state }: { state: string }) {
  const labels = ['Photos', 'Review', 'Approved'];
  const completed = state === 'verified' ? 3 : state === 'pending' ? 1 : 0;
  return (
    <Row gap={0} style={{ marginTop: spacing.lg, alignItems: 'flex-start' }}>
      {labels.map((label, index) => {
        const done = index < completed;
        const current = index === completed;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <Row gap={0} style={{ width: '100%', alignItems: 'center' }}>
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: index === 0 ? 'transparent' : done || current ? colors.accent : 'rgba(255,255,255,0.20)',
                }}
              />
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: done ? colors.accent : 'transparent',
                  borderWidth: done ? 0 : 2,
                  borderColor: current ? colors.white : 'rgba(255,255,255,0.30)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done ? (
                  <Ionicons name="checkmark" size={12} color={colors.navy} />
                ) : (
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: current ? colors.white : 'transparent',
                    }}
                  />
                )}
              </View>
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor:
                    index === labels.length - 1
                      ? 'transparent'
                      : index < completed
                        ? colors.accent
                        : 'rgba(255,255,255,0.20)',
                }}
              />
            </Row>
            <AppText
              variant="micro"
              numberOfLines={1}
              style={{
                marginTop: 6,
                color: done ? colors.accent : current ? colors.white : 'rgba(255,255,255,0.55)',
                fontFamily: current ? font.bold : font.regular,
              }}
            >
              {label}
            </AppText>
          </View>
        );
      })}
    </Row>
  );
}
