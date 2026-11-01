import { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppText, Row } from './ui.tsx';
import { colors, font, radius, shadow, spacing, type } from '../theme.ts';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------- avatars & icons

type AvatarPalette = { bg: string; fg: string };

/**
 * The photo, with the initials still behind it. A signed avatar URL expires, and on a device that
 * has been offline the bytes may never arrive; a face that fails to load must not leave a blank
 * circle. Keying this component on the URL is what makes a freshly saved selfie retry.
 */
function AvatarPhoto({
  uri,
  size,
  label,
  palette,
}: {
  uri: string;
  size: number;
  label: string;
  palette: AvatarPalette;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <AppText style={{ color: palette.fg, fontFamily: font.bold, fontSize: size * 0.36 }}>{label}</AppText>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      resizeMode="cover"
      accessibilityLabel="Profile photo"
      accessibilityIgnoresInvertColors
      onError={() => setFailed(true)}
    />
  );
}

export function Avatar({
  name,
  size = 44,
  tone = 'brand',
  uri,
}: {
  name: string | null | undefined;
  size?: number;
  tone?: 'brand' | 'partner' | 'navy';
  uri?: string | null;
}) {
  const palette: AvatarPalette = {
    brand: { bg: colors.brandSoft, fg: colors.brandDark },
    partner: { bg: colors.partnerSoft, fg: colors.partner },
    navy: { bg: colors.navy, fg: colors.white },
  }[tone];
  const label = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.bg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri ? (
        <AvatarPhoto key={uri} uri={uri} size={size} label={label || 'PY'} palette={palette} />
      ) : (
        <AppText style={{ color: palette.fg, fontFamily: font.bold, fontSize: size * 0.36 }}>
          {label || 'PY'}
        </AppText>
      )}
    </View>
  );
}

export function IconBubble({
  name,
  size = 42,
  color = colors.brandDark,
  background = colors.brandSoft,
  iconSize,
}: {
  name: IconName;
  size?: number;
  color?: string;
  background?: string;
  iconSize?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={iconSize ?? Math.round(size * 0.48)} color={color} />
    </View>
  );
}

// ---------------------------------------------------------------------------- route & status

export function RouteTimeline({
  origin,
  dest,
  originMeta,
  destMeta,
  compact = false,
  tone = 'brand',
}: {
  origin: string;
  dest: string;
  originMeta?: string;
  destMeta?: string;
  compact?: boolean;
  tone?: 'brand' | 'partner';
}) {
  const accent = tone === 'partner' ? colors.partner : colors.brand;
  return (
    <View>
      <View style={[styles.timelineLine, { top: 16, bottom: 16, backgroundColor: colors.line }]} />
      <View style={styles.timelineRow}>
        <View style={[styles.timelineDot, { borderColor: accent }]}>
          <View style={[styles.timelineDotCore, { backgroundColor: accent }]} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="label" tone="muted" style={{ letterSpacing: 0.6 }}>
            PICKUP
          </AppText>
          <AppText variant={compact ? 'body' : 'subheading'} numberOfLines={1} style={{ marginTop: 1 }}>
            {origin}
          </AppText>
          {originMeta ? (
            <AppText variant="small" tone="muted" numberOfLines={1}>
              {originMeta}
            </AppText>
          ) : null}
        </View>
      </View>
      <View style={[styles.timelineRow, { marginTop: compact ? spacing.sm : spacing.md }]}>
        <View style={[styles.timelineDot, { borderColor: colors.navy, borderRadius: 4 }]}>
          <View style={[styles.timelineDotCore, { backgroundColor: colors.navy, borderRadius: 1 }]} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="label" tone="muted" style={{ letterSpacing: 0.6 }}>
            DROP
          </AppText>
          <AppText variant={compact ? 'body' : 'subheading'} numberOfLines={1} style={{ marginTop: 1 }}>
            {dest}
          </AppText>
          {destMeta ? (
            <AppText variant="small" tone="muted" numberOfLines={1}>
              {destMeta}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const TRACK_STEPS = ['Booked', 'Picked up', 'On the way', 'Delivered'] as const;

function trackIndex(status: string): number {
  if (status === 'picked_up') return 1;
  if (status === 'in_transit' || status === 'arrived') return 2;
  if (['delivered', 'payout_eligible', 'paid_out'].includes(status)) return 3;
  if (['pending_traveller_acceptance', 'payment_pending', 'confirmed', 'pickup_ready'].includes(status)) return 0;
  return -1;
}

export function StatusTrack({
  status,
  tone = 'brand',
  showLabels = true,
}: {
  status: string;
  tone?: 'brand' | 'partner';
  showLabels?: boolean;
}) {
  const index = trackIndex(status);
  const accent = tone === 'partner' ? colors.partner : colors.brand;
  if (index < 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {TRACK_STEPS.map((label, position) => {
        const done = position < index;
        const current = position === index;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              <View style={{ flex: 1, height: 3, backgroundColor: position === 0 ? 'transparent' : position <= index ? accent : colors.line }} />
              <View
                style={{
                  width: current ? 18 : 14,
                  height: current ? 18 : 14,
                  borderRadius: 9,
                  backgroundColor: position <= index ? accent : colors.surface,
                  borderWidth: position <= index ? 0 : 2,
                  borderColor: colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done ? <Ionicons name="checkmark" size={9} color={colors.white} /> : null}
                {current ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.white }} /> : null}
              </View>
              <View style={{ flex: 1, height: 3, backgroundColor: position === TRACK_STEPS.length - 1 ? 'transparent' : position < index ? accent : colors.line }} />
            </View>
            {showLabels ? (
              <AppText
                variant="micro"
                numberOfLines={1}
                style={{
                  marginTop: 5,
                  color: position <= index ? colors.ink700 : colors.ink300,
                  fontFamily: position === index ? font.bold : font.regular,
                  fontSize: 10,
                }}
              >
                {label}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------- navigation & layout

export function SearchPill({
  placeholder,
  onPress,
  icon = 'search',
  badge,
}: {
  placeholder: string;
  onPress: () => void;
  icon?: IconName;
  badge?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={placeholder}
      onPress={onPress}
      style={({ pressed }) => [styles.searchPill, shadow.floating, pressed && { opacity: 0.94 }]}
    >
      <View style={styles.searchIcon}>
        <Ionicons name={icon} size={18} color={colors.brand} />
      </View>
      <AppText variant="body" tone="muted" numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold }}>
        {placeholder}
      </AppText>
      {badge ? (
        <View style={styles.searchBadge}>
          <AppText variant="micro" style={{ color: colors.brandDark }}>
            {badge}
          </AppText>
        </View>
      ) : (
        <Ionicons name="arrow-forward" size={18} color={colors.ink300} />
      )}
    </Pressable>
  );
}

export function SectionHead({
  eyebrow,
  title,
  actionLabel,
  onAction,
  style,
}: {
  eyebrow?: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      {eyebrow ? (
        <AppText variant="label" tone="brand" style={{ letterSpacing: 1.1, marginBottom: 2 }}>
          {eyebrow.toUpperCase()}
        </AppText>
      ) : null}
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="heading" style={{ flex: 1 }}>
          {title}
        </AppText>
        {actionLabel ? (
          <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
            <Row gap={2}>
              <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                {actionLabel}
              </AppText>
              <Ionicons name="chevron-forward" size={13} color={colors.brandDark} />
            </Row>
          </Pressable>
        ) : null}
      </Row>
    </View>
  );
}

export function QuickTile({
  icon,
  title,
  subtitle,
  onPress,
  tint = colors.brandSoft,
  iconColor = colors.brandDark,
  badge,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  tint?: string;
  iconColor?: string;
  badge?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quickTile, pressed && { opacity: 0.86 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <IconBubble name={icon} size={40} background={tint} color={iconColor} />
        {badge ? (
          <View style={[styles.tileBadge, { backgroundColor: tint }]}>
            <AppText variant="micro" style={{ color: iconColor }}>
              {badge}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="subheading" numberOfLines={1} style={{ marginTop: spacing.sm }}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="small" tone="muted" numberOfLines={2} style={{ marginTop: 1 }}>
          {subtitle}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: selected ? colors.navy : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.navy : colors.line,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: 8,
      }}
    >
      {icon ? <Ionicons name={icon} size={13} color={selected ? colors.white : colors.ink500} /> : null}
      <AppText
        variant="small"
        style={{ color: selected ? colors.white : colors.ink700, fontFamily: font.semibold, fontSize: 12 }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <AppText
              variant="small"
              style={{
                fontFamily: font.semibold,
                fontSize: 13,
                color: active ? colors.ink900 : colors.ink500,
              }}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MenuRow({
  icon,
  label,
  meta,
  value,
  onPress,
  tone = 'brand',
  last = false,
}: {
  icon: IconName;
  label: string;
  meta?: string;
  value?: string;
  onPress: () => void;
  tone?: 'brand' | 'partner' | 'navy' | 'danger';
  last?: boolean;
}) {
  const palette = {
    brand: { bg: colors.brandSoft, fg: colors.brandDark },
    partner: { bg: colors.partnerSoft, fg: colors.partner },
    navy: { bg: colors.canvasAlt, fg: colors.navy },
    danger: { bg: colors.dangerBg, fg: colors.danger },
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <IconBubble name={icon} size={36} background={palette.bg} color={palette.fg} iconSize={18} />
      <View style={{ flex: 1 }}>
        <AppText variant="body" style={{ fontFamily: font.semibold }}>
          {label}
        </AppText>
        {meta ? (
          <AppText variant="small" tone="muted" numberOfLines={1}>
            {meta}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <View style={styles.menuValue}>
          <AppText variant="micro" tone="brand">
            {value}
          </AppText>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.ink300} />
    </Pressable>
  );
}

export function Stat({
  value,
  label,
  tone = 'default',
}: {
  value: string;
  label: string;
  tone?: 'default' | 'brand' | 'partner' | 'onDark';
}) {
  const valueColor =
    tone === 'brand'
      ? colors.brandDark
      : tone === 'partner'
        ? colors.partner
        : tone === 'onDark'
          ? colors.white
          : colors.ink900;
  return (
    <View style={{ flex: 1 }}>
      <AppText variant="price" style={{ fontSize: 20, color: valueColor }}>
        {value}
      </AppText>
      <AppText
        variant="micro"
        tone={tone === 'onDark' ? undefined : 'muted'}
        style={{ fontFamily: font.regular, color: tone === 'onDark' ? '#bfe9db' : undefined }}
      >
        {label}
      </AppText>
    </View>
  );
}

export function StickyBar({
  label,
  value,
  caption,
  buttonLabel,
  onPress,
  disabled,
  loading,
}: {
  label?: string;
  value?: string;
  caption?: string;
  buttonLabel: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <View style={styles.sticky}>
      <View style={{ flex: 1 }}>
        {label ? (
          <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular }}>
            {label}
          </AppText>
        ) : null}
        {value ? (
          <AppText variant="price" style={{ fontSize: 20 }}>
            {value}
          </AppText>
        ) : null}
        {caption ? (
          <AppText variant="micro" tone="muted" numberOfLines={1} style={{ fontFamily: font.regular }}>
            {caption}
          </AppText>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        onPress={disabled || loading ? undefined : onPress}
        style={({ pressed }) => [
          styles.stickyButton,
          (disabled || loading) && { opacity: 0.45 },
          pressed && { opacity: 0.86 },
        ]}
      >
        {loading ? (
          <Ionicons name="hourglass-outline" size={18} color={colors.white} />
        ) : (
          <>
            <AppText variant="button" tone="white" style={{ fontSize: 15 }}>
              {buttonLabel}
            </AppText>
            <Ionicons name="arrow-forward" size={16} color={colors.white} />
          </>
        )}
      </Pressable>
    </View>
  );
}

export function InfoNote({ icon = 'shield-checkmark', title, body }: { icon?: IconName; title: string; body: string }) {
  return (
    <View style={styles.infoNote}>
      <Ionicons name={icon} size={16} color={colors.ink500} />
      <View style={{ flex: 1 }}>
        <AppText variant="micro" style={{ color: colors.ink700 }}>
          {title}
        </AppText>
        <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular, marginTop: 1 }}>
          {body}
        </AppText>
      </View>
    </View>
  );
}

export const kitStyles = StyleSheet.create({
  surface: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
});

const styles = StyleSheet.create({
  timelineLine: { position: 'absolute', left: 8, width: 2 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  timelineDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  timelineDotCore: { width: 8, height: 8, borderRadius: 4 },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingLeft: 8,
    paddingRight: spacing.md,
    paddingVertical: 8,
    minHeight: 54,
  },
  searchIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBadge: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  quickTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    minHeight: 112,
    ...shadow.soft,
  },
  tileBadge: { borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.canvasAlt,
    borderRadius: radius.pill,
    padding: 4,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    ...shadow.soft,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  menuValue: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sticky: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    ...shadow.sheet,
  },
  stickyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    minHeight: 48,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});

export { type, font };
