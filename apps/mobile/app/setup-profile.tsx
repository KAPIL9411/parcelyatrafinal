import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { filesApi, resolveApiUrl, updateMe } from '../src/api/client.ts';
import { ApiError } from '../src/api/http.ts';
import { AuthGate } from '../src/components/auth-gate.tsx';
import { AppText, Button, ErrorNotice, Field, Screen } from '../src/components/ui.tsx';
import { captureSelfie, type PickedPhoto } from '../src/lib/photo';
import { useSession } from '../src/session.tsx';
import { colors, font, radius, spacing } from '../src/theme.ts';

/**
 * The one screen a fresh Google account sees before its first home page.
 *
 * Google hands us a name and an email but no photo the app may display, so the account arrives
 * without the two things a handover depends on: a face the other side can recognise and a name
 * they can call out. The selfie is taken by the front camera on the spot (`captureSelfie`), never
 * picked from the library — an album photo could be anybody's face.
 *
 * Both exits mark the question answered (`profile_setup_completed: true`), including "Add the
 * photo later". The server stores that in `users.profile_setup_completed_at`, and the gate
 * (`needsProfileSetup`) reads it, so this screen appears exactly once per account.
 */
export default function SetupProfileScreen() {
  return (
    <AuthGate next="/setup-profile">
      <SetupFlow />
    </AuthGate>
  );
}

function SetupFlow() {
  const { user, refreshProfile } = useSession();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ next?: string }>();
  const target = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/(tabs)';

  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [locale, setLocale] = useState<'en-IN' | 'hi-IN'>(user?.locale === 'hi-IN' ? 'hi-IN' : 'en-IN');
  const [busy, setBusy] = useState<'save' | 'skip' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const savedPhoto = Boolean(user?.avatar_key);
  const previewUri = photo?.uri ?? (user?.avatar_url ? resolveApiUrl(user.avatar_url) : null);
  const firstName = (name.trim() || user?.name || '').split(' ')[0];
  const canSave = Boolean(name.trim()) && !busy;

  async function takeSelfie() {
    setError(null);
    try {
      const picked = await captureSelfie();
      if (picked) setPhoto(picked);
    } catch (err) {
      setError(err);
    }
  }

  /**
   * `skip` sends only the completion flag: the user chose not to share a photo yet, and the name
   * Google gave us stays as it is. Everything else is a normal profile update.
   */
  async function submit(mode: 'save' | 'skip') {
    const trimmed = name.trim();
    if (mode === 'save' && !trimmed) {
      setError(new Error('Add your name to continue.'));
      return;
    }
    setBusy(mode);
    setError(null);
    try {
      let newKey: string | undefined;
      if (mode === 'save' && photo) {
        const uploaded = await filesApi.upload('avatar', photo.uri, photo.contentType);
        newKey = uploaded.object_key;
      }
      await updateMe({
        profile_setup_completed: true,
        ...(mode === 'save' ? { name: trimmed, locale } : {}),
        ...(newKey ? { avatar_key: newKey } : {}),
      });
      await refreshProfile();
      router.replace(target);
    } catch (err) {
      setError(err);
      // The bytes never reached the server, so keeping the local photo would only repeat the refusal.
      if (
        err instanceof ApiError &&
        (err.code === 'UPLOAD_EXPIRED' || (err.code === 'VALIDATION_FAILED' && err.details.field === 'avatar_key'))
      ) {
        setPhoto(null);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen keyboard contentStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.2 }}>
          ONE-TIME SETUP
        </AppText>
        <AppText variant="title" style={{ marginTop: 6 }}>
          {firstName ? `Hi ${firstName}, make it yours` : 'Make it yours'}
        </AppText>
        <AppText variant="small" tone="muted" style={{ marginTop: 6 }}>
          A photo and your name are what the other side sees at handover. You can change both later
          from your profile.
        </AppText>
      </View>

      <View style={styles.avatarBlock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={previewUri ? 'Change your photo' : 'Take a selfie'}
          onPress={takeSelfie}
          style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.85 }]}
        >
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.avatarImage} resizeMode="cover" />
          ) : (
            <Ionicons name="camera-outline" size={30} color={colors.brandDark} />
          )}
          <View style={styles.avatarBadge}>
            <Ionicons name={previewUri ? 'refresh' : 'add'} size={15} color={colors.white} />
          </View>
        </Pressable>
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
          {photo
            ? 'This is the photo that will be saved.'
            : savedPhoto
              ? 'Tap to replace your saved photo.'
              : 'Tap to take a selfie — the front camera opens.'}
        </AppText>
        {photo ? (
          <Button
            label="Remove photo"
            variant="tertiary"
            size="sm"
            fullWidth={false}
            onPress={() => setPhoto(null)}
            style={{ marginTop: spacing.xs }}
          />
        ) : null}
      </View>

      <Field
        label="Your name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          setError(null);
        }}
        maxLength={80}
        placeholder="e.g. Aarti"
        autoCapitalize="words"
        hint="First name is enough. This is what the other side sees."
      />

      <AppText variant="label" tone="muted" style={styles.segmentLabel}>
        Language
      </AppText>
      <View style={styles.segment}>
        {(
          [
            ['en-IN', 'English'],
            ['hi-IN', 'हिन्दी'],
          ] as const
        ).map(([value, label]) => {
          const selected = locale === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setLocale(value)}
              style={[styles.segmentItem, selected && styles.segmentItemSelected]}
            >
              <AppText
                variant="small"
                style={{
                  fontFamily: selected ? font.semibold : font.regular,
                  color: selected ? colors.brandDark : colors.ink500,
                }}
              >
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorNotice error={error} />
        </View>
      ) : null}

      <Button
        label="Continue"
        onPress={() => submit('save')}
        loading={busy === 'save'}
        disabled={!canSave}
        style={{ marginTop: spacing.lg }}
      />
      <Pressable
        onPress={() => submit('skip')}
        disabled={busy !== null}
        hitSlop={10}
        accessibilityRole="button"
        style={{ alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.xs }}
      >
        <AppText variant="small" tone="muted">
          {busy === 'skip' ? 'Saving…' : 'Add the photo later'}
        </AppText>
      </Pressable>

      <View style={styles.privacyRow}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.ink500} />
        <AppText variant="micro" tone="muted" style={{ flex: 1, marginLeft: spacing.xs }}>
          The selfie is your profile photo, not an identity document. Verification is separate and
          always asks for your ID again.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xl,
  },
  header: {
    marginBottom: spacing.lg,
  },
  avatarBlock: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 56,
  },
  avatarBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: {
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.canvasAlt,
    borderRadius: radius.md,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  segmentItemSelected: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.xl,
  },
});
