import { Link } from 'react-router-dom';

import { useDocumentTitle } from '../lib/hooks';
import { Banner, Button, Card } from '../components/ui';
import { ArrowRightIcon, DocIcon, LockIcon, ShieldCheckIcon, PhoneIcon } from '../components/icons';

function PageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
        <p className="mt-2 text-base text-ink-700">{intro}</p>
      </div>
      {children}
    </div>
  );
}

function DraftNotice({ what }: { what: string }) {
  return (
    <Banner tone="warn" title="Draft — not legal advice, and not yet reviewed">
      This {what} is a draft. A qualified Indian lawyer must review it before it is used as a contract. Do not rely
      on it as a statement of your legal rights.
    </Banner>
  );
}

// ---------------------------------------------------------------------------- pricing

export function Pricing() {
  useDocumentTitle('Pricing');

  return (
    <PageShell
      eyebrow="Pricing"
      title="Every rupee is named before you pay"
      intro="The server computes one price for your parcel from the route, the weight and the category. You see every line before you book, and the price is held for a short window."
    >
      <Banner tone="info" title="The amounts below are a pricing hypothesis, not a market rate">
        This is a pilot formula. It has not been validated against real demand, and it may change. The price you see
        in the app is the one that applies to your booking.
      </Banner>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">How the total is built</h2>
        <ol className="mt-3 space-y-3 text-sm text-ink-700">
          <li>
            <strong className="text-ink-900">Base fare</strong> — a fixed start for any parcel.
          </li>
          <li>
            <strong className="text-ink-900">Distance</strong> — the corridor length by road, not a straight line.
          </li>
          <li>
            <strong className="text-ink-900">Weight</strong> — charged above the first kilogram.
          </li>
          <li>
            <strong className="text-ink-900">Handling</strong> — a small multiplier by category, because some items
            need more care.
          </li>
          <li>
            <strong className="text-ink-900">Platform fee</strong> — what Parcel Yatra keeps to run the service.
          </li>
          <li>
            <strong className="text-ink-900">GST</strong> — calculated on the subtotal plus the platform fee.
          </li>
        </ol>
        <p className="mt-4 rounded-input bg-canvas px-3 py-2 text-sm text-ink-700">
          The traveller’s share is the subtotal minus the service component. It is paid after delivery, once the
          72-hour problem window has passed. Payouts are disabled in this build.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What changes the price</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>Weight above 1 kg, up to the 5 kg pilot limit.</li>
          <li>The corridor distance. Bareilly ⇄ Delhi NCR and Bareilly ⇄ Lucknow are open at pilot.</li>
          <li>The category, through the handling multiplier.</li>
          <li>
            A named surge multiplier, never applied silently. It is capped, and the quote shows it as its own line.
          </li>
        </ul>
        <p className="mt-3 text-sm text-ink-500">
          No hidden “convenience” charge appears at payment. If a line is not on the quote, you are not charged for
          it.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">Cancellations and refunds</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>Cancel before a traveller accepts: nothing was charged, so nothing is refunded.</li>
          <li>
            Cancel after acceptance: the traveller keeps their share for the trip they set aside; the rest is
            returned. How fast your bank posts a refund is outside our control.
          </li>
          <li>We do not hold your money as a custodian. Payment goes to the provider; the provider settles.</li>
        </ul>
        <p className="mt-3 text-sm text-ink-500">
          The full refund policy is a draft awaiting legal review. Read it in the repository, or ask support for a
          copy.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link to="/send">
          <Button>
            Price a parcel
            <ArrowRightIcon size={17} />
          </Button>
        </Link>
        <Link to="/prohibited">
          <Button variant="secondary">Check the prohibited list</Button>
        </Link>
      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------- prohibited

const HARD_BLOCKS = [
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
];

export function Prohibited() {
  useDocumentTitle('Prohibited items');

  return (
    <PageShell
      eyebrow="Prohibited items"
      title="What we do not carry"
      intro="This list is deliberately short and specific. If your item is on it, we cannot carry it — there is no manual override."
    >
      <Banner tone="danger" title="If you are unsure, do not book">
        A wrong declaration is a safety problem and a legal problem. Ask support before you pack.
      </Banner>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">Never accepted</h2>
        <ul className="mt-3 grid gap-2 text-sm text-ink-700 sm:grid-cols-2">
          {HARD_BLOCKS.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-danger-600" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What we do carry at pilot</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>Documents and property or court papers, sealed and photographed.</li>
          <li>Educational certificates.</li>
          <li>Dry spare parts with no oil, fuel or battery.</li>
          <li>Sealed, non-flammable cosmetics.</li>
          <li>Printed material, business samples and religious items within the value limit.</li>
          <li>Keys and low-value electronics accessories such as cables and chargers.</li>
        </ul>
        <p className="mt-3 text-sm text-ink-500">
          Limits: 5 kg, 45 cm on each side, declared value up to ₹5,000. Parcels are not insured.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">A traveller can always refuse</h2>
        <p className="mt-2 text-sm text-ink-700">
          At the door, a traveller may refuse without penalty if the seal is broken, the weight does not match, or
          the parcel looks like it contains something prohibited. Refusal does not affect their rating.
        </p>
      </Card>

      <p className="text-sm text-ink-500">
        This policy is risk-based, not a statutory schedule. A lawyer must review it against Indian law before
        launch. See the repository’s legal drafts for the current list.
      </p>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------- safety

export function Safety() {
  useDocumentTitle('Safety');

  return (
    <PageShell
      eyebrow="Safety"
      title="How a handover works"
      intro="Two codes, two photos and a written record. No live tracking, no unverified stranger at the door."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            icon: ShieldCheckIcon,
            title: 'Verified travellers',
            body: 'A person checks one photo ID and a selfie before a trip can be published. We do not accept Aadhaar.',
          },
          {
            icon: LockIcon,
            title: 'A code at each end',
            body: 'The sender gives a six-digit code only after the traveller has the parcel. The receiver gives another at delivery.',
          },
          {
            icon: DocIcon,
            title: 'A photo of the seal',
            body: 'The parcel is photographed sealed before pickup, so both sides have a record of how it left.',
          },
          {
            icon: PhoneIcon,
            title: 'No number shared',
            body: 'Each side sees a masked number and a first name. Calls go through the app, not a personal phone.',
          },
        ].map((item) => (
          <Card key={item.title}>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">
              <item.icon size={20} />
            </span>
            <h2 className="mt-3 text-base font-semibold text-ink-900">{item.title}</h2>
            <p className="mt-1 text-sm text-ink-700">{item.body}</p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What we do not do</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>We do not track the traveller’s live location. Status updates come from the people involved.</li>
          <li>We do not insure your parcel in this build.</li>
          <li>We do not carry cash, jewellery or documents we cannot replace.</li>
          <li>We do not hold your money. A payment provider does, and payouts are disabled at pilot.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">If something goes wrong</h2>
        <p className="mt-2 text-sm text-ink-700">
          Raise a problem from the booking within 72 hours of delivery. That freezes the traveller’s payout until a
          person has reviewed the case. Keep the packaging and the photos.
        </p>
        <Link to="/help" className="mt-3 inline-block">
          <Button variant="secondary">Get help</Button>
        </Link>
      </Card>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------- help

export function Help() {
  useDocumentTitle('Help');

  return (
    <PageShell
      eyebrow="Help"
      title="How can we help?"
      intro="Most questions are answered below. If not, support is a person, and we answer within 48 hours."
    >
      <div className="space-y-3">
        {[
          {
            q: 'Where is my parcel?',
            a: 'Open the booking. The status history shows every update the traveller or sender has made. There is no live map — we do not track anyone’s location.',
          },
          {
            q: 'The traveller is late.',
            a: 'Call them through the booking. If they are more than two hours past the estimate, contact support and we will help. You can cancel if the parcel has not been picked up.',
          },
          {
            q: 'My parcel arrived damaged.',
            a: 'Raise a problem from the booking within 72 hours of delivery. Add photos and a description. Payout stays frozen while we review it.',
          },
          {
            q: 'Can I send cash or jewellery?',
            a: 'No. Neither is accepted, at any value. See the prohibited items list.',
          },
          {
            q: 'Is my parcel insured?',
            a: 'Not in this build. We are working on cover. Until it exists, we can help you investigate and may offer a goodwill amount, but we cannot repay the full declared value.',
          },
          {
            q: 'How do I get paid as a traveller?',
            a: 'Your share becomes eligible 72 hours after delivery, if no case is open. Payouts are disabled at pilot, so nothing is released in this build.',
          },
          {
            q: 'Why do you need my ID?',
            a: 'Only travellers are verified. We check one photo ID and a selfie so a sender knows who is carrying their parcel. We never ask for Aadhaar.',
          },
          {
            q: 'Can I delete my account?',
            a: 'Yes, from your account page, once no booking is open. We keep payment, refund, dispute and audit records where the law requires it.',
          },
        ].map((item) => (
          <details key={item.q} className="rounded-card border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink-900">{item.q}</summary>
            <p className="mt-2 text-sm text-ink-700">{item.a}</p>
          </details>
        ))}
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">Still stuck?</h2>
        <p className="mt-2 text-sm text-ink-700">
          Write to the grievance officer with your booking reference. We respond within 48 hours. This is a pilot,
          so support hours are limited and published separately.
        </p>
        <Link to="/grievance" className="mt-3 inline-block">
          <Button variant="secondary">Contact the grievance officer</Button>
        </Link>
      </Card>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------- terms

export function Terms() {
  useDocumentTitle('Terms of service (draft)');

  return (
    <PageShell
      eyebrow="Terms"
      title="Terms of service"
      intro="A short summary of the draft terms. The draft itself is in the repository and needs review by an Indian lawyer."
    >
      <DraftNotice what="document" />

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What Parcel Yatra is</h2>
        <p className="mt-2 text-sm text-ink-700">
          A marketplace that introduces a sender to a traveller already making a journey. The traveller carries the
          parcel in their own vehicle. Parcel Yatra is not a courier, a common carrier or a bank.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What you agree to</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>Describe the contents accurately and do not hand over a prohibited item.</li>
          <li>Seal the parcel and photograph it before pickup.</li>
          <li>Use the handover codes as instructed. Do not share a code before the parcel changes hands.</li>
          <li>Treat the other person with respect. Threats or discrimination end the account.</li>
          <li>Pay the price you were shown. The server computes it; a client-supplied amount is ignored.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What we do not promise</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>That a traveller will be available for your route or window.</li>
          <li>That a parcel is insured. It is not, in this build.</li>
          <li>That delivery will happen at an exact minute. Arrival times are estimates given by the traveller.</li>
          <li>That money can be paid out. Payouts are disabled at pilot.</li>
        </ul>
      </Card>

      <p className="text-sm text-ink-500">
        Governing law, liability limits, dispute resolution and the grievance process are set out in the draft and
        must be reviewed by counsel. Nothing on this page is legal advice.
      </p>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------- privacy

export function Privacy() {
  useDocumentTitle('Privacy notice (draft)');

  return (
    <PageShell
      eyebrow="Privacy"
      title="Privacy notice"
      intro="What we collect, why, and what we refuse to collect. The full draft needs review by an Indian lawyer."
    >
      <DraftNotice what="notice" />

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What we collect</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>Your phone number, stored as a hash and the last four digits. The full number is not stored.</li>
          <li>Your name, email if you give one, and language preference.</li>
          <li>For travellers: one photo ID, a selfie and the reviewer’s decision.</li>
          <li>Parcel descriptions, photos of the sealed parcel, and handover records.</li>
          <li>Booking, payment, refund and dispute records.</li>
          <li>Audit log entries for staff actions.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What we refuse to collect</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>Aadhaar numbers or Aadhaar images. We do not ask, and we do not accept them if offered.</li>
          <li>Continuous or live location. The maximum resolution is the area you choose.</li>
          <li>Your contact list, SMS inbox or unrelated files.</li>
          <li>Advertising identifiers or behavioural profiles. There are no third-party ad trackers in this build.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">Who sees what</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>The other side sees your first name and a masked phone number, never the full number.</li>
          <li>Verification photos are visible only to the reviewer, never to senders.</li>
          <li>Staff access is role-gated and every read is written to the audit log.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">Your choices</h2>
        <p className="mt-2 text-sm text-ink-700">
          You can export your data or delete your account from the account page. Deletion is refused while a booking
          is open. Some records are kept where the law requires it: payment, refund, dispute and audit records.
        </p>
        <Link to="/profile" className="mt-3 inline-block">
          <Button variant="secondary">Open your account</Button>
        </Link>
      </Card>

      <p className="text-sm text-ink-500">
        Retention periods, the legal basis for processing, cross-border transfer and the grievance route are set out
        in the draft and require counsel. Nothing here is legal advice.
      </p>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------- grievance

export function Grievance() {
  useDocumentTitle('Grievance officer');

  return (
    <PageShell
      eyebrow="Grievance"
      title="Raise a grievance"
      intro="A person reads every complaint. We respond within 48 hours, and we tell you what we did."
    >
      <Banner tone="warn" title="Pilot contact details are not published yet">
        The name, postal address and email of the grievance officer must be published before launch, as the
        applicable rules require. Until they are, use the support route inside a booking. This gap is recorded in the
        repository’s open blockers.
      </Banner>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What to include</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>Your booking reference, if the complaint is about a booking.</li>
          <li>What happened, and when.</li>
          <li>What outcome you are asking for.</li>
          <li>Any photos or documents that support it. Do not send an Aadhaar copy.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">What happens next</h2>
        <ol className="mt-3 space-y-2 text-sm text-ink-700">
          <li>We acknowledge the complaint and give it a reference.</li>
          <li>A person reviews the booking, the handover record and both accounts.</li>
          <li>We respond within 48 hours with a decision and the reason for it.</li>
          <li>If you disagree, you can ask for a second review. We tell you who is doing it.</li>
        </ol>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link to="/help">
          <Button>Read the help page first</Button>
        </Link>
        <Link to="/bookings">
          <Button variant="secondary">Open a booking</Button>
        </Link>
      </div>
    </PageShell>
  );
}
