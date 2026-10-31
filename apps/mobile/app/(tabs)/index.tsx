/**
 * The homepage.
 *
 * Two kinds of content meet here and must not be confused:
 *
 *  - **remote content** — hero, theme, section order, copy, artwork. It arrives from `/v1/homepage`,
 *    is validated before use, is cached, and can change without an app update. This screen renders it
 *    and nothing else; it never hardcodes a headline or a campaign colour.
 *  - **local state** — the live booking, recent bookings, unread counts, the chosen pickup city.
 *    That is the app's own data, fetched through the normal authenticated client.
 *
 * The composition is fixed even though the content is not: a full-bleed hero under a floating header,
 * a From→To card on the seam, the live booking, then whatever sections the server sends in the order
 * it sends them. A campaign can hide, retitle or recolour a section; it cannot move the search card or
 * introduce a new kind of UI.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { visibleHeroes, visibleSections, defaultHomepageDocument } from '@py/domain';

import { bookingsApi, conversationsApi, notificationsApi } from '../../src/api/client.ts';
import { useSession } from '../../src/session.tsx';
import {
  AppText,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  LoadingBlock,
  PickerSheet,
  Refresh,
  Row,
} from '../../src/components/ui.tsx';
import { Avatar, IconBubble, RouteTimeline, SectionHead, StatusTrack } from '../../src/components/kit.tsx';
import { useCities } from '../../src/lib/cities.ts';
import { useOriginCity } from '../../src/lib/origin.ts';
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
import { openRouteToSend } from '../../src/homepage/actions.ts';
import { greetingFor } from '../../src/lib/greeting.ts';
import { useHomepage } from '../../src/homepage/use-homepage.ts';
import { homePalette, withAlpha } from '../../src/homepage/theme.ts';
import { lightsAvailable, resolveLights } from '../../src/homepage/lights-state.ts';
import { readLightsPreference, writeLightsPreference } from '../../src/homepage/lights-preference.ts';
import { HERO_SEAM, HeroCarousel, heroHeight } from '../../src/homepage/components/HeroCarousel.tsx';
import { HomeHeader } from '../../src/homepage/components/HomeHeader.tsx';
import { Reveal } from '../../src/homepage/components/Reveal.tsx';
import { SearchCard } from '../../src/homepage/components/SearchCard.tsx';
import { SectionRenderer } from '../../src/homepage/components/Sections.tsx';
import { SkyBackdrop } from '../../src/homepage/components/SkyBackdrop.tsx';

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

/** Clearance for the floating pill tab bar: its height plus its distance from the bottom. */
const TAB_BAR_CLEARANCE = 104;

/**
 * The live card's headline must state what is actually happening. A parcel waiting for a traveller,
 * sitting at a handover, or under dispute is not "moving", and saying so makes the app look like it
 * has lost track of the booking.
 */
function activeHeadline(status: string, role: 'sender' | 'traveller'): string {
  switch (status) {
    case 'draft':
    case 'pending_traveller_acceptance':
      return role === 'sender' ? 'Waiting for a traveller' : 'A parcel needs your answer';
    case 'payment_pending':
      return 'Confirm the payment';
    case 'confirmed':
    case 'open_pickup':
    case 'pickup_ready':
      return role === 'sender' ? 'Hand it over with a code' : 'Collect it with a code';
    case 'picked_up':
      return role === 'sender' ? 'The traveller has your parcel' : 'Parcel collected';
    case 'in_transit':
      return 'On the way to the drop city';
    case 'arrived':
      return 'Arrived — delivery code next';
    case 'delivery_attempt_failed':
      return 'Delivery was attempted';
    case 'delivered':
      return role === 'sender' ? 'Delivered — complete payment' : 'Delivered — collect your payment';
    case 'payout_eligible':
      return 'Delivery complete';
    case 'disputed':
    case 'incident_open':
    case 'locked_for_review':
      return 'Under review';
    default:
      return 'Your parcel is moving';
  }
}

interface CityChoice {
  id: string;
  name: string;
}

export default function HomeScreen() {
  const { status, user } = useSession();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const homepage = useHomepage();
  const cities = useCities();
  const { origin, setOrigin, ready: originReady } = useOriginCity();
  const [dest, setDest] = useState<CityChoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'origin' | 'dest'>('origin');
  const [pastHero, setPastHero] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  // An `Animated.Value` is read during render (interpolations and the scroll handler), so it is state
  // with a lazy initialiser rather than a ref — the same reason as Reveal.tsx.
  const [scrollY] = useState(() => new Animated.Value(0));

  // The hero greets by local time, so the clock is re-read whenever the screen is shown again — a tab
  // switch or the app returning from the background — instead of staying at the time of first mount.
  useFocusEffect(
    useCallback(() => {
      setClock(Date.now());
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setClock(Date.now());
    });
    return () => subscription.remove();
  }, []);

  const bookings = useQuery({
    queryKey: ['bookings', 'recent'],
    queryFn: () => bookingsApi.list(),
    enabled: status === 'signed_in',
  });
  const inbox = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationsApi.list,
    enabled: status === 'signed_in',
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
    enabled: status === 'signed_in',
  });

  const palette = homepage.palette;
  const document = homepage.document;
  const heroes = useMemo(() => visibleHeroes(document), [document]);
  const sections = useMemo(() => visibleSections(document), [document]);
  const greeting = greetingFor(new Date(clock), user?.name);

  // The light string is a campaign surface: it exists only when the published theme draws a lamp.
  // The campaign sets the default; the device remembers a deliberate on/off choice.
  const festive = lightsAvailable(palette.decoration);
  const [lightsOn, setLightsOn] = useState(true);
  const [lightsReady, setLightsReady] = useState(false);
  // Read during render by the hero layers, so it is state with a lazy initialiser, as elsewhere.
  const [lightsProgress] = useState(() => new Animated.Value(1));
  const baseGradient = useMemo(() => homePalette(defaultHomepageDocument().theme).heroGradient, []);

  useEffect(() => {
    let cancelled = false;
    void readLightsPreference().then((stored) => {
      if (cancelled) return;
      const on = resolveLights(palette.decoration, stored);
      setLightsOn(on);
      // A theme without a lamp keeps its full wash; only a deliberate "off" reveals the brand one.
      lightsProgress.setValue(festive && !on ? 0 : 1);
      setLightsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [festive, lightsProgress, palette.decoration]);

  const all = bookings.data?.items ?? [];
  const active = all.find((booking) => !CLOSED_STATUSES.has(booking.status));
  const recent = all.slice(0, 3);
  const unread = notifications.data?.unread_count ?? 0;
  const unreadMessages = inbox.data?.total_unread ?? 0;

  // A city can be taken out of service between releases. A remembered city that is no longer
  // serviceable would silently pre-fill a route the sender cannot book, so it is forgotten.
  useEffect(() => {
    if (!origin || !originReady || cities.isLoading) return;
    if (cities.serviceable.length === 0) return;
    if (!cities.serviceable.some((city) => city.id === origin.id)) setOrigin(null);
  }, [cities.isLoading, cities.serviceable, origin, originReady, setOrigin]);

  useEffect(() => {
    if (!dest || cities.isLoading) return;
    if (cities.serviceable.length === 0) return;
    // A remembered destination that left service has to be cleared, and there is no render-time
    // alternative: the list arrives asynchronously. The guard above makes this a one-shot correction.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!cities.serviceable.some((city) => city.id === dest.id)) setDest(null);
  }, [cities.isLoading, cities.serviceable, dest]);

  const cityOptions = useMemo(
    () =>
      cities.serviceable
        .filter((city) => pickerMode === 'dest' ? city.id !== origin?.id : true)
        .map((city) => ({
          value: city.id,
          label: city.name,
          ...(city.state ? { meta: city.state } : {}),
        })),
    [cities.serviceable, origin?.id, pickerMode],
  );

  const refreshing =
    homepage.refreshing ||
    bookings.isRefetching ||
    inbox.isRefetching ||
    notifications.isRefetching;

  const heroBottom = heroHeight(width, insets.top);
  const headerSwitch = heroBottom - insets.top - 64;
  // The header belongs to the hero: it fades out over the first stretch of scrolling and is gone —
  // no solid bar takes its place.
  const headerFade = 72;
  const overlayOpacity = scrollY.interpolate({
    inputRange: [0, headerFade],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  function openPicker(mode: 'origin' | 'dest'): void {
    setPickerMode(mode);
    setPickerOpen(true);
  }

  function chooseCity(value: string): void {
    const city = cities.city(value);
    if (!city) return;
    const choice = { id: city.id, name: city.name };
    if (pickerMode === 'origin') {
      setOrigin(choice);
      if (dest?.id === choice.id) setDest(null);
    } else {
      setDest(choice);
      if (origin?.id === choice.id) setOrigin(null);
    }
  }

  function onRefresh(): void {
    void homepage.refresh();
    if (status === 'signed_in') {
      void bookings.refetch();
      void inbox.refetch();
      void notifications.refetch();
    }
  }

  function onSubmitRoute(): void {
    if (!origin) {
      openPicker('origin');
      return;
    }
    if (!dest) {
      openPicker('dest');
      return;
    }
    openRouteToSend(origin.name, dest.name);
  }

  function onSwap(): void {
    if (!origin || !dest) return;
    setOrigin({ id: dest.id, name: dest.name });
    setDest({ id: origin.id, name: origin.name });
  }

  const toggleLights = useCallback((): void => {
    if (!festive) return;
    const next = !lightsOn;
    setLightsOn(next);
    Animated.timing(lightsProgress, {
      toValue: next ? 1 : 0,
      duration: 420,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
    void writeLightsPreference(next);
  }, [festive, lightsOn, lightsProgress]);

  const headerProps = {
    palette,
    originName: origin?.name ?? null,
    onPressOrigin: () => openPicker('origin'),
    unreadNotifications: unread,
    unreadMessages,
    onPressNotifications: () => router.push('/notifications'),
    onPressInbox: () => router.push('/inbox'),
    userName: user?.name ?? null,
    onPressProfile: () => router.push('/profile'),
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <StatusBar style={pastHero ? 'dark' : 'light'} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE + insets.bottom }}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
          listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const y = event.nativeEvent.contentOffset.y;
            const next = y > headerSwitch;
            const hidden = y > headerFade;
            setPastHero((current) => (current === next ? current : next));
            setHeaderHidden((current) => (current === hidden ? current : hidden));
          },
        })}
        scrollEventThrottle={16}
        refreshControl={
          Platform.OS === 'web' ? undefined : <Refresh refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View>
          <HeroCarousel
            heroes={heroes}
            palette={palette}
            baseGradient={baseGradient}
            width={width}
            topInset={insets.top}
            greeting={greeting}
            lightsOn={lightsOn}
            lightsReady={lightsReady}
            lightsProgress={lightsProgress}
            onToggleLights={toggleLights}
          />
          {/* The sky is a page surface, not a badge: one instance over the whole hero, scrolling with
              it, and only when the campaign is a gradient rather than artwork. */}
          {heroes.every((hero) => !hero.image_url) ? (
            <SkyBackdrop
              now={new Date(clock)}
              width={width}
              topInset={insets.top}
              height={heroHeight(width, insets.top)}
            />
          ) : null}
        </View>

        {/* The search card is the primary action, so it sits on the seam between hero and page. */}
        <View style={{ marginTop: -HERO_SEAM, paddingHorizontal: spacing.lg }}>
          <SearchCard
            palette={palette}
            originName={origin?.name ?? null}
            destName={dest?.name ?? null}
            onPressOrigin={() => openPicker('origin')}
            onPressDest={() => openPicker('dest')}
            onSwap={onSwap}
            onSubmit={onSubmitRoute}
          />
        </View>

        {homepage.error && homepage.source !== 'network' ? (
          <View
            style={{
              marginTop: spacing.md,
              marginHorizontal: spacing.lg,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              backgroundColor: withAlpha(palette.navy, 0.05),
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <Ionicons name="cloud-offline-outline" size={15} color={withAlpha(palette.navy, 0.7)} />
            <AppText variant="micro" style={{ flex: 1, color: withAlpha(palette.navy, 0.75) }}>
              Showing the last saved page. Pull down to try again.
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => void homepage.refresh()} hitSlop={8}>
              <AppText variant="micro" style={{ color: palette.brandDark, fontFamily: font.semibold }}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {/* -------------------------------------------------------------- live shipment */}
        {status === 'signed_in' && active ? (
          <Reveal delay={40}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
              <SectionHead
                eyebrow="Live now"
                title={activeHeadline(active.status, active.role)}
                actionLabel="All bookings"
                onAction={() => router.push('/bookings')}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${active.origin_city} to ${active.dest_city}, ${statusLabel(active.status)}`}
                onPress={() => router.push(`/bookings/${active.id}`)}
                style={({ pressed }) => [
                  styles.activeCard,
                  shadow.card,
                  { backgroundColor: palette.surface, borderColor: withAlpha(palette.navy, 0.08) },
                  pressed && { opacity: 0.94 },
                ]}
              >
                <LinearGradient
                  colors={[palette.brand, palette.accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.activeRail}
                  pointerEvents="none"
                />
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Row gap={spacing.sm}>
                    <View style={[styles.liveHalo, { backgroundColor: withAlpha(palette.brand, 0.14) }]}>
                      <View style={[styles.liveDot, { backgroundColor: palette.brand }]} />
                    </View>
                    <AppText variant="micro" style={{ letterSpacing: 0.7, color: palette.brandDark }}>
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
                  <StatusTrack
                    status={active.status}
                    tone={active.role === 'traveller' ? 'partner' : 'brand'}
                  />
                </View>
                <View style={[styles.activeFooter, { borderTopColor: withAlpha(palette.navy, 0.07) }]}>
                  <AppText variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                    {active.role === 'sender' ? 'Traveller' : 'Sender'} ·{' '}
                    {active.role === 'sender' ? 'verified partner' : 'sender'}
                  </AppText>
                  <View style={[styles.trackPill, { backgroundColor: withAlpha(palette.brand, 0.09) }]}>
                    <AppText variant="micro" style={{ color: palette.brandDark, fontFamily: font.semibold }}>
                      Track live
                    </AppText>
                    <Ionicons name="arrow-forward" size={13} color={palette.brandDark} />
                  </View>
                </View>
              </Pressable>
            </View>
          </Reveal>
        ) : status === 'signed_in' && bookings.isLoading ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <Card>
              <LoadingBlock lines={3} />
            </Card>
          </View>
        ) : null}

        {/* -------------------------------------------------------------- remote sections */}
        {sections.map((section, index) => (
          <Reveal key={section.id} delay={80 + index * 45}>
            <SectionRenderer
              section={section}
              palette={palette}
              originCity={origin?.name ?? null}
            />
          </Reveal>
        ))}

        {/* -------------------------------------------------------------- account */}
        {status === 'signed_in' ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xxl }}>
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
                    style={({ pressed }) => [
                      styles.recentRow,
                      { backgroundColor: palette.surface, borderColor: withAlpha(palette.navy, 0.08) },
                      pressed && { opacity: 0.85 },
                    ]}
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
                        {booking.role === 'sender' ? 'Sending' : 'Carrying'} ·{' '}
                        {formatDateTime(booking.created_at)}
                      </AppText>
                      <View style={{ flexDirection: 'row', marginTop: 5 }}>
                        <Badge label={statusLabel(booking.status)} tone={statusTone(booking.status)} />
                      </View>
                    </View>
                    <AppText variant="subheading" style={{ fontFamily: font.semibold }}>
                      {inr(booking.agreed_total_paise)}
                    </AppText>
                    <Ionicons
                      name="chevron-forward"
                      size={15}
                      color={withAlpha(palette.navy, 0.35)}
                      style={{ marginLeft: -4 }}
                    />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xxl }}>
            <Card>
              <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
                <Avatar name={user?.name} size={48} />
                <View style={{ flex: 1 }}>
                  <AppText variant="heading">One account, both sides</AppText>
                  <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                    Sign in to send parcels, carry on your own route and keep every booking in one
                    place.
                  </AppText>
                </View>
              </Row>
              <Button
                label="Sign in with phone"
                onPress={() => router.push({ pathname: '/sign-in', params: { next: '/send' } })}
                style={{ marginTop: spacing.md }}
              />
            </Card>
          </View>
        )}

        <AppText
          variant="micro"
          tone="muted"
          style={{
            textAlign: 'center',
            marginTop: spacing.xxl,
            paddingHorizontal: spacing.lg,
            fontFamily: font.regular,
          }}
        >
          Parcel Yatra · intercity parcels carried by people, not trucks
        </AppText>
      </ScrollView>

      {/* One header only, and it belongs to the hero: fade it out and nothing replaces it. */}
      <Animated.View
        pointerEvents={headerHidden ? 'none' : 'auto'}
        style={[styles.headerLayer, { opacity: overlayOpacity }]}
      >
        <HomeHeader {...headerProps} />
      </Animated.View>

      <PickerSheet
        visible={pickerOpen}
        title={pickerMode === 'origin' ? 'Where is the parcel?' : 'Where is it going?'}
        options={cityOptions}
        selected={pickerMode === 'origin' ? (origin?.id ?? null) : (dest?.id ?? null)}
        onSelect={chooseCity}
        onClose={() => setPickerOpen(false)}
        emptyText={
          cities.isLoading ? 'Loading cities…' : 'No serviceable cities are available right now.'
        }
      />
    </View>
  );
}

const styles = {
  headerLayer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  activeCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    overflow: 'hidden' as const,
  },
  activeRail: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  liveHalo: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  activeFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  trackPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    height: 30,
  },
  recentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
};
