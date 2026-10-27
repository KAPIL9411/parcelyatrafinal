import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { useSession } from '../session.tsx';
import { AppText, Button, Card, LoadingBlock, Screen } from './ui.tsx';

export function goSignIn(next: string): void {
  router.push({ pathname: '/sign-in', params: { next } });
}

export function SignInPanel({
  title = 'Sign in to continue',
  body = 'Your bookings, parcels and trips live on one account.',
  next,
}: {
  title?: string;
  body?: string;
  next: string;
}) {
  return (
    <Card>
      <AppText variant="heading">{title}</AppText>
      <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
        {body}
      </AppText>
      <Button label="Sign in" onPress={() => goSignIn(next)} style={{ marginTop: 16 }} />
    </Card>
  );
}

/**
 * Guards a whole screen. While the stored session is being checked nothing protected is painted, so
 * a deep link cannot flash someone else's view before deciding.
 */
export function AuthGate({ next, children }: { next: string; children: ReactNode }) {
  const { status } = useSession();
  if (status === 'booting') {
    return (
      <Screen>
        <LoadingBlock lines={4} />
      </Screen>
    );
  }
  if (status !== 'signed_in') {
    return (
      <Screen>
        <SignInPanel next={next} />
      </Screen>
    );
  }
  return <>{children}</>;
}
