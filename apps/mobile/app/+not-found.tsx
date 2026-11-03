import { router } from 'expo-router';

import { AppText, Button, Card, Screen } from '../src/components/ui.tsx';
import { spacing } from '../src/theme.ts';

export default function NotFound() {
  return (
    <Screen>
      <Card>
        <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase' }}>
          Not found
        </AppText>
        <AppText variant="title" style={{ marginTop: 4 }}>
          This page does not exist
        </AppText>
        <AppText variant="body" tone="muted" style={{ marginTop: spacing.sm }}>
          The link may be old, or it may point at something that is not yours. Nothing was changed.
        </AppText>
        <Button label="Go home" onPress={() => router.replace('/')} style={{ marginTop: spacing.lg }} />
        <Button
          label="See my bookings"
          variant="secondary"
          onPress={() => router.replace('/bookings')}
          style={{ marginTop: spacing.sm }}
        />
      </Card>
    </Screen>
  );
}
