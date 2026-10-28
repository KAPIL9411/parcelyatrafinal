import { ActivityIndicator, Animated, Pressable, StyleSheet } from 'react-native';

import { colors, font, spacing } from '../theme.ts';
import { AppText } from './ui.tsx';

export function GoogleButtonShell({
  busy,
  disabled = false,
  onPress,
}: {
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const blocked = busy || disabled;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.googleButton,
        {
          opacity: blocked ? 0.6 : pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.brand} size="small" />
      ) : (
        <Animated.Image
          source={require('../../assets/google-g-logo.png')}
          style={styles.googleIcon}
          resizeMode="contain"
        />
      )}
      <AppText style={styles.googleButtonLabel}>{busy ? 'Connecting…' : 'Continue with Google'}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  googleButton: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#0a57ff',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    paddingHorizontal: spacing.lg,
  },
  googleIcon: {
    width: 22,
    height: 22,
  },
  googleButtonLabel: {
    fontSize: 16,
    fontFamily: font.semibold,
    color: '#111827',
  },
});
