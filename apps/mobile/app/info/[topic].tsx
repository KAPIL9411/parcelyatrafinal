import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  AppText,
  Banner,
  Button,
  Card,
  EmptyState,
  Row,
  Screen,
} from '../../src/components/ui.tsx';
import { IconBubble, InfoNote } from '../../src/components/kit.tsx';
import { colors, font, radius, spacing } from '../../src/theme.ts';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Block =
  | { kind: 'banner'; tone: 'info' | 'warn' | 'danger' | 'success'; title: string; body?: string }
  | { kind: 'card'; title?: string; body?: string; bullets?: string[]; ordered?: boolean; note?: string }
  | { kind: 'grid'; items: { icon: IconName; title: string; body: string }[] }
  | { kind: 'note'; icon?: IconName; title: string; body: string }
  | {
      kind: 'cta';
      label: string;
      route: '/send' | '/help' | '/profile' | '/bookings' | '/info/prohibited';
      variant?: 'primary' | 'secondary';
    };

interface TopicContent {
  headerTitle: string;
  eyebrow: string;
  title: string;
  intro: string;
  icon: IconName;
  accent: string;
  accentSoft: string;
  blocks: Block[];
}

const TOPICS: Record<string, TopicContent> = {
  // ------------------------------------------------------------------ pricing
  pricing: {
    headerTitle: 'Pricing',
    eyebrow: 'Pricing',
    title: 'Every rupee is named before you pay',
    intro:
      'The server computes one price for your parcel from the route, the weight and the category. You see every line before you book, and the price is held for a short window.',
    icon: 'pricetag',
    accent: colors.brandDark,
    accentSoft: colors.brandSoft,
    blocks: [
      {
        kind: 'banner',
        tone: 'info',
        title: 'These amounts are a pricing hypothesis, not a market rate',
        body: 'This is a launch formula. It has not been validated against real demand, and it may change. The price you see in the app is the one that applies to your booking.',
      },
      {
        kind: 'card',
        title: 'How the total is built',
        ordered: true,
        bullets: [
          'Base fare — a fixed start for any parcel.',
          'Distance — the corridor length by road, not a straight line.',
          'Weight — charged above the first kilogram.',
          'Handling — a small multiplier by category, because some items need more care.',
          'Platform fee — what Parcel Yatra keeps to run the service.',
          'GST — calculated on the subtotal plus the platform fee.',
        ],
        note: 'The traveller’s share is the subtotal minus the service component. It becomes eligible 72 hours after delivery. Payouts are disabled in this build.',
      },
      {
        kind: 'card',
        title: 'What changes the price',
        bullets: [
          'Weight above 1 kg, up to the 5 kg launch limit.',
          'The corridor distance. Bareilly ⇄ Delhi NCR and Bareilly ⇄ Lucknow are open at launch.',
          'The category, through the handling multiplier.',
          'A named surge multiplier, never applied silently. It is capped, and the quote shows it as its own line.',
        ],
        note: 'No hidden “convenience” charge appears at payment. If a line is not on the quote, you are not charged for it.',
      },
      {
        kind: 'card',
        title: 'Cancellations and refunds',
        bullets: [
          'Cancel before a traveller accepts: nothing was charged, so nothing is refunded.',
          'Cancel after acceptance: the traveller keeps their share for the trip they set aside; the rest is returned. How fast your bank posts a refund is outside our control.',
          'We do not hold your money as a custodian. Payment goes to the provider; the provider settles.',
        ],
        note: 'The full refund policy is a draft awaiting legal review. Ask support for a copy.',
      },
      { kind: 'cta', label: 'Price a parcel', route: '/send' },
      { kind: 'cta', label: 'Check the prohibited list', route: '/info/prohibited', variant: 'secondary' },
    ],
  },

  // ------------------------------------------------------------------ prohibited
  prohibited: {
    headerTitle: 'Prohibited items',
    eyebrow: 'Prohibited items',
    title: 'What we do not carry',
    intro:
      'This list is deliberately short and specific. If your item is on it, we cannot carry it — there is no manual override.',
    icon: 'ban',
    accent: colors.danger,
    accentSoft: colors.dangerBg,
    blocks: [
      {
        kind: 'banner',
        tone: 'danger',
        title: 'If you are unsure, do not book',
        body: 'A wrong declaration is a safety problem and a legal problem. Ask support before you pack.',
      },
      {
        kind: 'card',
        title: 'Never accepted',
        bullets: [
          'Cash, banknotes or coins',
          'Jewellery, gold, silver, gems or bullion',
          'Passports and other travel or identity documents',
          'Firearms, ammunition, explosives or fireworks',
          'Narcotics and controlled drugs',
          'Medicines, vaccines and medical devices',
          'Mobile phones, laptops, tablets, cameras and drones',
          'Lithium batteries, power banks and loose cells',
          'Flammable liquids, fuels, paints and solvents',
          'Live animals, plants needing clearance and perishable food',
          'Alcohol, tobacco and vapes',
          'Human or animal remains, blood and tissue',
          'Wildlife products, ivory and animal parts',
          'Counterfeit goods, pirated media and obscene material',
          'Any item that is unlawful to possess, carry or sell in India',
        ],
      },
      {
        kind: 'card',
        title: 'What we do carry at launch',
        bullets: [
          'Documents and property or court papers, sealed and photographed.',
          'Educational certificates.',
          'Dry spare parts with no oil, fuel or battery.',
          'Sealed, non-flammable cosmetics.',
          'Printed material, business samples and religious items within the value limit.',
          'Keys and low-value electronics accessories such as cables and chargers.',
        ],
        note: 'Limits: 5 kg, 45 cm on each side, declared value up to ₹5,000. Parcels are not insured.',
      },
      {
        kind: 'card',
        title: 'A traveller can always refuse',
        body: 'At the door, a traveller may refuse without penalty if the seal is broken, the weight does not match, or the parcel looks like it contains something prohibited. Refusal does not affect their rating.',
      },
      {
        kind: 'note',
        icon: 'information-circle-outline',
        title: 'Risk-based, not a statutory schedule',
        body: 'A lawyer must review this policy against Indian law before launch. See the repository’s legal drafts for the current list.',
      },
    ],
  },

  // ------------------------------------------------------------------ safety
  safety: {
    headerTitle: 'Safety',
    eyebrow: 'Safety',
    title: 'How a handover works',
    intro:
      'Two codes, two photos and a written record. No live tracking, no unverified stranger at the door.',
    icon: 'shield-checkmark',
    accent: colors.success,
    accentSoft: colors.successBg,
    blocks: [
      {
        kind: 'grid',
        items: [
          {
            icon: 'shield-checkmark-outline',
            title: 'Verified travellers',
            body: 'A person checks one photo ID and a selfie before a trip can be published. We do not accept Aadhaar.',
          },
          {
            icon: 'keypad-outline',
            title: 'A code at each end',
            body: 'The sender gives a six-digit code only after the traveller has the parcel. The receiver gives another at delivery.',
          },
          {
            icon: 'camera-outline',
            title: 'A photo of the seal',
            body: 'The parcel is photographed sealed before pickup, so both sides have a record of how it left.',
          },
          {
            icon: 'call-outline',
            title: 'No number shared',
            body: 'Each side sees a masked number and a first name. Calls go through the app, not a personal phone.',
          },
        ],
      },
      {
        kind: 'card',
        title: 'What we do not do',
        bullets: [
          'We do not track the traveller’s live location. Status updates come from the people involved.',
          'We do not insure your parcel in this build.',
          'We do not carry cash, jewellery or documents we cannot replace.',
          'We do not hold your money. A payment provider does, and payouts are disabled at launch.',
        ],
      },
      {
        kind: 'card',
        title: 'If something goes wrong',
        body: 'Raise a problem from the booking within 72 hours of delivery. That freezes the traveller’s payout until a person has reviewed the case. Keep the packaging and the photos.',
      },
      { kind: 'cta', label: 'Get help', route: '/help', variant: 'secondary' },
    ],
  },

  // ------------------------------------------------------------------ business
  business: {
    headerTitle: 'Business shipping',
    eyebrow: 'For shops and offices',
    title: 'Same-day corridors, without a courier contract',
    intro:
      'If you send documents, samples or printed material between two cities a few times a week, a verified traveller already driving that route can carry them. No minimum volume and no monthly contract.',
    icon: 'business',
    accent: colors.brandDark,
    accentSoft: colors.brandSoft,
    blocks: [
      {
        kind: 'banner',
        tone: 'info',
        title: 'This is the same consumer flow, priced per parcel',
        body: 'There is no separate business account or negotiated rate card in this build. You book each parcel at the price the app shows, and every booking is tracked the same way.',
      },
      {
        kind: 'card',
        title: 'What moves well',
        bullets: [
          'Property papers, invoices and signed contracts, sealed and photographed.',
          'Printed material: brochures, visiting cards, letterheads.',
          'Business samples within the 5 kg and 45 cm limits.',
          'Dry spare parts with no oil, fuel or battery.',
          'Educational certificates and other documents that fit in a sealed envelope.',
        ],
        note: 'Cash, jewellery, medicines, food, batteries and anything on the prohibited list are never carried, whatever the volume.',
      },
      {
        kind: 'card',
        title: 'Why it can be faster than a courier',
        body: 'A traveller is already making the journey. A parcel handed over before they leave can arrive the same day on a corridor like Bareilly to Delhi, instead of waiting for a hub to consolidate it.',
      },
      {
        kind: 'card',
        title: 'What you get on every parcel',
        ordered: true,
        bullets: [
          'A price fixed before you pay, with GST shown as its own line.',
          'A named traveller with a verified photo ID and completed trips.',
          'A handover code at pickup and another at delivery.',
          'A photo of the sealed parcel, kept with the booking.',
          'Chat attached to the booking, with masked phone numbers.',
        ],
        note: 'Parcels are not insured in this build. Declare a value you could absorb, and keep the packaging until delivery is confirmed.',
      },
      {
        kind: 'card',
        title: 'Invoicing and records',
        body: 'Every booking keeps its own receipt in the app, with the price breakdown and the GST line. For a monthly statement across several bookings, ask support with the booking references and we will pull the records together.',
      },
      { kind: 'cta', label: 'Send a business parcel', route: '/send' },
      { kind: 'cta', label: 'Talk to support', route: '/help', variant: 'secondary' },
    ],
  },

  // ------------------------------------------------------------------ terms
  terms: {
    headerTitle: 'Terms of service',
    eyebrow: 'Terms',
    title: 'Terms of service',
    intro:
      'A short summary of the draft terms. The draft itself is in the repository and needs review by an Indian lawyer.',
    icon: 'document-text',
    accent: colors.navy,
    accentSoft: colors.canvasAlt,
    blocks: [
      {
        kind: 'banner',
        tone: 'warn',
        title: 'Draft — not legal advice, and not yet reviewed',
        body: 'This document is a draft. A qualified Indian lawyer must review it before it is used as a contract. Do not rely on it as a statement of your legal rights.',
      },
      {
        kind: 'card',
        title: 'What Parcel Yatra is',
        body: 'A marketplace that introduces a sender to a traveller already making a journey. The traveller carries the parcel in their own vehicle. Parcel Yatra is not a courier, a common carrier or a bank.',
      },
      {
        kind: 'card',
        title: 'What you agree to',
        bullets: [
          'Describe the contents accurately and do not hand over a prohibited item.',
          'Seal the parcel and photograph it before pickup.',
          'Use the handover codes as instructed. Do not share a code before the parcel changes hands.',
          'Treat the other person with respect. Threats or discrimination end the account.',
          'Pay the price you were shown. The server computes it; a client-supplied amount is ignored.',
        ],
      },
      {
        kind: 'card',
        title: 'What we do not promise',
        bullets: [
          'That a traveller will be available for your route or window.',
          'That a parcel is insured. It is not, in this build.',
          'That delivery will happen at an exact minute. Arrival times are estimates given by the traveller.',
          'That money can be paid out. Payouts are disabled at launch.',
        ],
      },
      {
        kind: 'note',
        icon: 'information-circle-outline',
        title: 'Not legal advice',
        body: 'Governing law, liability limits, dispute resolution and the grievance process are set out in the draft and must be reviewed by counsel.',
      },
    ],
  },

  // ------------------------------------------------------------------ privacy
  privacy: {
    headerTitle: 'Privacy policy',
    eyebrow: 'Privacy',
    title: 'Privacy notice',
    intro:
      'What we collect, why, and what we refuse to collect. The full draft needs review by an Indian lawyer.',
    icon: 'lock-closed',
    accent: colors.brandDark,
    accentSoft: colors.brandSoft,
    blocks: [
      {
        kind: 'banner',
        tone: 'warn',
        title: 'Draft — not legal advice, and not yet reviewed',
        body: 'This notice is a draft. A qualified Indian lawyer must review it before launch. Do not rely on it as a statement of your legal rights.',
      },
      {
        kind: 'card',
        title: 'What we collect',
        bullets: [
          'Your phone number, stored as a hash and the last four digits. The full number is not stored.',
          'Your name, email if you give one, and language preference.',
          'For travellers: one photo ID, a selfie and the reviewer’s decision.',
          'Parcel descriptions, photos of the sealed parcel, and handover records.',
          'Booking, payment, refund and dispute records.',
          'Audit log entries for staff actions.',
        ],
      },
      {
        kind: 'card',
        title: 'What we refuse to collect',
        bullets: [
          'Aadhaar numbers or Aadhaar images. We do not ask, and we do not accept them if offered.',
          'Continuous or live location. The maximum resolution is the area you choose.',
          'Your contact list, SMS inbox or unrelated files.',
          'Advertising identifiers or behavioural profiles. There are no third-party ad trackers in this build.',
        ],
      },
      {
        kind: 'card',
        title: 'Who sees what',
        bullets: [
          'The other side sees your first name and a masked phone number, never the full number.',
          'Verification photos are visible only to the reviewer, never to senders.',
          'Staff access is role-gated and every read is written to the audit log.',
        ],
      },
      {
        kind: 'card',
        title: 'Your choices',
        body: 'You can export your data or delete your account from your profile. Deletion is refused while a booking is open. Some records are kept where the law requires it: payment, refund, dispute and audit records.',
      },
      { kind: 'cta', label: 'Open your profile', route: '/profile', variant: 'secondary' },
      {
        kind: 'note',
        icon: 'information-circle-outline',
        title: 'Not legal advice',
        body: 'Retention periods, the legal basis for processing, cross-border transfer and the grievance route are set out in the draft and require counsel.',
      },
    ],
  },

  // ------------------------------------------------------------------ grievance
  grievance: {
    headerTitle: 'Grievance officer',
    eyebrow: 'Grievance',
    title: 'Raise a grievance',
    intro: 'A person reads every complaint. We respond within 48 hours, and we tell you what we did.',
    icon: 'megaphone',
    accent: colors.warn,
    accentSoft: colors.warnBg,
    blocks: [
      {
        kind: 'banner',
        tone: 'warn',
        title: 'Pilot contact details are not published yet',
        body: 'The name, postal address and email of the grievance officer must be published before launch, as the applicable rules require. Until they are, use the support route inside a booking. This gap is recorded in the repository’s open blockers.',
      },
      {
        kind: 'card',
        title: 'What to include',
        bullets: [
          'Your booking reference, if the complaint is about a booking.',
          'What happened, and when.',
          'What outcome you are asking for.',
          'Any photos or documents that support it. Do not send an Aadhaar copy.',
        ],
      },
      {
        kind: 'card',
        title: 'What happens next',
        ordered: true,
        bullets: [
          'We acknowledge the complaint and give it a reference.',
          'A person reviews the booking, the handover record and both accounts.',
          'We respond within 48 hours with a decision and the reason for it.',
          'If you disagree, you can ask for a second review. We tell you who is doing it.',
        ],
      },
      { kind: 'cta', label: 'Read the help page first', route: '/help' },
      { kind: 'cta', label: 'Open a booking', route: '/bookings', variant: 'secondary' },
    ],
  },
};

export default function InfoScreen() {
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const content = typeof topic === 'string' ? TOPICS[topic] : undefined;

  if (!content) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Information' }} />
        <Card>
          <EmptyState
            title="That page does not exist"
            body="Pricing, safety, prohibited items, business shipping, terms, privacy and the grievance route are the pages we publish."
            actionLabel="Go to help"
            onAction={() => router.replace('/help')}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: content.headerTitle }} />

      {/* hero */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.line,
          padding: spacing.lg,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            backgroundColor: content.accent,
          }}
        />
        <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
          <IconBubble name={content.icon} size={46} background={content.accentSoft} color={content.accent} />
          <View style={{ flex: 1 }}>
            <AppText variant="label" style={{ color: content.accent, letterSpacing: 1.1 }}>
              {content.eyebrow.toUpperCase()}
            </AppText>
            <AppText variant="title" style={{ marginTop: 3 }}>
              {content.title}
            </AppText>
          </View>
        </Row>
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.sm }}>
          {content.intro}
        </AppText>
      </View>

      <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
        {content.blocks.map((block, index) => (
          <BlockView key={`${block.kind}-${index}`} block={block} accent={content.accent} />
        ))}
      </View>

      <AppText
        variant="micro"
        tone="muted"
        style={{ textAlign: 'center', marginTop: spacing.xxl, fontFamily: font.regular }}
      >
        Parcel Yatra · policies are versioned and dated in the repository
      </AppText>
    </Screen>
  );
}

function BlockView({ block, accent }: { block: Block; accent: string }) {
  if (block.kind === 'banner') {
    return <Banner tone={block.tone} title={block.title} body={block.body} />;
  }

  if (block.kind === 'grid') {
    return (
      <View style={{ gap: spacing.md }}>
        {block.items.map((item) => (
          <View
            key={item.title}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.line,
              padding: spacing.md,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: spacing.md,
            }}
          >
            <IconBubble name={item.icon} size={38} background={colors.brandSoft} color={colors.brandDark} iconSize={18} />
            <View style={{ flex: 1 }}>
              <AppText variant="subheading">{item.title}</AppText>
              <AppText variant="small" tone="muted" style={{ marginTop: 1 }}>
                {item.body}
              </AppText>
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (block.kind === 'note') {
    return <InfoNote icon={block.icon ?? 'information-circle-outline'} title={block.title} body={block.body} />;
  }

  if (block.kind === 'cta') {
    return (
      <Button
        label={block.label}
        variant={block.variant ?? 'primary'}
        onPress={() => router.push(block.route)}
      />
    );
  }

  return (
    <Card>
      {block.title ? <AppText variant="heading">{block.title}</AppText> : null}
      {block.body ? (
        <AppText variant="small" style={{ marginTop: block.title ? spacing.sm : 0, lineHeight: 21 }}>
          {block.body}
        </AppText>
      ) : null}
      {block.bullets?.length ? (
        <View style={{ marginTop: spacing.sm, gap: 8 }}>
          {block.bullets.map((bullet, index) => (
            <Row key={bullet} gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
              {block.ordered ? (
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: colors.canvasAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 1,
                  }}
                >
                  <AppText variant="micro" style={{ fontFamily: font.bold, fontSize: 9 }}>
                    {index + 1}
                  </AppText>
                </View>
              ) : (
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: accent,
                    marginTop: 8,
                    marginLeft: 3,
                  }}
                />
              )}
              <AppText variant="small" style={{ flex: 1, lineHeight: 21 }}>
                {bullet}
              </AppText>
            </Row>
          ))}
        </View>
      ) : null}
      {block.note ? (
        <View
          style={{
            marginTop: spacing.md,
            backgroundColor: colors.canvas,
            borderRadius: radius.md,
            padding: spacing.sm,
          }}
        >
          <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular, lineHeight: 17 }}>
            {block.note}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}
