# Privacy Notice — DRAFT

> ⚠️ **DRAFT — NOT LEGAL ADVICE. NOT FOR PUBLICATION.**
> Must be reviewed by an Indian privacy lawyer and issued in **English and Hindi** before launch.
> This draft is written to DPDP-Act-2023 structure; **do not describe it as "DPDP compliant"** — the
> substantive obligations commence on a phased schedule (see `legal/PRIVACY_DATA_PROTECTION.md` §1).

**Version:** 0.1-draft · **Date:** 2026-10-24

---

## 1. Who is responsible for your data

**[ENTITY NAME]** ("Parcel Yatra") is the data fiduciary for the personal data described here.
Contact: **[EMAIL]** · Grievance/Data Protection contact: **[NAME, EMAIL, PHONE, ADDRESS]**

## 2. What we collect and why

| What | Why we need it | Required? |
|---|---|---|
| Mobile number | Create your account, send OTP, coordinate your booking | Yes |
| Name | Identify you to your counterparty and for verification | Yes |
| Email | Receipts and important notices | No |
| Government ID + selfie (travellers only) | Verify identity before carrying parcels | Yes, for travellers |
| Pickup and drop area | Match you with a compatible trip | Yes |
| Handover address | So the parcel can actually be collected/delivered | Yes (shared only with your matched counterparty) |
| Receiver name and phone | So delivery can happen | Yes (shared with the traveller only after booking) |
| Parcel description, photo, weight, value | Safety screening and evidence | Yes |
| Payment references | Process payment and refunds | Yes |
| Device and network data | Security and fraud prevention | Yes |
| Messages you send in-app | Coordination and safety | Optional |
| Ratings | Trust and safety | Optional |

We do **not** collect Aadhaar by default, do not track your continuous location, and do not store scans
of the documents inside your parcel.

## 3. Who we share it with

| Recipient | What | Why |
|---|---|---|
| Your matched sender/traveller | Name, masked phone, area, booking details | To complete the booking |
| Receiver | Traveller's first name, rough arrival window | To receive the parcel |
| Payment provider | Payment identifiers | To move money |
| SMS/WhatsApp/email/push providers | Contact details and message content | To deliver notifications |
| KYC vendor | ID image, selfie | To verify identity |
| Cloud hosting (India region) | All data | To run the service |
| Law enforcement | As required by law | Legal obligation |

We do **not** sell your personal data.

## 4. How long we keep it

| Data | Retention |
|---|---|
| Account and profile | While your account exists + 90 days |
| ID images | 90 days after verification decision, then deleted |
| Handover address | 30 days after delivery |
| Receiver details | 30 days after delivery, then masked |
| Parcel photos | 180 days |
| Payment records | As required by tax and accounting law |
| Booking history | 3 years |
| Security logs | 90 days – 1 year |
| Audit logs | 1 year minimum |

Full schedule: `security/DATA_RETENTION_MATRIX.md`.

## 5. Your choices and rights

- **Access** — download a copy of your data from Settings → Privacy.
- **Correct** — edit your profile; contact us for verified fields.
- **Delete** — delete your account; we erase what we can and explain what we must keep.
- **Withdraw consent** — for optional processing (e.g. marketing), any time.
- **Complain** — to our Grievance Officer, and to the **Data Protection Board of India** where applicable.

We aim to respond within **30 days**, and to acknowledge within **48 hours**.

## 6. Consent

We ask for your consent before collecting data for the purposes above. Consent is:
- specific to each purpose,
- separate for marketing,
- withdrawable as easily as it was given,
- recorded with a timestamp and policy version.

Withdrawing consent may mean we can no longer provide the service (for example, we cannot deliver a parcel
without an address).

## 7. Security

We use encryption in transit, encryption at rest, role-based access, multi-factor authentication for staff,
audit logging, and restricted access to identity documents. No system is perfectly secure; if a breach
affects you, we will notify you and the Data Protection Board as required.

## 8. Children

The service is for users **18 and over**. We do not knowingly collect data from children. If we learn we
have, we will delete the account.

## 9. Marketing

We send service messages (OTP, booking updates) as part of the service. Marketing messages require separate
consent and can be turned off without affecting your bookings.

## 10. Changes

We will notify you of material changes and, where required, ask for fresh consent.

## 11. Contact and grievances

Grievance Officer: **[NAME]** · **[EMAIL]** · **[PHONE]** · **[ADDRESS]**
Response: acknowledgement within 48 hours; resolution within 30 days.

---

### Notice design requirements (implementation)

- [ ] Presented **before** the first data collection, not buried in signup.
- [ ] Layered: short summary + full notice.
- [ ] Itemised purposes with separate toggles where consent is the basis.
- [ ] Available in English **and** Hindi at launch.
- [ ] Versioned; acceptance stored with timestamp.
- [ ] Reachable from every screen footer.
- [ ] Accessible (WCAG 2.2 AA), plain language, no dark patterns.
- [ ] Includes the "what we must keep even if you delete" explanation.
