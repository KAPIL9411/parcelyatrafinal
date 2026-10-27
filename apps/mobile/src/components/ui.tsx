import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, shadow, spacing, type } from '../theme.ts';
import { errorCopy, formatDate, formatTime } from '../lib/format.ts';

// ---------------------------------------------------------------------------- text

type Tone = 'default' | 'muted' | 'onDark' | 'brand' | 'danger' | 'success' | 'white';

const TONE_COLORS: Record<Tone, string> = {
  default: colors.ink900,
  muted: colors.ink500,
  onDark: '#c9d3e6',
  brand: colors.brandDark,
  danger: colors.danger,
  success: colors.success,
  white: colors.white,
};

export function AppText({
  variant = 'body',
  tone = 'default',
  style,
  children,
  numberOfLines,
  onPress,
}: {
  variant?: keyof typeof type;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  onPress?: () => void;
}) {
  return (
    <Text
      onPress={onPress}
      numberOfLines={numberOfLines}
      style={[type[variant], { color: TONE_COLORS[tone] }, style]}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------- buttons

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'dark';
  size?: 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        variant === 'primary' && { backgroundColor: colors.brand },
        variant === 'secondary' && { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
        variant === 'tertiary' && { backgroundColor: 'transparent' },
        variant === 'danger' && { backgroundColor: colors.danger },
        variant === 'dark' && { backgroundColor: colors.navy },
        fullWidth && { alignSelf: 'stretch' },
        pressed && { opacity: 0.82 },
        isDisabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'tertiary' ? colors.brand : colors.white} />
      ) : (
        <Text
          style={[
            type.button,
            size === 'sm' && { fontSize: 14 },
            {
              color:
                variant === 'secondary' || variant === 'tertiary'
                  ? variant === 'tertiary'
                    ? colors.brandDark
                    : colors.ink900
                  : colors.white,
            },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------- layout

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, shadow.card, pressed && { opacity: 0.9 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, shadow.card, style]}>{children}</View>;
}

export function Row({
  children,
  style,
  gap = spacing.sm,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }, style]} />;
}

export function Screen({
  children,
  scroll = true,
  refreshControl,
  keyboard = false,
  contentStyle,
  footer,
  background = colors.canvas,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
  keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** A sticky bar below the scroll area — the price/action row on the send flow. */
  footer?: ReactNode;
  background?: string;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={Platform.OS === 'web' ? undefined : refreshControl}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: background }}
      behavior={keyboard && Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
      {footer ? <View style={{ paddingBottom: insets.bottom }}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

export function SectionTitle({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Row style={[{ justifyContent: 'space-between', marginBottom: spacing.sm }, style]}>
      <AppText variant="heading">{title}</AppText>
      {actionLabel ? (
        <AppText variant="small" tone="brand" onPress={onAction} style={{ fontFamily: font.semibold }}>
          {actionLabel}
        </AppText>
      ) : null}
    </Row>
  );
}

// ---------------------------------------------------------------------------- badges

export function Badge({
  label,
  tone = 'neutral',
  style,
}: {
  label: string;
  tone?: 'neutral' | 'info' | 'success' | 'warn' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const map = {
    neutral: { background: colors.canvas, text: colors.ink700, border: colors.line },
    info: { background: '#eaf1ff', text: colors.brandDark, border: '#ccdcff' },
    success: { background: colors.successBg, text: colors.success, border: '#c6e5d3' },
    warn: { background: colors.warnBg, text: colors.warn, border: '#f0dfb0' },
    danger: { background: colors.dangerBg, text: colors.danger, border: '#f5c9c4' },
  }[tone];
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: map.background,
          borderColor: map.border,
          borderWidth: 1,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.sm + 2,
          paddingVertical: 3,
        },
        style,
      ]}
    >
      <Text style={[type.label, { color: map.text, textTransform: 'none', letterSpacing: 0.2 }]}>{label}</Text>
    </View>
  );
}

export function Banner({
  title,
  body,
  tone = 'info',
}: {
  title: string;
  body?: string;
  tone?: 'info' | 'success' | 'warn' | 'danger';
}) {
  const map = {
    info: { background: '#eef4ff', border: '#d5e2ff', text: colors.brandDark },
    success: { background: colors.successBg, border: '#c6e5d3', text: colors.success },
    warn: { background: colors.warnBg, border: '#f0dfb0', text: colors.warn },
    danger: { background: colors.dangerBg, border: '#f5c9c4', text: colors.danger },
  }[tone];
  return (
    <View style={{ backgroundColor: map.background, borderColor: map.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
      <AppText variant="subheading" style={{ color: map.text }}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="small" style={{ color: map.text, marginTop: 2 }}>
          {body}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- forms

export function Field({
  label,
  hint,
  error,
  accessory,
  style,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  accessory?: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </AppText>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: error ? colors.danger : focused ? colors.brand : colors.line,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
        }}
      >
        <TextInput
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          placeholderTextColor={colors.ink500}
          style={[{ flex: 1, paddingVertical: 12, color: colors.ink900, fontFamily: font.regular, fontSize: 16 }, style]}
        />
        {accessory}
      </View>
      {error ? (
        <AppText variant="small" tone="danger" style={{ marginTop: 4 }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function Choice({
  label,
  selected,
  onPress,
  meta,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  meta?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: selected ? colors.brand : colors.line,
        backgroundColor: selected ? '#eef4ff' : colors.surface,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      <View style={{ flex: 1 }}>
        <AppText variant="body" style={{ fontFamily: selected ? font.semibold : font.regular }}>
          {label}
        </AppText>
        {meta ? (
          <AppText variant="small" tone="muted">
            {meta}
          </AppText>
        ) : null}
      </View>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? colors.brand : colors.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand }} /> : null}
      </View>
    </Pressable>
  );
}

export function Checkbox({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      onPress={disabled ? undefined : onToggle}
      style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingVertical: spacing.sm }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: checked ? colors.brand : colors.line,
          backgroundColor: checked ? colors.brand : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {checked ? <Text style={{ color: colors.white, fontFamily: font.bold, fontSize: 14 }}>✓</Text> : null}
      </View>
      <AppText variant="small" style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function SelectField({
  label,
  value,
  placeholder = 'Choose',
  onPress,
  error,
  hint,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  onPress: () => void;
  error?: string;
  hint?: string;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.line,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: 13,
        }}
      >
        <AppText variant="body" tone={value ? 'default' : 'muted'} style={{ flex: 1 }}>
          {value || placeholder}
        </AppText>
        <Text style={{ color: colors.ink500, fontSize: 16 }}>⌄</Text>
      </Pressable>
      {error ? (
        <AppText variant="small" tone="danger" style={{ marginTop: 4 }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

interface DateTimeFieldProps {
  label: string;
  value: Date | null;
  onChange: (next: Date) => void;
  minimumDate?: Date;
  error?: string;
  hint?: string;
}

/**
 * The browser preview has no native date dialog (the package renders nothing there), so it gets two
 * plain text fields. Native platforms keep the real picker below.
 */
export function DateTimeField(props: DateTimeFieldProps) {
  if (Platform.OS === 'web') return <WebDateTimeField {...props} />;
  return <NativeDateTimeField {...props} />;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dateInputText(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function timeInputText(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseLocalDateTime(dateText: string, timeText: string): Date | null {
  const date = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateText.trim());
  const time = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!date || !time) return null;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Round-trip check rejects dates the calendar rolled over, e.g. 2026-02-31.
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function WebDateTimeField({ label, value, onChange, error, hint }: DateTimeFieldProps) {
  // The inputs keep their own draft so a half-typed date is not rewritten on every keystroke.
  // A draft remembers which value it belongs to; when the caller hands us a different one, the
  // text is re-derived during render rather than patched from an effect.
  const valueKey = value ? value.getTime() : null;
  const [draft, setDraft] = useState(() => ({
    key: valueKey,
    date: value ? dateInputText(value) : '',
    time: value ? timeInputText(value) : '',
  }));

  const shown =
    draft.key === valueKey
      ? draft
      : {
          key: valueKey,
          date: value ? dateInputText(value) : '',
          time: value ? timeInputText(value) : '',
        };

  function edit(nextDate: string, nextTime: string) {
    setDraft({ key: valueKey, date: nextDate, time: nextTime });
    const parsed = parseLocalDateTime(nextDate, nextTime);
    if (parsed) onChange(parsed);
  }

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: error ? colors.danger : colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.ink900,
    fontFamily: font.regular,
    fontSize: 16,
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TextInput
          value={shown.date}
          onChangeText={(next) => {
            edit(next, shown.time);
          }}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.ink500}
          autoCapitalize="none"
          style={[{ flex: 1.4 }, inputStyle]}
        />
        <TextInput
          value={shown.time}
          onChangeText={(next) => {
            edit(shown.date, next);
          }}
          placeholder="HH:MM"
          placeholderTextColor={colors.ink500}
          autoCapitalize="none"
          style={[{ flex: 1 }, inputStyle]}
        />
      </View>
      {error ? (
        <AppText variant="small" tone="danger" style={{ marginTop: 4 }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function NativeDateTimeField({ label, value, onChange, minimumDate, error, hint }: DateTimeFieldProps) {
  const [step, setStep] = useState<'date' | 'time' | null>(null);

  function handle(event: DateTimePickerEvent, picked?: Date) {
    if (event.type !== 'set' || !picked) {
      setStep(null);
      return;
    }
    if (Platform.OS === 'ios') {
      onChange(picked);
      return;
    }
    if (step === 'date') {
      const base = new Date(picked);
      const previous = value ?? new Date();
      base.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
      onChange(base);
      if (Platform.OS === 'android') {
        // Android has no combined picker: the date dialog is followed by a time dialog. The date is
        // committed first so cancelling the second step still keeps the day the user picked.
        setStep('time');
      } else {
        setStep(null);
      }
      return;
    }
    const base = new Date(value ?? new Date());
    base.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    onChange(base);
    setStep(null);
  }

  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        onPress={() => setStep('date')}
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.line,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: 13,
        }}
      >
        <AppText variant="body" tone={value ? 'default' : 'muted'}>
          {value ? `${formatDate(value.toISOString())} · ${formatTime(value)}` : 'Choose date and time'}
        </AppText>
      </Pressable>
      {error ? (
        <AppText variant="small" tone="danger" style={{ marginTop: 4 }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
          {hint}
        </AppText>
      ) : null}

      {step && Platform.OS !== 'ios' ? (
        <DateTimePicker
          value={value ?? new Date()}
          mode={step}
          minimumDate={step === 'date' ? minimumDate : undefined}
          onChange={handle}
        />
      ) : null}

      {step && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" onRequestClose={() => setStep(null)}>
          <Pressable style={styles.backdrop} onPress={() => setStep(null)}>
            <Pressable style={[styles.sheet, { paddingBottom: spacing.xl }]} onPress={() => {}}>
              <AppText variant="heading" style={{ marginBottom: spacing.sm }}>
                {label}
              </AppText>
              <DateTimePicker value={value ?? new Date()} mode="datetime" minimumDate={minimumDate} display="spinner" onChange={handle} />
              <Button label="Done" onPress={() => setStep(null)} style={{ marginTop: spacing.md }} />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- states

export function LoadingBlock({ lines = 3 }: { lines?: number }) {
  return (
    <View accessibilityLabel="Loading" style={{ gap: spacing.sm }}>
      {Array.from({ length: lines }).map((_, index) => (
        <View
          key={index}
          style={{
            height: index === 0 ? 22 : 14,
            width: index === 0 ? '55%' : `${88 - index * 8}%`,
            backgroundColor: '#e8ecf3',
            borderRadius: 6,
          }}
        />
      ))}
    </View>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const copy = errorCopy(error);
  return (
    <View style={{ backgroundColor: colors.dangerBg, borderColor: '#f5c9c4', borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
      <AppText variant="subheading" style={{ color: colors.danger }}>
        {copy.title}
      </AppText>
      <AppText variant="small" style={{ color: colors.danger, marginTop: 2 }}>
        {copy.body}
      </AppText>
      {onRetry ? (
        <Button label="Try again" variant="secondary" size="sm" onPress={onRetry} fullWidth={false} style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg }}>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: '#eaf1ff',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        }}
      >
        <Text style={{ fontSize: 22, color: colors.brandDark }}>◫</Text>
      </View>
      <AppText variant="subheading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText variant="small" tone="muted" style={{ textAlign: 'center', marginTop: 4 }}>
        {body}
      </AppText>
      {actionLabel ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} style={{ marginTop: spacing.lg, paddingHorizontal: spacing.xl }} />
      ) : null}
    </View>
  );
}

export function Refresh({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />;
}

// ---------------------------------------------------------------------------- sheets & pickers

export function Sheet({
  visible,
  onClose,
  title,
  scroll = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Long forms inside a sheet need their own scroll area; a picker's FlatList must not be nested. */
  scroll?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg, maxHeight: '85%' }]}>
          <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
            <AppText variant="heading">{title}</AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
              <Text style={{ fontSize: 22, color: colors.ink500 }}>×</Text>
            </Pressable>
          </Row>
          {scroll ? (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </View>
    </Modal>
  );
}

export interface PickerOption {
  value: string;
  label: string;
  meta?: string;
}

export function PickerSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  emptyText = 'Nothing to choose from.',
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selected?: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
  emptyText?: string;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {options.length === 0 ? (
        <AppText variant="small" tone="muted">
          {emptyText}
        </AppText>
      ) : (
        <FlatList
          data={options}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onSelect(item.value);
                onClose();
              }}
              style={{
                paddingVertical: spacing.md,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.line,
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: spacing.sm,
              }}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="body" style={{ fontFamily: item.value === selected ? font.semibold : font.regular }}>
                  {item.label}
                </AppText>
                {item.meta ? (
                  <AppText variant="small" tone="muted">
                    {item.meta}
                  </AppText>
                ) : null}
              </View>
              {item.value === selected ? <AppText tone="brand">✓</AppText> : null}
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  button: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSm: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(10,23,48,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
});
