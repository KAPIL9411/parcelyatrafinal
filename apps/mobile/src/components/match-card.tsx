import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { Match } from '../api/types.ts';
import { AppText, Badge, Row } from './ui.tsx';
import { Avatar, IconBubble } from './kit.tsx';
import { formatDateTime, inr, kg, modeLabel } from '../lib/format.ts';
import { colors, font, radius, spacing } from '../theme.ts';

export function MatchCard({
  match,
  selected,
  onSelect,
}: {
  match: Match;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = match.traveller_first_name ?? 'Verified traveller';
  const bandTone = match.band === 'excellent' ? 'success' : match.band === 'good' ? 'info' : 'neutral';

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={({ pressed }) => [
        {
          backgroundColor: selected ? colors.brandTint : colors.surface,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.brand : colors.line,
          borderRadius: radius.xl,
          padding: spacing.md,
        },
        pressed && { opacity: 0.9 },
      ]}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Row gap={spacing.sm} style={{ flex: 1 }}>
          <Avatar name={match.traveller_initial ?? name} size={46} />
          <View style={{ flex: 1 }}>
            <Row gap={4}>
              <AppText variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {name}
              </AppText>
              {match.verification_state === 'verified' ? (
                <Ionicons name="shield-checkmark" size={15} color={colors.success} />
              ) : null}
            </Row>
            <AppText variant="small" tone="muted" numberOfLines={1}>
              {modeLabel(match.mode)} · {match.completed_trips} completed ·{' '}
              {match.reliability_ratio !== undefined
                ? `${Math.round(match.reliability_ratio * 100)}% reliable`
                : match.reliability_band.replace(/_/g, ' ')}
            </AppText>
            <Row gap={6} style={{ marginTop: 3 }}>
              <Badge label={match.band.toUpperCase()} tone={bandTone} />
              {match.pickup_distance_band_km ? (
                <Badge label={`${match.pickup_distance_band_km} km away`} tone="neutral" />
              ) : null}
            </Row>
          </View>
        </Row>
        <View style={{ alignItems: 'flex-end' }}>
          <AppText variant="price" tone="brand" style={{ fontSize: 19 }}>
            {inr(match.indicative_price_paise)}
          </AppText>
          <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
            indicative
          </AppText>
        </View>
      </Row>

      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          marginTop: spacing.md,
          backgroundColor: colors.canvas,
          borderRadius: radius.md,
          padding: spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Row gap={4}>
            <Ionicons name="time-outline" size={11} color={colors.ink500} />
            <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
              Departs
            </AppText>
          </Row>
          <AppText variant="micro" numberOfLines={1} style={{ marginTop: 1 }}>
            {formatDateTime(match.departure_at)}
          </AppText>
        </View>
        <View style={{ width: 1, backgroundColor: colors.line }} />
        <View style={{ flex: 1 }}>
          <Row gap={4}>
            <Ionicons name="flag-outline" size={11} color={colors.ink500} />
            <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
              Arrives by
            </AppText>
          </Row>
          <AppText variant="micro" numberOfLines={1} style={{ marginTop: 1 }}>
            {formatDateTime(match.arrival_estimate_at)}
          </AppText>
        </View>
        <View style={{ width: 1, backgroundColor: colors.line }} />
        <View style={{ flex: 1 }}>
          <Row gap={4}>
            <Ionicons name="cube-outline" size={11} color={colors.ink500} />
            <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
              Space
            </AppText>
          </Row>
          <AppText variant="micro" numberOfLines={1} style={{ marginTop: 1 }}>
            {kg(match.capacity_kg_remaining)} free
          </AppText>
        </View>
      </View>

      {match.accepts_documents_only ? (
        <Row gap={4} style={{ marginTop: spacing.sm }}>
          <IconBubble name="document-text-outline" size={20} background={colors.accentSoft} color={colors.warn} iconSize={11} />
          <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
            Documents only on this trip.
          </AppText>
        </Row>
      ) : null}

      {match.reasons.length ? (
        <Row style={{ flexWrap: 'wrap', gap: 5, marginTop: spacing.sm }}>
          {match.reasons.slice(0, 3).map((reason) => (
            <View
              key={reason}
              style={{
                backgroundColor: colors.brandTint,
                borderRadius: radius.pill,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <AppText variant="micro" tone="brand" style={{ fontFamily: font.regular }}>
                {reason.replace(/_/g, ' ').toLowerCase()}
              </AppText>
            </View>
          ))}
        </Row>
      ) : null}

      <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
        <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular, flex: 1 }}>
          Final price comes from your fixed quote.
        </AppText>
        <Row gap={4}>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              borderWidth: 2,
              borderColor: selected ? colors.brand : colors.line,
              backgroundColor: selected ? colors.brand : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected ? <Ionicons name="checkmark" size={10} color={colors.white} /> : null}
          </View>
          <AppText variant="micro" tone={selected ? 'brand' : 'muted'} style={{ fontFamily: font.semibold }}>
            {selected ? 'Selected' : 'Select'}
          </AppText>
        </Row>
      </Row>
    </Pressable>
  );
}
