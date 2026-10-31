import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  API_BASE,
  bookingsApi,
  notificationsApi,
  requestAccountDeletion,
  requestDataExport,
  travellerApi,
  updateMe,
} from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import { SignInPanel } from '../../src/components/auth-gate.tsx';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  Choice,
  ErrorNotice,
  Field,
  Row,
  Screen,
  Sheet,
} from '../../src/components/ui.tsx';
import { Avatar, IconBubble, MenuRow } from '../../src/components/kit.tsx';
import { formatDateTime, statusLabel, statusTone } from '../../src/lib/format.ts';
import { colors, font, radius, spacing } from '../../src/theme.ts';

export default function ProfileScreen() {
  const { status, user, offline } = useSession();

  if (status !== 'signed_in' || !user) {
    return (
      <Screen contentStyle={{ paddingBottom: 128 }}>
        <View
          style={{
            backgroundColor: colors.navy,
            borderRadius: radius.xl,
            padding: spacing.xl,
            marginBottom: spacing.lg,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              width: 150,
              height: 150,
              borderRadius: 75,
              backgroundColor: 'rgba(10,87,255,0.35)',
              right: -50,
              top: -60,
            }}
          />
          <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.1 }}>
            YOUR ACCOUNT
          </AppText>
          <AppText variant="title" tone="white" style={{ marginTop: 4 }}>
            One identity, both sides
          </AppText>
          <AppText variant="small" tone="onDark" style={{ marginTop: 2 }}>
            Send parcels, carry on your route, and keep verification and receipts together.
          </AppText>
        </View>
        <SignInPanel
          title="Your account"
          body="Sign in to see your verification, notifications and account settings."
          next="/profile"
        />
      </Screen>
    );
  }

  return <ProfileBody user={user} offline={offline} />;
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
  const bookings = useQuery({ queryKey: ['bookings', 'all'], queryFn: () => bookingsApi.list() });
  const trips = useQuery({ queryKey: ['trips'], queryFn: travellerApi.trips });

  const [name, setName] = useState(user.name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [locale, setLocale] = useState<'en-IN' | 'hi-IN'>(user.locale === 'hi-IN' ? 'hi-IN' : 'en-IN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const [exportBusy, setExportBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const vState = verification.data?.state ?? user.verification_state;
  const unread = notifications.data?.unread_count ?? 0;
  const bookingCount = bookings.data?.items.length ?? 0;
  const tripCount = trips.data?.items.length ?? 0;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const nextEmail = email.trim();
      await updateMe({
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(nextEmail && nextEmail !== (user.email ?? '') ? { email: nextEmail } : {}),
        locale,
      });
      await refreshProfile();
      setSaved(true);
      setDetailsOpen(false);
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

  async function exportData() {
    setExportBusy(true);
    setExportNote(null);
    try {
      const result = await requestDataExport();
      setExportNote(result.message ?? 'Your export request was recorded. Support will follow up.');
    } catch (err) {
      const copy =
        err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
          ? err.message
          : 'Your data export needs a background worker that is not deployed here. Contact support and we will produce it manually.';
      setExportNote(copy);
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <Screen contentStyle={{ paddingBottom: 128 }}>
      {offline ? (
        <View style={{ marginBottom: spacing.md }}>
          <Banner
            tone="warn"
            title="You are offline"
            body="Showing the last profile we stored. Changes need a connection and will fail without one."
          />
        </View>
      ) : null}

      {/* identity card */}
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
            width: 170,
            height: 170,
            borderRadius: 85,
            backgroundColor: 'rgba(10,87,255,0.30)',
            right: -60,
            top: -80,
          }}
        />
        <Row gap={spacing.md} style={{ alignItems: 'center' }}>
          <View style={{ borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 34 }}>
            <Avatar name={user.name} size={60} tone="navy" />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="heading" tone="white" numberOfLines={1}>
              {user.name ?? (user.phone_last4 ? `Account ending ${user.phone_last4}` : 'Your account')}
            </AppText>
            <AppText variant="small" tone="onDark" numberOfLines={1} style={{ marginTop: 1 }}>
              {user.phone_last4
                ? `Phone ending ${user.phone_last4}`
                : (user.email ?? 'Signed in with Google')}
            </AppText>
            <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
              <Badge label={statusLabel(vState)} tone={statusTone(vState)} />
              {user.roles?.includes('admin') ? <Badge label="Admin" tone="info" /> : null}
            </Row>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit personal details"
            onPress={() => setDetailsOpen(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="pencil" size={16} color={colors.white} />
          </Pressable>
        </Row>

        <Row gap={spacing.md} style={{ marginTop: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <AppText variant="price" style={{ color: colors.white }}>
              {bookingCount}
            </AppText>
            <AppText variant="micro" style={{ color: '#9fb0cc', fontFamily: font.regular }}>
              Bookings
            </AppText>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.16)' }} />
          <View style={{ flex: 1 }}>
            <AppText variant="price" style={{ color: colors.white }}>
              {tripCount}
            </AppText>
            <AppText variant="micro" style={{ color: '#9fb0cc', fontFamily: font.regular }}>
              Trips
            </AppText>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.16)' }} />
          <View style={{ flex: 1 }}>
            <AppText variant="price" style={{ color: colors.white, fontSize: 16, marginTop: 4 }}>
              {formatDateTime(user.created_at).split(',')[0]}
            </AppText>
            <AppText variant="micro" style={{ color: '#9fb0cc', fontFamily: font.regular }}>
              Member since
            </AppText>
          </View>
        </Row>
      </View>

      {/* verification prompt */}
      {vState !== 'verified' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/verification')}
          style={({ pressed }) => [
            {
              marginTop: spacing.md,
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: '#f0dfb0',
              padding: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
            },
            pressed && { opacity: 0.88 },
          ]}
        >
          <IconBubble name="shield-outline" size={40} background={colors.warnBg} color={colors.warn} />
          <View style={{ flex: 1 }}>
            <AppText variant="subheading">
              {vState === 'pending' ? 'Verification under review' : 'Get verified to carry parcels'}
            </AppText>
            <AppText variant="small" tone="muted">
              {vState === 'pending'
                ? 'A person checks your ID, usually within 24 hours.'
                : 'One photo ID and a selfie. Never Aadhaar.'}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.ink300} />
        </Pressable>
      ) : null}

      {/* account */}
      <AppText variant="label" tone="muted" style={{ marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: 0.9 }}>
        ACCOUNT
      </AppText>
      <View style={menuCard}>
        <MenuRow
          icon="person-outline"
          label="Personal details"
          meta="Name, email and language"
          onPress={() => {
            setSaved(false);
            setError(null);
            setDetailsOpen(true);
          }}
        />
        <MenuRow
          icon="shield-checkmark-outline"
          label="Verification"
          meta={verification.data?.id_type ? `Submitted with ${verification.data.id_type.replace(/_/g, ' ')}` : 'Required to carry parcels'}
          value={statusLabel(vState)}
          onPress={() => router.push('/verification')}
        />
        <MenuRow
          icon="notifications-outline"
          label="Notifications"
          meta="Booking updates and decisions"
          value={unread > 0 ? `${unread} new` : undefined}
          onPress={() => router.push('/notifications')}
        />
        <MenuRow
          icon="chatbubbles-outline"
          label="Messages"
          meta="Every booking conversation"
          onPress={() => router.push('/inbox')}
          last
        />
      </View>

      {/* partner */}
      <AppText variant="label" tone="muted" style={{ marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: 0.9 }}>
        PARTNER
      </AppText>
      <View style={menuCard}>
        <MenuRow
          icon="car-outline"
          label="My trips"
          meta="Published routes and capacity"
          tone="partner"
          onPress={() => router.push('/trips')}
        />
        <MenuRow
          icon="add-circle-outline"
          label="Publish a trip"
          meta="Earn from a drive you are already making"
          tone="partner"
          onPress={() => router.push('/trips/new')}
          last
        />
      </View>

      {/* support & legal */}
      <AppText variant="label" tone="muted" style={{ marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: 0.9 }}>
        SUPPORT & LEGAL
      </AppText>
      <View style={menuCard}>
        <MenuRow
          icon="help-buoy-outline"
          label="Help and support"
          meta="FAQ, safety, disputes"
          tone="navy"
          onPress={() => router.push('/help')}
        />
        <MenuRow
          icon="pricetag-outline"
          label="Pricing"
          meta="What you pay, and what a traveller earns"
          tone="navy"
          onPress={() => router.push('/info/pricing')}
        />
        <MenuRow
          icon="shield-half-outline"
          label="Safety"
          meta="Handover codes, sealing and checks"
          tone="navy"
          onPress={() => router.push('/info/safety')}
        />
        <MenuRow
          icon="ban-outline"
          label="Prohibited items"
          meta="What can never travel"
          tone="navy"
          onPress={() => router.push('/info/prohibited')}
        />
        <MenuRow
          icon="document-text-outline"
          label="Terms of service"
          tone="navy"
          onPress={() => router.push('/info/terms')}
        />
        <MenuRow
          icon="lock-closed-outline"
          label="Privacy policy"
          tone="navy"
          onPress={() => router.push('/info/privacy')}
        />
        <MenuRow
          icon="megaphone-outline"
          label="Grievance officer"
          meta="How to escalate a complaint"
          tone="navy"
          onPress={() => router.push('/info/grievance')}
          last
        />
      </View>

      {/* data & session */}
      <AppText variant="label" tone="muted" style={{ marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: 0.9 }}>
        DATA & SESSION
      </AppText>
      <View style={menuCard}>
        <MenuRow
          icon="download-outline"
          label="Download my data"
          meta={exportBusy ? 'Requesting…' : 'A copy of your account records'}
          tone="navy"
          onPress={exportBusy ? () => {} : exportData}
        />
        <MenuRow
          icon="log-out-outline"
          label="Sign out"
          meta="End this session"
          tone="navy"
          onPress={() => setSignOutOpen(true)}
          last
        />
      </View>

      {exportNote ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner tone="info" title="Data export" body={exportNote} />
        </View>
      ) : null}

      <Card style={{ marginTop: spacing.md, backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
        <AppText variant="subheading">Close your account</AppText>
        <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
          Deletion signs you out immediately. It is refused while a booking is still open.
        </AppText>
        <Button
          label="Delete account"
          variant="tertiary"
          onPress={() => setDeleteOpen(true)}
          style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
        />
      </Card>

      <AppText variant="micro" tone="muted" style={{ marginTop: spacing.lg, textAlign: 'center', fontFamily: font.regular }}>
        Parcel Yatra {version}
        {'\n'}
        {API_BASE.replace(/^https?:\/\//, '')}
      </AppText>

      {/* details sheet */}
      <Sheet visible={detailsOpen} onClose={() => setDetailsOpen(false)} title="Personal details" scroll>
        <AppText variant="small" tone="muted" style={{ marginBottom: spacing.md }}>
          Only your name and email are shown to the other side. Never your phone number.
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
      </Sheet>

      <Sheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} title="Sign out?">
        <AppText variant="body">
          Sign out only this phone, or end every session on all phones and browsers. You can sign in again
          with Google.
        </AppText>
        <Button label="Sign out this phone" variant="danger" onPress={() => void doSignOut(false)} style={{ marginTop: spacing.lg }} />
        <Button label="Sign out everywhere" variant="secondary" onPress={() => void doSignOut(true)} style={{ marginTop: spacing.sm }} />
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

const menuCard = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.line,
  overflow: 'hidden' as const,
};
