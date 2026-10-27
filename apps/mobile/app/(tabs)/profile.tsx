import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { API_BASE, notificationsApi, requestAccountDeletion, travellerApi, updateMe } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import { SignInPanel } from '../../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  Choice,
  Divider,
  ErrorNotice,
  Field,
  Row,
  Screen,
  Sheet,
} from '../../src/components/ui.tsx';
import {
  formatDateTime,
  initials,
  statusLabel,
  statusTone,
} from '../../src/lib/format.ts';
import { colors, font, spacing } from '../../src/theme.ts';

export default function ProfileScreen() {
  const { status, user, offline } = useSession();

  if (status !== 'signed_in' || !user) {
    return (
      <Screen>
        <SignInPanel
          title="Your account"
          body="Sign in to see your verification, notifications and account settings."
          next="/profile"
        />
      </Screen>
    );
  }

  return (
    <ProfileBody
      user={user}
      offline={offline}
    />
  );
}

function ProfileBody({
  user,
  offline,
}: {
  user: NonNullable<ReturnType<typeof useSession>['user']>;
  offline: boolean;
}) {
  const { refreshProfile, signOut } = useSession();
  const queryClient = useQueryClient();
  const verification = useQuery({ queryKey: ['verification'], queryFn: travellerApi.verification });
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list });

  const [name, setName] = useState(user.name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [locale, setLocale] = useState<'en-IN' | 'hi-IN'>(user.locale === 'hi-IN' ? 'hi-IN' : 'en-IN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const vState = verification.data?.state ?? user.verification_state;
  const unread = notifications.data?.unread_count ?? 0;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateMe({
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        locale,
      });
      await refreshProfile();
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await requestAccountDeletion();
      setDeleteOpen(false);
      await signOut();
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function doSignOut(everywhere: boolean) {
    setSignOutOpen(false);
    await signOut(everywhere);
    queryClient.clear();
  }

  return (
    <Screen>
      {offline ? (
        <View style={{ marginBottom: spacing.md }}>
          <Banner
            tone="warn"
            title="You are offline"
            body="Showing the last profile we stored. Changes need a connection and will fail without one."
          />
        </View>
      ) : null}

      <Card>
        <Row gap={spacing.md} style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: '#eaf1ff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="heading" tone="brand" style={{ fontFamily: font.bold }}>
              {initials(user.name)}
            </AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="heading">
              {user.name ?? (user.phone_last4 ? `Account ending ${user.phone_last4}` : 'Your account')}
            </AppText>
            <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
              {user.phone_last4
                ? `Phone ending ${user.phone_last4}, ${user.phone_verified ? 'verified' : 'not verified'}. We never show the full number.`
                : `Signed in as ${user.email ?? 'a Google account'}.`}
            </AppText>
          </View>
        </Row>
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <AppText variant="heading">Details</AppText>
        <AppText variant="small" tone="muted" style={{ marginTop: 2, marginBottom: spacing.md }}>
          Only your name and email are shown to the other side. Never your number.
        </AppText>

        <Field
          label="Name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setSaved(false);
          }}
          maxLength={80}
          placeholder="e.g. Aarti"
          hint="First name is enough. This is what the other side sees."
        />
        <Field
          label="Email"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setSaved(false);
          }}
          maxLength={254}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
          hint="Used for receipts only. If you signed in with Google, this address is managed there."
        />

        <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
          Language
        </AppText>
        <Choice label="English" selected={locale === 'en-IN'} onPress={() => setLocale('en-IN')} />
        <Choice label="हिन्दी (Hindi)" selected={locale === 'hi-IN'} onPress={() => setLocale('hi-IN')} />

        {error ? (
          <View style={{ marginTop: spacing.sm }}>
            <ErrorNotice error={error} />
          </View>
        ) : null}
        {saved ? (
          <View style={{ marginTop: spacing.sm }}>
            <Banner tone="success" title="Saved" />
          </View>
        ) : null}

        <Button label="Save changes" onPress={save} loading={busy} style={{ marginTop: spacing.md }} />
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="heading">Verification</AppText>
            <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
              {verification.data?.id_type
                ? `Submitted with ${verification.data.id_type.replace(/_/g, ' ')}.`
                : 'Required before you can publish a trip.'}
            </AppText>
          </View>
          <Badge label={statusLabel(vState)} tone={statusTone(vState)} />
        </Row>
        <Button
          label={vState === 'verified' ? 'View verification' : 'Manage verification'}
          variant="secondary"
          onPress={() => router.push('/verification')}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <LinkRow
          label="Notifications"
          meta={unread > 0 ? `${unread} unread` : 'Nothing unread'}
          onPress={() => router.push('/notifications')}
        />
        <Divider />
        <LinkRow label="Help and support" meta="FAQ, safety, disputes" onPress={() => router.push('/help')} />
        <Divider />
        <LinkRow label="My bookings" meta="Parcels you sent or carried" onPress={() => router.push('/bookings')} />
      </Card>

      <Card style={{ marginTop: spacing.md, backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
        <AppText variant="subheading">Account</AppText>
        <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
          Signed in since {formatDateTime(user.created_at)}.
        </AppText>
        <Button label="Sign out" variant="secondary" onPress={() => setSignOutOpen(true)} style={{ marginTop: spacing.md }} />
        <Button
          label="Delete account"
          variant="tertiary"
          onPress={() => setDeleteOpen(true)}
          style={{ marginTop: spacing.xs }}
        />
      </Card>

      <AppText variant="small" tone="muted" style={{ marginTop: spacing.lg, textAlign: 'center' }}>
        Parcel Yatra {version}
        {'\n'}
        {API_BASE.replace(/^https?:\/\//, '')}
      </AppText>

      <Sheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} title="Sign out?">
        <AppText variant="body">
          Signing out of every device also ends sessions on other phones and browsers. You can sign in again
          with a phone code.
        </AppText>
        <Button label="Sign out" variant="danger" onPress={() => void doSignOut(true)} style={{ marginTop: spacing.lg }} />
        <Button label="Cancel" variant="secondary" onPress={() => setSignOutOpen(false)} style={{ marginTop: spacing.sm }} />
      </Sheet>

      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete your account?">
        <Banner
          tone="danger"
          title="This signs you out immediately"
          body="Your profile stops being usable now. We remove the rest within 30 days, except records we must keep for payments, disputes and audits."
        />
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.md }}>
          You need no open bookings. If any exist, the request is refused and nothing changes. Deleting an
          account does not cancel a booking already in transit.
        </AppText>
        {deleteError ? (
          <View style={{ marginTop: spacing.md }}>
            <ErrorNotice error={deleteError} />
          </View>
        ) : null}
        <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <Button label="Keep my account" variant="secondary" onPress={() => setDeleteOpen(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Delete account" variant="danger" loading={deleteBusy} onPress={deleteAccount} />
          </View>
        </Row>
      </Sheet>
    </Screen>
  );
}

function LinkRow({ label, meta, onPress }: { label: string; meta?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <AppText variant="body" style={{ fontFamily: font.semibold }}>
          {label}
        </AppText>
        {meta ? (
          <AppText variant="small" tone="muted">
            {meta}
          </AppText>
        ) : null}
      </View>
      <AppText variant="body" tone="muted">
        ›
      </AppText>
    </Pressable>
  );
}
