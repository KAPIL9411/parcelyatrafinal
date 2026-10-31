/**
 * Every section the homepage contract can carry, rendered by the app's own components.
 *
 * The rule that keeps this honest: a section is *data*, and this file is the only place that decides
 * what that data looks like. A server can reorder, retitle, recolour, hide or reschedule a section;
 * it cannot introduce a new shape of UI, inject markup, or point at a screen that is not in the
 * allowlist.
 *
 * Sections with no content (an announcements block with no notices, a route list with no routes)
 * render nothing at all. An empty card with a heading is worse than no card.
 */
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { HomeAction, HomeItem, HomeSection } from '@py/domain';
import { AppText } from '../../components/ui.tsx';
import { font, radius, shadow, spacing } from '../../theme.ts';
import { openRouteToSend, runHomeAction } from '../actions.ts';
import { sectionSurface, withAlpha, type HomePalette } from '../theme.ts';
import { CategoryGrid } from './CategoryGrid.tsx';
import { CategoryStrip } from './CategoryStrip.tsx';
import { FauxGradient, Scrim } from './Decorations.tsx';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Promo card width. The snap interval is this plus the carousel gap. */
const PROMO_WIDTH = 244;

export interface SectionProps {
  section: HomeSection;
  palette: HomePalette;
  originCity?: string | null;
  activeCategoryId?: string | null;
}

function act(action: HomeAction | undefined, originCity?: string | null): void {
  runHomeAction(action, { ...(originCity ? { originCity } : {}) });
}

function actOnItem(item: HomeItem, originCity?: string | null): void {
  if (item.origin && item.dest) {
    openRouteToSend(item.origin, item.dest);
    return;
  }
  if (item.action) {
    act(item.action, originCity);
    return;
  }
  if (item.category) {
    act({ kind: 'send', category: item.category }, originCity);
  }
}

function SectionHeader({
  section,
  palette,
  padded = true,
}: {
  section: HomeSection;
  palette: HomePalette;
  padded?: boolean;
}) {
  const surface = sectionSurface(section, palette);
  if (!section.title && !section.subtitle) return null;
  return (
    <View style={{ paddingHorizontal: padded ? spacing.lg : 0, marginBottom: spacing.md }}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          {section.title ? (
            <AppText style={[styles.title, { color: surface.text }]}>{section.title}</AppText>
          ) : null}
          {section.subtitle ? (
            <AppText style={[styles.subtitle, { color: surface.muted }]} numberOfLines={2}>
              {section.subtitle}
            </AppText>
          ) : null}
        </View>
        {section.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={section.title ? `See all ${section.title}` : 'See all'}
            onPress={() => act(section.action, null)}
            hitSlop={10}
            style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.6 }]}
          >
            <AppText style={[styles.headerActionText, { color: surface.accent }]}>See all</AppText>
            <Ionicons name="chevron-forward" size={13} color={surface.accent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Card({ section, palette, children }: { section: HomeSection; palette: HomePalette; children: ReactNode }) {
  const surface = sectionSurface(section, palette);
  return (
    <View
      style={[
        styles.card,
        shadow.soft,
        {
          backgroundColor: surface.background,
          borderColor: withAlpha(palette.navy, 0.06),
        },
      ]}
    >
      {children}
    </View>
  );
}

export function SectionRenderer({ section, palette, originCity, activeCategoryId }: SectionProps) {
  switch (section.type) {
    case 'category_nav':
      return (
        <View style={styles.block}>
          <SectionHeader section={section} palette={palette} />
          <CategoryStrip
            items={section.items ?? []}
            palette={palette}
            activeId={activeCategoryId}
            onPress={(item) => actOnItem(item, originCity)}
          />
        </View>
      );

    case 'category_grid':
      return (
        <View style={styles.block}>
          <SectionHeader section={section} palette={palette} />
          <CategoryGrid
            items={section.items ?? []}
            palette={palette}
            activeId={activeCategoryId}
            onPress={(item) => actOnItem(item, originCity)}
          />
        </View>
      );

    case 'quick_actions':
      return <QuickActions section={section} palette={palette} originCity={originCity} />;

    case 'popular_routes':
      return <PopularRoutes section={section} palette={palette} originCity={originCity} />;

    case 'promo_cards':
      return <PromoCards section={section} palette={palette} originCity={originCity} />;

    case 'trust':
      return <TrustSection section={section} palette={palette} />;

    case 'business_promo':
      return <BusinessPromo section={section} palette={palette} originCity={originCity} />;

    case 'carry_promo':
      return <CarryPromo section={section} palette={palette} originCity={originCity} />;

    case 'how_it_works':
      return <HowItWorks section={section} palette={palette} />;

    case 'announcements':
      return <Announcements section={section} palette={palette} />;

    case 'campaign_hero':
      return <CampaignBanner section={section} palette={palette} originCity={originCity} />;

    default:
      // Unknown types never reach here: the validator drops them. Kept as a guard so a future type
      // added to the union without a renderer fails closed.
      return null;
  }
}

// ---------------------------------------------------------------------------- quick actions

function QuickActions({ section, palette, originCity }: SectionProps) {
  const items = section.items ?? [];
  if (items.length === 0) return null;
  const surface = sectionSurface(section, palette);
  const rows: HomeItem[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));

  return (
    <View style={styles.block}>
      <SectionHeader section={section} palette={palette} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: 'row', gap: spacing.sm }}>
            {row.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => actOnItem(item, originCity)}
                style={({ pressed }) => [
                  styles.quickTile,
                  shadow.soft,
                  {
                    backgroundColor: surface.background,
                    borderColor: withAlpha(palette.navy, 0.06),
                  },
                  pressed && styles.pressed,
                ]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={[styles.quickIcon, { backgroundColor: withAlpha(palette.brand, 0.09) }]}>
                    <Ionicons name={item.icon ?? 'cube-outline'} size={19} color={palette.brandDark} />
                  </View>
                  {item.badge ? (
                    <View style={[styles.pill, { backgroundColor: palette.accent }]}>
                      <AppText style={[styles.pillText, { color: palette.navy }]}>{item.badge}</AppText>
                    </View>
                  ) : null}
                </View>
                <AppText style={[styles.quickTitle, { color: surface.text }]} numberOfLines={1}>
                  {item.title}
                </AppText>
                {item.body ? (
                  <AppText style={[styles.quickBody, { color: surface.muted }]} numberOfLines={2}>
                    {item.body}
                  </AppText>
                ) : null}
              </Pressable>
            ))}
            {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------- popular routes

function PopularRoutes({ section, palette, originCity }: SectionProps) {
  const items = section.items ?? [];
  if (items.length === 0) return null;
  const surface = sectionSurface(section, palette);

  return (
    <View style={styles.block}>
      <SectionHeader section={section} palette={palette} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontal}
      >
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.origin && item.dest ? `${item.origin} to ${item.dest}` : item.title}
            onPress={() => actOnItem(item, originCity)}
            style={({ pressed }) => [
              styles.routeCard,
              shadow.soft,
              { backgroundColor: surface.background, borderColor: withAlpha(palette.navy, 0.07) },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.routeTop}>
              <View style={[styles.routeIcon, { backgroundColor: withAlpha(palette.brand, 0.09) }]}>
                <Ionicons name="navigate-outline" size={16} color={palette.brandDark} />
              </View>
              {item.badge ? (
                <AppText style={[styles.routeBadge, { color: surface.accent }]} numberOfLines={1}>
                  {item.badge}
                </AppText>
              ) : null}
            </View>

            <AppText style={[styles.routeTitle, { color: surface.text }]} numberOfLines={2}>
              {item.origin && item.dest ? (
                <>
                  {item.origin}
                  <AppText style={{ color: surface.accent }}> → </AppText>
                  {item.dest}
                </>
              ) : (
                item.title
              )}
            </AppText>
            {item.body ? (
              <AppText style={[styles.routeBody, { color: surface.muted }]} numberOfLines={2}>
                {item.body}
              </AppText>
            ) : null}

            <View style={styles.routeFooter}>
              <AppText style={[styles.routeCta, { color: surface.accent }]}>Find a traveller</AppText>
              <Ionicons name="arrow-forward" size={12} color={surface.accent} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------- promo cards

function PromoCards({ section, palette, originCity }: SectionProps) {
  const items = section.items ?? [];
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState(0);
  if (items.length === 0) return null;

  const interval = PROMO_WIDTH + spacing.sm;
  const last = Math.max(0, items.length - 1);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = Math.round(event.nativeEvent.contentOffset.x / interval);
    setPage(Math.max(0, Math.min(last, next)));
  };

  const move = (direction: -1 | 1): void => {
    const next = Math.max(0, Math.min(last, page + direction));
    scroller.current?.scrollTo({ x: next * interval, animated: true });
    setPage(next);
  };

  return (
    <View style={styles.block}>
      <SectionHeader section={section} palette={palette} />
      <View>
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontal}
          snapToInterval={interval}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          onMomentumScrollEnd={onMomentumEnd}
        >
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() => actOnItem(item, originCity)}
              style={({ pressed }) => [styles.promoCard, pressed && styles.pressed]}
            >
              {item.image_url ? (
                <>
                  <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <Scrim strength={0.7} heightRatio={1} />
                </>
              ) : (
                <FauxGradient
                  from={palette.navy}
                  to={palette.brand}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <View style={styles.promoCopy}>
                {item.badge ? (
                  <View style={[styles.promoBadge, { backgroundColor: palette.accent }]}>
                    <AppText style={[styles.pillText, { color: palette.navy }]}>{item.badge}</AppText>
                  </View>
                ) : null}
                <AppText style={styles.promoTitle} numberOfLines={2} tone="white">
                  {item.title}
                </AppText>
                {item.body ? (
                  <AppText style={styles.promoBody} numberOfLines={2} tone="onDark">
                    {item.body}
                  </AppText>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {page > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous offers"
            onPress={() => move(-1)}
            style={[styles.arrow, styles.arrowLeft, shadow.soft, { backgroundColor: palette.surface }]}
          >
            <Ionicons name="chevron-back" size={17} color={palette.navy} />
          </Pressable>
        ) : null}
        {page < last ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next offers"
            onPress={() => move(1)}
            style={[styles.arrow, styles.arrowRight, shadow.soft, { backgroundColor: palette.surface }]}
          >
            <Ionicons name="chevron-forward" size={17} color={palette.navy} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------- trust

function TrustSection({ section, palette }: SectionProps) {
  const items = section.items ?? [];
  if (items.length === 0) return null;
  const surface = sectionSurface(section, palette);

  return (
    <View style={styles.block}>
      <SectionHeader section={section} palette={palette} />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Card section={section} palette={palette}>
          {items.map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.trustRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(surface.text, 0.1) },
              ]}
            >
              <View style={[styles.trustIcon, { backgroundColor: withAlpha(palette.accent, 0.16) }]}>
                <Ionicons name={(item.icon ?? 'shield-checkmark-outline') as IconName} size={17} color={palette.navy} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={[styles.trustTitle, { color: surface.text }]}>{item.title}</AppText>
                {item.body ? (
                  <AppText style={[styles.trustBody, { color: surface.muted }]}>{item.body}</AppText>
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------- how it works

function HowItWorks({ section, palette }: SectionProps) {
  const items = section.items ?? [];
  if (items.length === 0) return null;
  const surface = sectionSurface(section, palette);

  return (
    <View style={styles.block}>
      <SectionHeader section={section} palette={palette} />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Card section={section} palette={palette}>
          {items.map((item, index) => (
            <View key={item.id} style={[styles.stepRow, index > 0 && { marginTop: spacing.md }]}>
              <View style={[styles.stepNumber, { backgroundColor: withAlpha(palette.brand, 0.1) }]}>
                <AppText style={[styles.stepNumberText, { color: palette.brandDark }]}>{index + 1}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={[styles.stepTitle, { color: surface.text }]}>{item.title}</AppText>
                {item.body ? (
                  <AppText style={[styles.stepBody, { color: surface.muted }]}>{item.body}</AppText>
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------- announcements

function Announcements({ section, palette }: SectionProps) {
  const items = section.items ?? [];
  if (items.length === 0) return null;
  const surface = sectionSurface(section, palette);

  return (
    <View style={styles.block}>
      <SectionHeader section={section} palette={palette} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {items.map((item) => (
          <View
            key={item.id}
            style={[
              styles.notice,
              {
                backgroundColor: surface.background,
                borderColor: withAlpha(palette.accent, 0.45),
              },
            ]}
          >
            <Ionicons name="megaphone-outline" size={16} color={palette.navy} />
            <View style={{ flex: 1 }}>
              <AppText style={[styles.noticeTitle, { color: surface.text }]}>{item.title}</AppText>
              {item.body ? (
                <AppText style={[styles.noticeBody, { color: surface.muted }]}>{item.body}</AppText>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------- banners

function BusinessPromo({ section, palette, originCity }: SectionProps) {
  const background = section.background ?? palette.navy;
  const text = section.text_color ?? '#ffffff';
  const accent = section.accent_color ?? palette.accent;

  return (
    <View style={styles.block}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={section.title ?? 'Business shipping'}
          onPress={() => act(section.action ?? { kind: 'route', route: '/info/business' }, originCity)}
          style={({ pressed }) => [
            styles.banner,
            { backgroundColor: background, borderColor: withAlpha(text, 0.08) },
            pressed && styles.pressed,
          ]}
        >
          <View style={{ flex: 1 }}>
            <AppText style={[styles.bannerEyebrow, { color: accent }]}>BUSINESS</AppText>
            <AppText style={[styles.bannerTitle, { color: text }]} numberOfLines={2}>
              {section.title ?? 'Shipping for your shop'}
            </AppText>
            {section.subtitle ? (
              <AppText style={[styles.bannerBody, { color: withAlpha(text, 0.8) }]} numberOfLines={3}>
                {section.subtitle}
              </AppText>
            ) : null}
            <View style={[styles.bannerCta, { backgroundColor: accent }]}>
              <AppText style={[styles.bannerCtaText, { color: palette.navy }]}>Talk to us</AppText>
              <Ionicons name="arrow-forward" size={13} color={palette.navy} />
            </View>
          </View>
          <View style={[styles.bannerArt, { backgroundColor: withAlpha(text, 0.08) }]}>
            <Ionicons name="business-outline" size={34} color={text} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function CarryPromo({ section, palette, originCity }: SectionProps) {
  const background = section.background ?? palette.partner;
  const text = section.text_color ?? '#ffffff';
  const accent = section.accent_color ?? palette.accent;

  return (
    <View style={styles.block}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={section.title ?? 'Carry and earn'}
          onPress={() => act(section.action ?? { kind: 'route', route: '/trips/new' }, originCity)}
          style={({ pressed }) => [
            styles.banner,
            { backgroundColor: background, borderColor: withAlpha(text, 0.08) },
            pressed && styles.pressed,
          ]}
        >
          <View style={{ flex: 1 }}>
            <AppText style={[styles.bannerEyebrow, { color: accent }]}>PARTNER</AppText>
            <AppText style={[styles.bannerTitle, { color: text }]} numberOfLines={2}>
              {section.title ?? 'Going that way anyway?'}
            </AppText>
            {section.subtitle ? (
              <AppText style={[styles.bannerBody, { color: withAlpha(text, 0.82) }]} numberOfLines={3}>
                {section.subtitle}
              </AppText>
            ) : null}
            <View style={[styles.bannerCta, { backgroundColor: accent }]}>
              <AppText style={[styles.bannerCtaText, { color: palette.navy }]}>Start earning</AppText>
              <Ionicons name="arrow-forward" size={13} color={palette.navy} />
            </View>
          </View>
          <View style={styles.bannerArt}>
            <Ionicons name="car-sport" size={42} color={withAlpha(text, 0.92)} />
            <View style={[styles.road, { backgroundColor: withAlpha(text, 0.3) }]} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function CampaignBanner({ section, palette, originCity }: SectionProps) {
  const text = section.text_color ?? '#ffffff';

  return (
    <View style={styles.block}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={section.title ?? 'Campaign'}
          onPress={() => act(section.action, originCity)}
          style={({ pressed }) => [styles.campaign, pressed && styles.pressed]}
        >
          {section.image_url ? (
            <>
              <Image source={{ uri: section.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <Scrim strength={0.68} heightRatio={1} />
            </>
          ) : (
            <FauxGradient from={palette.navy} to={palette.brand} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.campaignCopy}>
            <AppText style={[styles.campaignTitle, { color: text }]} numberOfLines={2}>
              {section.title ?? ''}
            </AppText>
            {section.subtitle ? (
              <AppText style={[styles.campaignBody, { color: withAlpha(text, 0.86) }]} numberOfLines={2}>
                {section.subtitle}
              </AppText>
            ) : null}
            {section.action && section.action.kind !== 'none' ? (
              <View style={[styles.campaignCta, { backgroundColor: palette.accent }]}>
                <AppText style={[styles.bannerCtaText, { color: palette.navy }]}>
                  {section.action.kind === 'send' ? 'Send a parcel' : 'Explore'}
                </AppText>
                <Ionicons name="arrow-forward" size={13} color={palette.navy} />
              </View>
            ) : null}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  title: { fontFamily: font.semibold, fontSize: 18, lineHeight: 23, letterSpacing: -0.2 },
  subtitle: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 1, paddingBottom: 2 },
  headerActionText: { fontFamily: font.semibold, fontSize: 12 },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  horizontal: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: 2 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  pill: { borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  pillText: { fontFamily: font.bold, fontSize: 9.5, lineHeight: 13 },

  quickTile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    minHeight: 106,
  },
  quickIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  quickTitle: { fontFamily: font.semibold, fontSize: 13.5, lineHeight: 18, marginTop: spacing.sm },
  quickBody: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 15, marginTop: 1 },

  routeCard: {
    width: 188,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  routeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  routeBadge: { fontFamily: font.semibold, fontSize: 10 },
  routeTitle: { fontFamily: font.semibold, fontSize: 14, lineHeight: 19, marginTop: spacing.sm },
  routeBody: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 15, marginTop: 2 },
  routeFooter: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.md },
  routeCta: { fontFamily: font.semibold, fontSize: 11.5 },

  promoCard: {
    width: PROMO_WIDTH,
    height: 152,
    borderRadius: radius.xl,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  promoCopy: { padding: spacing.lg },
  promoBadge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  promoTitle: { fontFamily: font.bold, fontSize: 17, lineHeight: 21, marginTop: 6 },
  promoBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 2 },
  arrow: {
    position: 'absolute',
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  arrowLeft: { left: spacing.lg },
  arrowRight: { right: spacing.lg },

  trustRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md },
  trustIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  trustTitle: { fontFamily: font.semibold, fontSize: 14, lineHeight: 19 },
  trustBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 1 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNumber: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontFamily: font.bold, fontSize: 12 },
  stepTitle: { fontFamily: font.semibold, fontSize: 14, lineHeight: 19 },
  stepBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 1 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  noticeTitle: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  noticeBody: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 16, marginTop: 1 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  bannerEyebrow: { fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2 },
  bannerTitle: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, marginTop: 3 },
  bannerBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 2 },
  bannerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    height: 32,
    marginTop: spacing.md,
  },
  bannerCtaText: { fontFamily: font.semibold, fontSize: 12 },
  bannerArt: {
    width: 70,
    height: 70,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  road: { width: 40, height: 4, borderRadius: 2, marginTop: 5 },

  campaign: {
    height: 158,
    borderRadius: radius.xl,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  campaignCopy: { padding: spacing.lg },
  campaignTitle: { fontFamily: font.bold, fontSize: 19, lineHeight: 23 },
  campaignBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 2 },
  campaignCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    height: 30,
    marginTop: spacing.sm,
  },
});
