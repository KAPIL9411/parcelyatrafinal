import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bookingsApi, conversationsApi, notificationsApi, senderApi } from '../../src/api/client.ts';
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
} from '../../src/components/ui.tsx';
import {
  Avatar,
  IconBubble,
  InfoNote,
  QuickTile,
  RouteTimeline,
  SearchPill,
  SectionHead,
  StatusTrack,
} from '../../src/components/kit.tsx';
import {
  categoryLabel,
  formatDateTime,
  inr,
  kg,
  statusLabel,
  statusTone,
  timeAgo,
} from '../../src/lib/format.ts';
import { colors, font, radius, shadow, spacing } from '../../src/theme.ts';

const CLOSED_STATUSES = new Set([
  'delivered',
  'payout_eligible',
  'paid_out',
  'cancelled_by_sender',
  'cancelled_by_traveller',
  'cancelled_ineligible',
  'cancelled_safety',
  'expired',
  'refunded',
]);

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

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const { status, user } = useSession();
  const insets = useSafeAreaInsets();

  const config = useQuery({ queryKey: ['config'], queryFn: senderApi.config, staleTime: 10 * 60_000 });
  const bookings = useQuery({
    queryKey: ['bookings', 'recent'],
    queryFn: () => bookingsApi.list(),
    enabled: status === 'signed_in',
  });
  const inbox = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationsApi.list,
    enabled: status === 'signed_in',
    refetchInterval: 60_000,
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
    enabled: status === 'signed_in',
    refetchInterval: 60_000,
  });

  const refreshing =
    config.isRefetching || bookings.isRefetching || inbox.isRefetching || notifications.isRefetching;
  const all = bookings.data?.items ?? [];
  const active = all.find((booking) => !CLOSED_STATUSES.has(booking.status));
  const recent = all.slice(0, 3);
  const unread = notifications.data?.unread_count ?? 0;
  const unreadMessages = inbox.data?.total_unread ?? 0;
  const firstName = user?.name?.trim().split(/\s+/)[0];

  return (
    <Screen
      contentStyle={{ padding: 0 }}
      background={colors.canvas}
      refreshControl={
        <Refresh
          refreshing={refreshing}
          onRefresh={() => {
            void config.refetch();
            if (status === 'signed_in') {
              void bookings.refetch();
              void inbox.refetch();
              void notifications.refetch();
            }
          }}
        />
      }
    >
      {/* ---------------------------------------------------------------- hero */}
      <View
        style={{
          backgroundColor: colors.navy,
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: 62,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: 230,
            height: 230,
            borderRadius: 115,
            backgroundColor: 'rgba(10,87,255,0.30)',
            top: -110,
            right: -70,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: 130,
            height: 130,
            borderRadius: 65,
            backgroundColor: 'rgba(232,179,60,0.12)',
            bottom: -70,
            left: -30,
          }}
        />

        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Row gap={6}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent }} />
              <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.2 }}>
                PARCEL YATRA
              </AppText>
            </Row>
            <AppText variant="title" tone="white" style={{ marginTop: spacing.sm }}>
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </AppText>
            <AppText variant="small" tone="onDark" style={{ marginTop: 2 }}>
              Send it with someone already going your way.
            </AppText>
          </View>
          <Row gap={spacing.sm}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unreadMessages ? `${unreadMessages} unread messages` : 'Inbox'}
              onPress={() => router.push('/inbox')}
              style={styles.heroIcon}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.white} />
              {unreadMessages > 0 ? <View style={styles.heroDot} /> : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unread ? `${unread} unread notifications` : 'Notifications'}
              onPress={() => router.push('/notifications')}
              style={styles.heroIcon}
            >
              <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={20} color={colors.white} />
              {unread > 0 ? (
                <View style={styles.heroBadge}>
                  <AppText style={{ color: colors.white, fontFamily: font.bold, fontSize: 9 }}>
                    {unread > 9 ? '9+' : unread}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          </Row>
        </Row>

        <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
          <View style={styles.heroPill}>
            <Ionicons name="shield-checkmark" size={12} color={colors.accent} />
            <AppText variant="micro" style={{ color: colors.white, fontFamily: font.regular }}>
              ID-verified travellers
            </AppText>
          </View>
          <View style={styles.heroPill}>
            <Ionicons name="cube-outline" size={12} color={colors.accent} />
            <AppText variant="micro" style={{ color: colors.white, fontFamily: font.regular }}>
              Up to {config.data?.limits.max_weight_kg ?? 5} kg
            </AppText>
          </View>
        </Row>
      </View>

      {/* ---------------------------------------------------------------- search */}
      <View style={{ marginTop: -40, paddingHorizontal: spacing.lg }}>
        <SearchPill
          placeholder="Where should we send it?"
          badge="Send"
          onPress={() => router.push('/send')}
        />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl }}>
        {/* -------------------------------------------------------------- quick actions */}
        <Row gap={spacing.md} style={{ alignItems: 'stretch' }}>
          <QuickTile
            icon="cube"
            title="Send a parcel"
            subtitle="City to city, on your schedule"
            onPress={() => router.push('/send')}
          />
          <QuickTile
            icon="car-sport"
            title="Carry & earn"
            subtitle="Use the space you already have"
            onPress={() => router.push('/trips/new')}
            tint={colors.partnerSoft}
            iconColor={colors.partner}
          />
        </Row>
        <Row gap={spacing.md} style={{ alignItems: 'stretch', marginTop: spacing.md }}>
          <QuickTile
            icon="receipt"
            title="My bookings"
            subtitle="Track every shipment"
            onPress={() => router.push('/bookings')}
            tint={colors.accentSoft}
            iconColor={colors.warn}
            badge={active ? '1 live' : undefined}
          />
          <QuickTile
            icon="help-circle"
            title="Help & safety"
            subtitle="Policies, FAQ and support"
            onPress={() => router.push('/help')}
            tint={colors.canvasAlt}
            iconColor={colors.navy}
          />
        </Row>

        {/* -------------------------------------------------------------- active shipment */}
        {status === 'signed_in' && active ? (
          <View style={{ marginTop: spacing.xxl }}>
            <SectionHead
              eyebrow="Live now"
              title="Your parcel is moving"
              actionLabel="All bookings"
              onAction={() => router.push('/bookings')}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/bookings/${active.id}`)}
              style={({ pressed }) => [styles.activeCard, shadow.card, pressed && { opacity: 0.92 }]}
            >
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Row gap={spacing.sm}>
                  <View style={styles.liveDot} />
                  <AppText variant="micro" tone="brand" style={{ letterSpacing: 0.6 }}>
                    {active.role === 'sender' ? 'YOU ARE SENDING' : 'YOU ARE CARRYING'}
                  </AppText>
                </Row>
                <Badge label={statusLabel(active.status)} tone={statusTone(active.status)} />
              </Row>
              <View style={{ marginTop: spacing.md }}>
                <RouteTimeline
                  origin={active.origin_city}
                  dest={active.dest_city}
                  originMeta={`${categoryLabel(active.category)} · ${kg(active.weight_kg)}`}
                  destMeta={`Booked ${timeAgo(active.created_at)}`}
                  compact
                />
              </View>
              <View style={{ marginTop: spacing.md }}>
                <StatusTrack status={active.status} tone={active.role === 'traveller' ? 'partner' : 'brand'} />
              </View>
              <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
                <AppText variant="small" tone="muted">
                  {active.role === 'sender' ? 'Traveller' : 'Sender'} ·{' '}
                  {active.role === 'sender' ? 'verified partner' : 'sender'}
                </AppText>
                <Row gap={4}>
                  <AppText variant="subheading" tone="brand">
                    Track
                  </AppText>
                  <Ionicons name="arrow-forward" size={15} color={colors.brandDark} />
                </Row>
              </Row>
            </Pressable>
          </View>
        ) : null}

        {/* -------------------------------------------------------------- categories */}
        <View style={{ marginTop: spacing.xxl }}>
          <SectionHead
            eyebrow="What can travel"
            title="Pack it. We'll find a carrier."
            actionLabel="See all"
            onAction={() => router.push('/send')}
          />
          {config.isLoading ? (
            <Card>
              <LoadingBlock lines={2} />
            </Card>
          ) : config.isError ? (
            <ErrorNotice error={config.error} onRetry={() => void config.refetch()} />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
            >
              {(config.data?.categories ?? []).map((category) => (
                <Pressable
                  key={category}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/send', params: { category } })}
                  style={({ pressed }) => [styles.categoryCard, pressed && { opacity: 0.85 }]}
                >
                  <IconBubble
                    name={CATEGORY_ICONS[category] ?? 'cube-outline'}
                    size={38}
                    background={colors.brandTint}
                    color={colors.brandDark}
                  />
                  <AppText
                    variant="micro"
                    numberOfLines={2}
                    style={{ marginTop: spacing.sm, color: colors.ink700, lineHeight: 14 }}
                  >
                    {categoryLabel(category)}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        {/* -------------------------------------------------------------- partner banner */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(status === 'signed_in' ? '/trips' : '/trips/new')}
          style={({ pressed }) => [styles.partnerBanner, pressed && { opacity: 0.94 }]}
        >
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: '#9fe3cd', letterSpacing: 1 }}>
              PARTNER
            </AppText>
            <AppText variant="heading" tone="white" style={{ marginTop: 4 }}>
              Going that way anyway?
            </AppText>
            <AppText variant="small" style={{ color: '#c8ded6', marginTop: 2 }}>
              Publish your drive and earn from the space in your boot.
            </AppText>
            <View style={styles.partnerCta}>
              <AppText variant="micro" style={{ color: colors.navy, fontFamily: font.bold }}>
                Start earning
              </AppText>
              <Ionicons name="arrow-forward" size={13} color={colors.navy} />
            </View>
          </View>
          <View style={styles.partnerArt}>
            <Ionicons name="car-sport" size={46} color="rgba(255,255,255,0.92)" />
            <View style={styles.partnerRoad} />
          </View>
        </Pressable>

        {/* -------------------------------------------------------------- how it works */}
        <View style={{ marginTop: spacing.xxl }}>
          <SectionHead eyebrow="How it works" title="Three steps, both sides protected" />
          <View style={styles.stepsCard}>
            <Step
              number="1"
              title="Post the parcel"
              body="Route, pickup window and what is inside. Your price is fixed before you choose."
            />
            <Step
              number="2"
              title="Pick a traveller"
              body="See who is already going, their ID status and completed trips."
            />
            <Step
              number="3"
              title="Hand over with a code"
              body="One code at pickup, another at delivery. Chat stays attached to the booking."
            />
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <InfoNote
            icon="shield-checkmark"
            title="No cash, jewellery, medicines, food or batteries"
            body="Every parcel is declared and screened. Prohibited items end the account."
          />
        </View>

        {/* -------------------------------------------------------------- recent */}
        {status === 'signed_in' ? (
          <View style={{ marginTop: spacing.xxl }}>
            <SectionHead
              title="Recent bookings"
              actionLabel={recent.length ? 'See all' : undefined}
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
                  body="Post your first parcel and a verified traveller on that route can carry it."
                  actionLabel="Send a parcel"
                  onAction={() => router.push('/send')}
                />
              </Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {recent.map((booking) => (
                  <Pressable
                    key={booking.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/bookings/${booking.id}`)}
                    style={({ pressed }) => [styles.recentRow, pressed && { opacity: 0.85 }]}
                  >
                    <IconBubble
                      name={booking.role === 'sender' ? 'cube-outline' : 'car-outline'}
                      size={38}
                      background={booking.role === 'sender' ? colors.brandSoft : colors.partnerSoft}
                      color={booking.role === 'sender' ? colors.brandDark : colors.partner}
                    />
                    <View style={{ flex: 1 }}>
                      <AppText variant="subheading" numberOfLines={1}>
                        {booking.origin_city} → {booking.dest_city}
                      </AppText>
                      <AppText variant="small" tone="muted" numberOfLines={1}>
                        {booking.role === 'sender' ? 'Sending' : 'Carrying'} · {formatDateTime(booking.created_at)}
                      </AppText>
                      <View style={{ flexDirection: 'row', marginTop: 5 }}>
                        <Badge label={statusLabel(booking.status)} tone={statusTone(booking.status)} />
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <AppText variant="subheading" style={{ fontFamily: font.semibold }}>
                        {inr(booking.agreed_total_paise)}
                      </AppText>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : (
          <Card style={{ marginTop: spacing.xxl }}>
            <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
              <Avatar name={user?.name} size={48} />
              <View style={{ flex: 1 }}>
                <AppText variant="heading">One account, both sides</AppText>
                <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                  Sign in to send parcels, carry on your own route and keep every booking in one place.
                </AppText>
              </View>
            </Row>
            <Button
              label="Sign in with phone"
              onPress={() => router.push({ pathname: '/sign-in', params: { next: '/send' } })}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        )}

        <AppText variant="micro" tone="muted" style={{ textAlign: 'center', marginTop: spacing.xxl, fontFamily: font.regular }}>
          Parcel Yatra · intercity parcels carried by people, not trucks
        </AppText>
      </View>
    </Screen>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <Row gap={spacing.md} style={{ alignItems: 'flex-start', marginBottom: spacing.md }}>
      <View style={styles.stepNumber}>
        <AppText variant="micro" tone="brand" style={{ fontFamily: font.bold }}>
          {number}
        </AppText>
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="subheading">{title}</AppText>
        <AppText variant="small" tone="muted" style={{ marginTop: 1 }}>
          {body}
        </AppText>
      </View>
    </Row>
  );
}

const styles = {
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  heroDot: {
    position: 'absolute' as const,
    top: 9,
    right: 10,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  heroBadge: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  heroPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  activeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.brand },
  categoryCard: {
    width: 104,
    minHeight: 104,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    justifyContent: 'flex-start' as const,
  },
  partnerBanner: {
    flexDirection: 'row' as const,
    backgroundColor: colors.partner,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.xxl,
    overflow: 'hidden' as const,
  },
  partnerCta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    alignSelf: 'flex-start' as const,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: spacing.md,
  },
  partnerArt: {
    width: 82,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  partnerRoad: {
    width: 58,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.30)',
    marginTop: 6,
  },
  stepsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brandSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  recentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
};
