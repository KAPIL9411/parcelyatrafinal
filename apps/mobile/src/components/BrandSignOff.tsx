/**
 * The signature block that closes a page — home, each tab, and help.
 *
 * It is typography and nothing else: an oversized headline in a muted blue-grey, a hairline rule, and
 * the wordmark sitting low and faint in the corner. The idea is an editorial page footer, so the
 * whitespace carries the section and there is no card, no gradient and no artwork competing with it.
 *
 * Two things it does for itself, because every screen that ends with it would otherwise repeat them:
 * it measures the window rather than taking props — a full-width panel needs the viewport width even
 * where the screen's own content column is narrower — and it lifts in on mount the way the rest of the
 * feed it closes does. `Screen`'s `bleed` slot is where it lands on the tab and help pages.
 */
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppText } from './ui.tsx';
import { Reveal } from '../homepage/components/Reveal.tsx';
import { colors, font, spacing } from '../theme.ts';
import { withAlpha } from '../homepage/theme.ts';

const HEADLINE = "India's smarter way to send parcels";
const SIGNATURE = 'intercity parcels carried by people, not trucks';

/**
 * Ink, and why each one sits where it does. All three are the app's own navy at three different
 * strengths, so the block has one hue and three weights instead of a pile of greys. The headline is
 * thinned to about half: large enough to pass 3:1 at display size while still reading as a soft
 * blue-grey rather than a headline competing with the booking card. The wordmark is deliberately
 * fainter than legible — it is a signature, not a claim. The small line is nearly full ink because
 * at 13 px it has to clear 4.5:1, and a faint caption is the one place where "understated" would
 * just read as a bug.
 */
const HEADLINE_INK = withAlpha(colors.navy, 0.52);
const WORDMARK_INK = withAlpha(colors.navy, 0.22);
const SIGNATURE_INK = withAlpha(colors.navy, 0.72);

export function BrandSignOff() {
  // Display scale, not a fixed size: the block has to look composed on a 320 dp phone and a tablet.
  const { width, height: viewportHeight } = useWindowDimensions();
  const gutter = Math.max(spacing.lg, Math.round(width * 0.046));
  const headline = Math.max(36, Math.min(Math.round(width * 0.118), 56));
  const wordmark = Math.max(18, Math.min(Math.round(width * 0.056), 27));

  return (
    <Reveal
      delay={140}
      style={[
        styles.section,
        {
          minHeight: Math.round(viewportHeight * 0.36),
          paddingTop: Math.round(viewportHeight * 0.05),
          paddingBottom: Math.round(viewportHeight * 0.05),
          paddingHorizontal: gutter,
        },
      ]}
    >
      <AppText
        variant="display"
        style={{
          fontFamily: font.bold,
          fontSize: headline,
          lineHeight: Math.round(headline * 1.08),
          letterSpacing: -0.6,
          color: HEADLINE_INK,
        }}
      >
        {HEADLINE}
        <Ionicons
          name="heart"
          size={Math.round(headline * 0.56)}
          color={colors.brand}
          style={{ marginLeft: Math.round(headline * 0.1), lineHeight: Math.round(headline * 1.08) }}
        />
      </AppText>

      <View
        style={{
          marginTop: Math.round(viewportHeight * 0.03),
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.line,
        }}
      />

      <AppText
        variant="title"
        style={{
          marginTop: Math.round(viewportHeight * 0.028),
          fontFamily: font.bold,
          fontSize: wordmark,
          lineHeight: Math.round(wordmark * 1.3),
          letterSpacing: -0.2,
          color: WORDMARK_INK,
        }}
      >
        Parcel Yatra
      </AppText>

      <AppText
        variant="small"
        style={{ marginTop: spacing.xs, fontFamily: font.regular, color: SIGNATURE_INK }}
      >
        {SIGNATURE}
      </AppText>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  section: {
    width: '100%',
    // A shade deeper than the page canvas, so the block reads as its own panel without a border,
    // a card radius or a gradient doing the work.
    backgroundColor: colors.canvasAlt,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
});
