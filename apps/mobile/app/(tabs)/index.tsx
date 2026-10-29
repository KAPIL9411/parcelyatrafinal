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
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { visibleHeroes, visibleSections } from '@py/domain';

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
import { withAlpha } from '../../src/homepage/theme.ts';
import { HERO_SEAM, HeroCarousel, heroHeight } from '../../src/homepage/components/HeroCarousel.tsx';
import { HomeHeader } from '../../src/homepage/components/HomeHeader.tsx';
import { Reveal } from '../../src/homepage/components/Reveal.tsx';
import { SearchCard } from '../../src/homepage/components/SearchCard.tsx';
import { SectionRenderer } from '../../src/homepage/components/Sections.tsx';

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
  const overlayOpacity = scrollY.interpolate({
    inputRange: [Math.max(0, headerSwitch - 48), headerSwitch],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const solidOpacity = scrollY.interpolate({
    inputRange: [Math.max(0, headerSwitch - 48), headerSwitch],
    outputRange: [0, 1],
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
            const next = event.nativeEvent.contentOffset.y > headerSwitch;
            setPastHero((current) => (current === next ? current : next));
          },
        })}
        scrollEventThrottle={16}
        refreshControl={
          Platform.OS === 'web' ? undefined : <Refresh refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <HeroCarousel
          heroes={heroes}
          palette={palette}
          width={width}
          topInset={insets.top}
          greeting={greeting}
        />

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
                title="Your parcel is moving"
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
                  pressed && { opacity: 0.92 },
                ]}
              >
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Row gap={spacing.sm}>
                    <View style={[styles.liveDot, { backgroundColor: palette.brand }]} />
                    <AppText variant="micro" style={{ letterSpacing: 0.6, color: palette.brandDark }}>
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
                <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
                  <AppText variant="small" tone="muted">
                    {active.role === 'sender' ? 'Traveller' : 'Sender'} ·{' '}
                    {active.role === 'sender' ? 'verified partner' : 'sender'}
                  </AppText>
                  <Row gap={4}>
                    <AppText variant="subheading" style={{ color: palette.brandDark }}>
                      Track
                    </AppText>
                    <Ionicons name="arrow-forward" size={15} color={palette.brandDark} />
                  </Row>
                </Row>
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

      {/* Two headers cross-fade on the same scroll offset: white on the hero, solid over the page. */}
      <Animated.View
        pointerEvents={pastHero ? 'none' : 'auto'}
        style={[styles.headerLayer, { opacity: overlayOpacity }]}
      >
        <HomeHeader variant="overlay" {...headerProps} />
      </Animated.View>
      <Animated.View
        pointerEvents={pastHero ? 'auto' : 'none'}
        style={[styles.headerLayer, { opacity: solidOpacity }]}
      >
        <HomeHeader variant="solid" {...headerProps} />
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
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  recentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
};
