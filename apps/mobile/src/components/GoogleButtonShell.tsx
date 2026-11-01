import { ActivityIndicator, Animated, Pressable, StyleSheet, Platform } from 'react-native';

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

  // For web, use a native button with better touch handling
  if (Platform.OS === 'web') {
    return (
      <button
        disabled={blocked}
        onClick={onPress}
        style={{
          width: '100%',
          height: 52,
          minHeight: 52,
          borderRadius: 14,
          backgroundColor: '#FFFFFF',
          border: '1.5px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          boxShadow: '0 3px 12px rgba(10, 87, 255, 0.08)',
          paddingLeft: spacing.lg,
          paddingRight: spacing.lg,
          cursor: blocked ? 'not-allowed' : 'pointer',
          opacity: blocked ? 0.6 : 1,
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
          fontFamily: font.semibold,
          fontSize: 16,
          color: '#111827',
          transition: 'all 0.2s ease',
        } as any}
        onMouseDown={(e) => {
          if (!blocked) {
            e.currentTarget.style.transform = 'scale(0.99)';
            e.currentTarget.style.opacity = '0.88';
          }
        }}
        onMouseUp={(e) => {
          if (!blocked) {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.opacity = '1';
          }
        }}
        onMouseLeave={(e) => {
          if (!blocked) {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.opacity = '1';
          }
        }}
        onTouchStart={(e) => {
          if (!blocked) {
            e.currentTarget.style.transform = 'scale(0.99)';
            e.currentTarget.style.opacity = '0.88';
          }
        }}
        onTouchEnd={(e) => {
          if (!blocked) {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.opacity = '1';
          }
        }}
      >
        {busy ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: 20,
              height: 20,
              border: '2px solid #0a57ff',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
          </div>
        ) : (
          <img
            src={require('../../assets/google-g-logo.png')}
            alt="Google"
            style={{ width: 22, height: 22 }}
          />
        )}
        <span>{busy ? 'Connecting…' : 'Continue with Google'}</span>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </button>
    );
  }

  // Native mobile version (unchanged)
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
    minHeight: 52,
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
    // Web-specific improvements for iOS Safari
    userSelect: 'none' as any,
    touchAction: 'manipulation' as any,
    WebkitTapHighlightColor: 'transparent' as any,
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
