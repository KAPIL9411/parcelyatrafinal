import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  AppText,
  Banner,
  Button,
  Card,
  Row,
  Screen,
} from '../src/components/ui.tsx';
import { InfoNote, QuickTile, SectionHead } from '../src/components/kit.tsx';
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
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Screen>
      {/* hero */}
      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: radius.xl,
          padding: spacing.lg,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: 170,
            height: 170,
            borderRadius: 85,
            backgroundColor: 'rgba(10,87,255,0.32)',
            right: -60,
            top: -70,
          }}
        />
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: colors.accent, letterSpacing: 1.1 }}>
              SUPPORT
            </AppText>
            <AppText variant="title" tone="white" style={{ marginTop: 4 }}>
              How can we help?
            </AppText>
            <AppText variant="small" tone="onDark" style={{ marginTop: 2 }}>
              Most questions are answered below. If not, support is a person, and we answer within 48 hours.
            </AppText>
          </View>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="help-buoy" size={22} color={colors.white} />
          </View>
        </Row>
        <Row gap={spacing.sm} style={{ marginTop: spacing.md, flexWrap: 'wrap' }}>
          <View style={pill}>
            <Ionicons name="person" size={11} color={colors.accent} />
            <AppText variant="micro" style={{ color: colors.white, fontFamily: font.regular }}>
              A person replies
            </AppText>
          </View>
          <View style={pill}>
            <Ionicons name="time" size={11} color={colors.accent} />
            <AppText variant="micro" style={{ color: colors.white, fontFamily: font.regular }}>
              Within 48 hours
            </AppText>
          </View>
        </Row>
      </View>

      {/* policy shortcuts */}
      <View style={{ marginTop: spacing.xl }}>
        <SectionHead eyebrow="Policies" title="The rules, in plain words" />
        <Row gap={spacing.md} style={{ alignItems: 'stretch' }}>
          <QuickTile
            icon="pricetag"
            title="Pricing"
            subtitle="What you pay and what a traveller earns"
            onPress={() => router.push('/info/pricing')}
          />
          <QuickTile
            icon="shield-checkmark"
            title="Safety"
            subtitle="Codes, photos and verification"
            onPress={() => router.push('/info/safety')}
            tint={colors.successBg}
            iconColor={colors.success}
          />
        </Row>
        <Row gap={spacing.md} style={{ alignItems: 'stretch', marginTop: spacing.md }}>
          <QuickTile
            icon="ban"
            title="Prohibited"
            subtitle="What can never travel"
            onPress={() => router.push('/info/prohibited')}
            tint={colors.dangerBg}
            iconColor={colors.danger}
          />
          <QuickTile
            icon="megaphone"
            title="Grievance"
            subtitle="Escalate a complaint to a person"
            onPress={() => router.push('/info/grievance')}
            tint={colors.warnBg}
            iconColor={colors.warn}
          />
        </Row>
      </View>

      {/* FAQ */}
      <View style={{ marginTop: spacing.xxl }}>
        <SectionHead title="Common questions" />
        <View style={{ gap: spacing.sm }}>
          {FAQ.map((item, index) => {
            const expanded = open === index;
            return (
              <Pressable
                key={item.q}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpen(expanded ? null : index)}
                style={({ pressed }) => [
                  {
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: expanded ? '#d5e2ff' : colors.line,
                    borderRadius: radius.lg,
                    padding: spacing.md,
                  },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="body" style={{ fontFamily: font.semibold, flex: 1 }}>
                    {item.q}
                  </AppText>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: expanded ? colors.brandSoft : colors.canvas,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons
                      name={expanded ? 'remove' : 'add'}
                      size={15}
                      color={expanded ? colors.brandDark : colors.ink500}
                    />
                  </View>
                </Row>
                {expanded ? (
                  <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm, lineHeight: 21 }}>
                    {item.a}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* still stuck */}
      <Card style={{ marginTop: spacing.xl }}>
        <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chatbubbles" size={18} color={colors.brandDark} />
          </View>
          <AppText variant="heading" style={{ flex: 1 }}>
            Still stuck?
          </AppText>
        </Row>
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm, lineHeight: 21 }}>
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
          onPress={() => router.push('/bookings')}
          style={{ marginTop: spacing.md }}
        />
        <Button
          label="Read the grievance process"
          variant="secondary"
          onPress={() => router.push('/info/grievance')}
          style={{ marginTop: spacing.sm }}
        />
      </Card>

      {/* honest limits */}
      <View style={{ marginTop: spacing.lg }}>
        <Card style={{ backgroundColor: colors.canvas, shadowOpacity: 0, elevation: 0 }}>
          <AppText variant="subheading">What this build does not do</AppText>
          <Fact text="No live GPS or map. Status comes from people marking each step." />
          <Fact text="No automatic parcel insurance." />
          <Fact text="Payouts are disabled at launch." />
          <Fact text="Payments cannot be captured: a booking can request one, but it stays unpaid." />
          <Fact text="Only car travel carries parcels. Bikes, buses, trains and flights are not open." />
        </Card>
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <InfoNote
          icon="lock-closed"
          title="Your number stays private"
          body="The other side sees a masked number and a first name. Chat and calls stay attached to the booking."
        />
      </View>
    </Screen>
  );
}

const pill = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 5,
  backgroundColor: 'rgba(255,255,255,0.10)',
  borderRadius: radius.pill,
  paddingHorizontal: 10,
  paddingVertical: 5,
};

function Fact({ text }: { text: string }) {
  return (
    <Row gap={spacing.sm} style={{ alignItems: 'flex-start', marginTop: 6 }}>
      <Ionicons name="close-circle" size={14} color={colors.ink300} style={{ marginTop: 2 }} />
      <AppText variant="small" style={{ flex: 1, lineHeight: 20 }}>
        {text}
      </AppText>
    </Row>
  );
}
