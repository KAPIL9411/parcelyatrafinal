# Competitor Workflow Observations

**Status:** Draft v0.1 · **Research date:** 2026-10-24 · **Method:** REA `inspect_web_page` on public pages only
**Scope limit:** No accounts created, no bookings made, no app packages inspected.

---

## 1. Porter (https://porter.in/)

### 1.1 Observed landing structure

Navigation and calls-to-action observed in the accessibility tree (E-02, E-03):

```
PORTER ENTERPRISE  → "Manage logistics needs of your business with Porter Enterprise" → Get in Touch
Our services       → Truck | Two Wheeler | Packers & Movers | Get in Touch
                 → Porter Enterprise (business ops)
                 → API Integration ("Automate the transportation of your goods by integrating our APIs")
                 → Two-Wheelers ("up to 20 kg")
                 → Trucks ("up to 2500 kg")
                 → Packers & Movers
Download App       → Play Store | App Store
Cities             → Delhi NCR, Hyderabad, Bangalore, Mumbai, Vadodara, Chandigarh, Jaipur, Chennai,
                     Kolkata, Indore, Ahmedabad, Surat, Nagpur, Lucknow, Pune, Coimbatore, Kochi,
                     Ludhiana, Nashik, Kanpur, Visakhapatnam, Trivandrum
```

### 1.2 Observed journey (public, unauthenticated)

| Step | What is publicly reachable | Observation |
|---|---|---|
| 1. Landing | Marketing page with service tiles | OBSERVED |
| 2. Service selection | Static tiles; no price without location | OBSERVED |
| 3. Price estimate | Referenced in FAQ ("check the estimate tab") | PUBLISHED |
| 4. Booking | Requires app / login | **NOT ACCESSED** |
| 5. Tracking | Not observed | UNKNOWN |
| 6. Support | FAQ + contact | OBSERVED |

### 1.3 Observed prohibited-goods policy (E-04)

Porter's public FAQ lists (their words, paraphrased where long):

> Pornographic material · dry ice · human corpses/organs · flammables (firecrackers, oil cans,
> adhesives, paint) · explosives/arms/ammunition/fireworks/gunpowder/airbag inflators · fire
> extinguishers · alcohol · tobacco · medicines/drugs/contraband/narcotics/psychotropic substances ·
> poisonous/toxic/infectious items · **passports** · antiques/works of art · high-capacity batteries ·
> machinery parts containing oil/grease/fuel/batteries · corrosives/acids/chemicals · radioactive
> material · **fragile items** · LEDs/LCD/plasma/OLED/TV screens · liquids · **expensive electronics,
> phones, iPads, laptops, smart watches** · livestock/pets · **platinum, gold, silver, jewellery, gems,
> precious stones** · stamps/coins/**banknotes**/Sodexo/securities/traveller's cheques/**cards** ·
> gambling devices/lottery tickets · diagnostic specimens · hazardous/bio-medical waste ·
> **sensitive documents**

**Interpretation (INFERRED, important):** a major Indian logistics platform explicitly refuses
**passports, currency, jewellery, electronics and "sensitive documents"** — i.e. it refuses exactly the
high-value, high-liability categories. This reinforces our decision to cap value at ₹5,000 and start
with low-risk categories. It also shows a commercial operator choosing to *narrow* rather than insure.

**Do not copy this list verbatim.** It is Porter's contractual policy; ours must be independently
drafted from Indian law and our own risk appetite (`legal/PROHIBITED_RESTRICTED_GOODS.md`).

### 1.4 What Porter does that we should learn from

- Extremely concrete capacity framing ("up to 20 kg", "up to 2500 kg") — users self-qualify instantly.
- Separate B2B lane (Enterprise + API) rather than mixing business and consumer flows.
- Prohibited list is public, detailed and unambiguous — reduces support load.

### 1.5 What Porter does that we must not imitate

- On-demand model implies continuous supply monitoring; not our model.
- Its driver-partner framing is a professional-carrier relationship, legally different from our peer
  traveller model. Copying its language ("driver partner") would misclassify our travellers.

---

## 2. Kootr (https://www.kootr.com/)

### 2.1 Observed landing structure (E-05)

```
Nav: Find a Match | Senders & Travelers | How Kootr Works | Download Kootr | Thoughts and Ideas | FAQs
Hero: "India's 1st social networking app for inter-city deliveries"
      "Kootr helps everyone send, receive and deliver items through verified air travelers."
Pillars: Social · Efficient · Transparent
         Send Items · Find verified travelers
         Travel & Earn · Offset your flight costs
         Eco-Friendly · Reduce carbon footprint
         Secure · PIN-verified handover
Footer: Kootr Ventures (OPC) Private Limited · 62 Patrakar Colony, Saket, Indore, MP 452018
        founder@kootr.com · +91 98991 53479
```

### 2.2 Observed journey (public, unauthenticated)

| Step | Publicly reachable | Observation |
|---|---|---|
| 1. Landing | Yes | OBSERVED |
| 2. "Find a Match" | Page exists | Link observed; **not exercised** (would require inputs/account) |
| 3. How it works | Section anchors | OBSERVED (headings only, detail client-rendered) |
| 4. Download | App Store + Play Store links | OBSERVED |
| 5. FAQs | Page with 6 categories | OBSERVED, but **answers render client-side** |
| 6. Terms / Privacy | Links exist | Not read in this pass |

FAQ category headings observed (E-06): General, Traveler, Sender, Recipient, Pricing and Earnings,
Disclaimer. Sub-questions observed include: mission, differentiation from couriers, safety of sending
via a traveller, **international parcel by flight**, how travellers earn, what can be sent, speed,
city availability, **handover/delivery responsibilities**, **4-digit PIN points**, **zero tolerance and
reporting violations**.

### 2.3 What this tells us (INFERRED)

- Kootr has thought about the same trust primitives we have: verified travellers, PIN handover,
  explicit responsibility allocation, zero-tolerance policy.
- Their model is **air**; ours is **road**. Air introduces airline baggage/cargo rules and, for
  international, customs — a materially different legal surface.
- Their "social networking" framing suggests they believe trust is social-graph-mediated. That is a
  genuinely different hypothesis from our identity-verification-mediated trust. **Worth testing.**

### 2.4 What remains unknown about Kootr

Pricing, fees, insurance, prohibited list, verification method, dispute outcomes, city coverage,
actual usage. All `UNKNOWN` — not to be asserted anywhere.

---

## 3. Cross-cutting UX observations

| Pattern | Porter | Kootr | Implication for Parcel Yatra |
|---|---|---|---|
| Capacity stated in kg up-front | Yes | No | State limits before signup |
| Trust badge language | "verified" | "verified travelers" | Badges must be backed by a real check |
| Handover proof | Not public | PIN | OTP + photo is our equivalent, stronger evidence |
| Prohibited list public | Yes, very detailed | Not public | Publish ours; it reduces risk and support load |
| Price visible pre-signup | No | No | **Opportunity:** show an indicative range without login |
| Accessibility text present | Yes (alt/roles) | Partial | Both are usable but not exemplary; we target WCAG 2.2 AA |

## 4. Method limitations

- One page load per site; no JS bundle analysis; no mobile app analysis.
- Client-rendered content (Kootr accordions, dynamic pricing) is out of reach without interaction, which
  we did not perform on third-party sites beyond passive rendering.
- Conclusions about business model are from marketing copy, i.e. **claims**, not verified operations.
