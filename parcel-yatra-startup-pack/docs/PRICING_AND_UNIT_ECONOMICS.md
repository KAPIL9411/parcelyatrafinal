# Pricing & Unit Economics

**Status:** Draft v0.1 — **all figures are HYPOTHESES, not measured data.**
No number in this document should be presented to a customer, investor or regulator as validated.

---

## 1. Pricing goals

1. **Explainable.** A sender can see exactly why the price is what it is.
2. **Bounded.** Floors and caps prevent both predatory cheapness and gouging.
3. **Traveller-fair.** The traveller's share is visible to the traveller before accepting.
4. **Auditable.** Every quote is stored immutably with its inputs and formula version.
5. **Honest.** If no eligible trip exists, there is no price.

## 2. Price components

```
subtotal        = base_fare + distance_component + weight_component + handling_component
platform_fee    = clamp(subtotal × commission_rate, min_fee, max_fee)
taxable         = subtotal + platform_fee
taxes           = taxable × gst_rate            (treatment subject to tax advice)
total           = taxable + taxes
traveller_share = subtotal − service_component
```

| Component | Formula | Pilot default |
|---|---|---|
| `base_fare` | fixed | ₹60 |
| `distance_component` | ₹2.20 × corridor_km | Bareilly–Delhi ≈ 250 km → ₹550 |
| `weight_component` | ₹18 × max(0, kg − 1) | 3 kg → ₹36 |
| `handling_component` | category multiplier | documents 1.0×, fragile 1.4× |
| `service_component` | ₹25 fixed ops allocation | ₹25 |
| `commission_rate` | platform take on subtotal | 18% |
| `min_fee` / `max_fee` | commission clamps | ₹39 / ₹199 |
| `gst_rate` | as advised | 18% (subject to confirmation) |

**Worked example (HYPOTHESIS):** Bareilly→Delhi, 3 kg, documents.
`subtotal = 60 + 550 + 36 + 0 = ₹646`; `platform_fee = 18% = ₹116`; `taxable = ₹762`;
`taxes ≈ ₹137`; `total ≈ ₹899`; `traveller_share ≈ ₹621`.

> ⚠️ That traveller share is almost certainly **too high** to be competitive with a bus parcel
> (₹150–₹300, UNVERIFIED). It illustrates why pricing must be corridor-calibrated, not formula-fixed.
> Revision path: lower `distance_component` for dense corridors, or price per corridor from observed
> willingness to pay.

## 3. Hard bounds

| Bound | Rule |
|---|---|
| Min total | ₹99 |
| Max total | ₹2,500 (pilot cap) |
| Max traveller share | 80% of subtotal |
| Min traveller share | ₹80 |
| Quote validity | 15 min |
| Price change after quote | Only with explicit re-consent |
| Surge | Allowed only as a documented multiplier ≤ 1.5×, shown as a named line item. **Never** applied silently. |

## 4. What we will NOT do

- No price shown for an unmatched parcel.
- No "estimated" price that becomes different at checkout without consent.
- No hidden traveller-side deduction.
- No cross-subsidy pricing that makes the pilot look profitable.

## 5. Unit economics — three scenarios

Assumptions (HYPOTHESIS): corridor 250 km, average parcel 2.5 kg, average declared value ₹2,000,
payment provider fee 2.0% + 18% GST on fee, verification cost amortised over 20 bookings,
support cost ₹12/booking at pilot volumes, claims reserve 3% of GMV.

| Line | Lean (₹) | Base (₹) | Dense (₹) |
|---|---|---|---|
| Sender pays (total) | 399 | 549 | 749 |
| − Taxes (18%) | 61 | 84 | 114 |
| Net revenue | 338 | 465 | 635 |
| − Traveller compensation | 220 | 300 | 420 |
| **Gross margin** | **118** | **165** | **215** |
| − Payment fee (2% + GST) | 8 | 11 | 15 |
| − Verification amortised | 12 | 12 | 12 |
| − Support per booking | 18 | 12 | 8 |
| − Claims reserve (3%) | 12 | 16 | 22 |
| **Contribution margin** | **68** | **114** | **158** |
| Contribution % of net revenue | 20% | 25% | 25% |
| Break-even bookings/month (fixed ₹1.5L) | 2,206 | 1,316 | 949 |

**Interpretation:** the model only works at **hundreds of bookings per month on one corridor**, which
the pilot will almost certainly not reach. Therefore:
- The pilot is **not** expected to be profitable; it is expected to produce *evidence*.
- Break-even must be reached by **route density**, not by raising commission (which pushes senders
  back to bus parcel).

## 6. Cost drivers to measure during pilot

| Driver | How measured | Target |
|---|---|---|
| Traveller acquisition cost | spend / verified active travellers | < ₹150 |
| Sender acquisition cost | spend / first booking | < ₹120 |
| Support minutes per booking | ticket time logs | < 6 min |
| Verification cost per traveller | vendor invoice | < ₹40 |
| Claims ratio | claims paid / GMV | < 3% |
| Payment cost | provider invoice | < 2.2% |
| Failed-match cost | abandoned searches / searches | < 25% |

## 7. Sensitivity

| Change | Effect on contribution (Base) |
|---|---|
| Traveller compensation +₹50 | −₹50 (30% of margin) |
| Commission 18% → 12% | −₹33 |
| Claims ratio 3% → 10% | −₹37 |
| Support 12 → 30 min | −₹22 |
| Average parcel 2.5 → 1 kg | −₹27 (weight component) |

The business is **most sensitive to traveller compensation and claims**, not to commission. That is
the core economic risk.

## 8. Compliance notes on pricing

- Prices must show **inclusive of taxes** with the tax amount displayed separately.
- A "platform fee" is revenue to Parcel Yatra; GST treatment of the marketplace facilitation service
  versus the transport service must be confirmed by a tax professional
  (`legal/PAYMENTS_TAX_AND_SETTLEMENT.md`).
- No surcharge may be described as "insurance" unless cover actually exists.

## 9. Open questions

1. Should the traveller set the price (bid) or accept a quote? Affects supply elasticity and abuse.
2. Is a per-kg or per-corridor price more understandable to Tier-2 users?
3. Do business senders accept prepaid-only, or do they expect monthly invoicing? (Invoicing changes
   payment-provider and GST mechanics.)
4. What is the actual bus-parcel price on Bareilly→Delhi? **Must be measured in person, not guessed.**
