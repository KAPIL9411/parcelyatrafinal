import { Pressable, View } from 'react-native';

import type { Match } from '../api/types.ts';
import { AppText, Badge, Row } from './ui.tsx';
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
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={{
        backgroundColor: colors.surface,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.brand : colors.line,
        borderRadius: radius.lg,
        padding: spacing.md,
      }}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Row gap={spacing.sm} style={{ flex: 1 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: '#eaf1ff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="subheading" tone="brand">
              {match.traveller_initial ?? (match.traveller_first_name?.[0] ?? 'T').toUpperCase()}
            </AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="subheading">{match.traveller_first_name ?? 'Verified traveller'}</AppText>
            <AppText variant="small" tone="muted">
              {modeLabel(match.mode)} · {match.completed_trips} completed ·{' '}
              {match.verification_state === 'verified' ? 'ID verified' : 'ID not verified'}
            </AppText>
          </View>
        </Row>
        <Badge label={match.band.toUpperCase()} tone={match.band === 'excellent' ? 'success' : 'info'} />
      </Row>

      <AppText variant="small" style={{ marginTop: spacing.sm }}>
        Departs {formatDateTime(match.departure_at)} · {kg(match.capacity_kg_remaining)} free
      </AppText>
      {match.accepts_documents_only ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
          Documents only on this trip.
        </AppText>
      ) : null}
      {match.reasons.length ? (
        <Row style={{ flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
          {match.reasons.slice(0, 3).map((reason) => (
            <View
              key={reason}
              style={{ backgroundColor: colors.canvas, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}
            >
              <AppText variant="small" tone="muted">
                {reason.replace(/_/g, ' ').toLowerCase()}
              </AppText>
            </View>
          ))}
        </Row>
      ) : null}
      <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm }}>
        Indicative price {inr(match.indicative_price_paise)} · final price comes from your quote.
      </AppText>
    </Pressable>
  );
}
