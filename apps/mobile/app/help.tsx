import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import {
  AppText,
  Banner,
  Button,
  Card,
  Row,
  Screen,
} from '../src/components/ui.tsx';
import { colors, font, radius, spacing } from '../src/theme.ts';

const FAQ = [
  {
    q: 'Where is my parcel?',
    a: 'Open the booking. The status history shows every update the traveller or sender has made. There is no live map — we do not track anyone’s location.',
  },
  {
    q: 'The traveller is late.',
    a: 'Message them from the booking. If they are more than two hours past the estimate, contact support and we will help. You can cancel if the parcel has not been picked up.',
  },
  {
    q: 'My parcel arrived damaged.',
    a: 'Raise a problem from the booking within 72 hours of delivery. Add photos and a description. Payout stays frozen while we review it.',
  },
  {
    q: 'Can I send cash or jewellery?',
    a: 'No. Neither is accepted, at any value. Also prohibited: medicines, food, lithium batteries, weapons, live animals and anything illegal.',
  },
  {
    q: 'Is my parcel insured?',
    a: 'Not in this build. We are working on cover. Until it exists, we can help you investigate and may offer a goodwill amount, but we cannot repay the full declared value.',
  },
  {
    q: 'How do I get paid as a traveller?',
    a: 'Your share becomes eligible 72 hours after delivery, if no case is open. Payouts are disabled at launch, so nothing is released in this build.',
  },
  {
    q: 'Why do you need my ID?',
    a: 'Only travellers are verified. We check one photo ID and a selfie so a sender knows who is carrying their parcel. We never ask for Aadhaar.',
  },
  {
    q: 'How do payments work right now?',
    a: 'A booking can create a payment request, but no provider checkout is wired in this build. The app says so instead of pretending money moved, and the booking stays unpaid.',
  },
  {
    q: 'Can I delete my account?',
    a: 'Yes, from Profile, once no booking is open. We keep payment, refund, dispute and audit records where the law requires it.',
  },
];

export default function HelpScreen() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <Screen>
      <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase' }}>
        Help
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        How can we help?
      </AppText>
      <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
        Most questions are answered below. Support is a person, and we answer within 48 hours.
      </AppText>

      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {FAQ.map((item, index) => {
          const expanded = open === index;
          return (
            <Pressable
              key={item.q}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : index)}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.lg,
                padding: spacing.md,
              }}
            >
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="body" style={{ fontFamily: font.semibold, flex: 1 }}>
                  {item.q}
                </AppText>
                <AppText variant="body" tone="muted">
                  {expanded ? '−' : '+'}
                </AppText>
              </Row>
              {expanded ? (
                <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm }}>
                  {item.a}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <AppText variant="heading">Still stuck?</AppText>
        <AppText variant="body" tone="muted" style={{ marginTop: spacing.sm }}>
          Use the support route inside the booking. Include the booking reference, what happened, when, and
          any photos or documents that support it. Do not send an Aadhaar copy.
        </AppText>
        <Banner
          tone="warn"
          title="Pilot contact details are not published yet"
          body="The grievance officer’s name, address and email must be published before launch. Until then, the support route inside a booking is the way to reach a person."
        />
        <Button
          label="Open my bookings"
          variant="secondary"
          onPress={() => router.push('/bookings')}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <Card style={{ marginTop: spacing.md, backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
        <AppText variant="subheading">What this build does not do</AppText>
        <Fact text="No live GPS or map. Status comes from people marking each step." />
        <Fact text="No automatic parcel insurance." />
        <Fact text="Payouts are disabled at launch." />
        <Fact text="Payments cannot be captured: a booking can request one, but it stays unpaid." />
        <Fact text="Only car travel carries parcels. Bikes, buses, trains and flights are not open." />
      </Card>
    </Screen>
  );
}

function Fact({ text }: { text: string }) {
  return (
    <Row gap={spacing.sm} style={{ alignItems: 'flex-start', marginTop: 6 }}>
      <AppText variant="small" tone="brand">
        •
      </AppText>
      <AppText variant="small" style={{ flex: 1 }}>
        {text}
      </AppText>
    </Row>
  );
}
