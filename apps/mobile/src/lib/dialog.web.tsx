/**
 * The browser half of `src/lib/dialog`.
 *
 * React Native's `Alert` writes to the console and does nothing in a web page, which would turn
 * every confirmation in this app into a silent action — including "discard this parcel" and "cancel
 * this booking". The host below renders the same question with the app's own card, type and buttons,
 * so a confirmation on an iPhone looks like a confirmation in this brand rather than a Safari
 * `window.confirm`.
 *
 * `DialogHost` is mounted once by the root layout. `showAlert` is called from anywhere, including
 * from a `beforeRemove` navigation handler, and hands its question to that host.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button } from '../components/ui.tsx';
import { colors, radius, shadow, spacing } from '../theme.ts';
import type { DialogAction } from './dialog.tsx';

interface Question {
  title: string;
  message?: string;
  actions: DialogAction[];
}

let current: Question | null = null;
const hosts = new Set<(question: Question | null) => void>();

function publish(question: Question | null): void {
  current = question;
  for (const host of hosts) host(question);
}

export function showAlert(title: string, message?: string, actions: readonly DialogAction[] = []): void {
  publish({ title, message, actions: actions.length ? [...actions] : [{ text: 'OK' }] });
}

export function DialogHost() {
  const [question, setQuestion] = useState<Question | null>(current);

  useEffect(() => {
    hosts.add(setQuestion);
    return () => {
      hosts.delete(setQuestion);
    };
  }, []);

  if (!question) return null;

  // Dismissing from the backdrop or Escape answers nothing, exactly as tapping outside an Android
  // alert leaves every button's handler un-called.
  const dismiss = () => publish(null);
  const answer = (action: DialogAction) => {
    dismiss();
    action.onPress?.();
  };

  return (
    <Modal transparent visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={dismiss} />
        <View style={styles.card} accessibilityRole="alertdialog">
          <AppText variant="heading">{question.title}</AppText>
          {question.message ? (
            <AppText variant="small" tone="muted" style={styles.message}>
              {question.message}
            </AppText>
          ) : null}
          <View style={[styles.actions, question.actions.length > 2 && styles.actionsStacked]}>
            {question.actions.map((action, index) => (
              <Button
                key={`${action.text}-${index}`}
                label={action.text}
                size="sm"
                variant={
                  action.style === 'destructive'
                    ? 'danger'
                    : index === question.actions.length - 1
                      ? 'primary'
                      : 'secondary'
                }
                style={styles.actionButton}
                onPress={() => answer(action)}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,23,48,0.45)',
    padding: spacing.lg,
  },
  dismissArea: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.floating,
  },
  message: { marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  actionsStacked: { flexDirection: 'column' },
  actionButton: { flex: 1, minWidth: 96 },
});
