# Pilot Participant Tracker — Template

**Status:** Template · **Handling:** contains personal data — store per `legal/PRIVACY_DATA_PROTECTION.md`
Do not commit a filled-in copy of this file to the repository.

---

## 1. Why this template exists

The pilot's supply side is operated by hand. Without a tracker, "we have 10 travellers" becomes a
feeling rather than a fact, and verification status gets confused with enthusiasm.

**Minimum necessary data only.** No Aadhaar numbers, no document images, no addresses, no bank details
in this sheet. Those live in the system, behind access control, with an audit trail.

## 2. Traveller tracker

| # | Name (first only) | Phone (last 4) | ID type | Verify state | Verified by | Verified on | Trips pledged | Trips published | Parcels carried | Incidents | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | pending / verified / rejected | | | | | | | |
| 2 | | | | | | | | | | | |

**Columns that matter most**

| Column | Why |
|---|---|
| `Verify state` | Only `verified` travellers may be offered parcels |
| `Verified by` | Accountability; a human made the call |
| `Trips pledged` vs `Trips published` | The gap is the real supply problem |
| `Incidents` | Any non-zero value requires a review before the next parcel |

### Ready-to-launch gate

- [ ] ≥ 10 travellers at `verified`
- [ ] Each has ≥ 2 trips pledged within the pilot window
- [ ] Each has had the 5-minute prohibited-items conversation (initial + date)
- [ ] Each can be reached on the phone within 15 minutes during their trip

## 3. Sender tracker

| # | Name (first only) | Phone (last 4) | Corridor | Parcel category | Posted | Matched | Delivered | Support contacts | Repeat intent | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | yes / no / unknown | |

**Do not** record the parcel contents in detail. The category is enough, and the description is already
in the system.

## 4. Verification conversation script (traveller)

Run this on a call, before marking `verified`. Record the date and that it happened.

```
1. "You'll be carrying documents for people you don't know. How do you feel about that?"
2. "Here is the list of things we never carry: cash, jewellery, medicines,
    electronics, passports. What would you do if someone handed you a sealed
    envelope and told you it was something else?"
3. "You can refuse any parcel at pickup with no penalty. Would you actually do that?"
4. "The sender gets a code. You enter it only after the parcel is in your hand.
    Why do you think that rule exists?"
5. "If you can't deliver because the receiver isn't answering, what will you do?"
6. "Who do you call if something goes wrong?"
```

The answers matter less than whether they understand the rules. Someone who says "I'd just open it to
check" is not ready.

## 5. Incident log (pilot)

| # | Date | Booking | Type | Severity | First action | Resolution | Payout state | Postmortem | Open? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | lost / damaged / late / prohibited / safety / other | | | | | yes / no | yes / no |

**Rule:** any `prohibited` or `safety` row with `Open? = yes` pauses the pilot.

## 6. Weekly review sheet

```
Week of: __________

Posted:              ___
Matched:             ___
Delivered:           ___
Support contacts:    ___
Incidents:           ___

Blocked parcels (why): ____________________________________

Top 3 confusions reported:
  1. ______________________
  2. ______________________
  3. ______________________

One thing we will fix this week: __________________________
Owner: __________

New travellers verified: ___
New travellers pledged:  ___
Supply gap:              ___
```

## 7. Data handling rules

| Rule | Reason |
|---|---|
| First names and last-4 phone digits only | Enough to identify internally, not enough to leak harmfully |
| No ID numbers, no document images | They live in the system with access control and audit |
| No bank details | Payout onboarding happens in a separate, controlled process |
| Sheet access limited to the pilot team | Minimum necessary |
| Delete or anonymise 90 days after the pilot ends | Retention limit |
| Never send this sheet over an unsecured channel | Obvious, frequently violated |

## 8. What not to do with this tracker

- Do not use it as a marketing list.
- Do not merge it with analytics identifiers to build profiles.
- Do not share it with a potential investor without consent and aggregation.
- Do not keep it "just in case" after the pilot concludes.

## 9. Retention

| Data | Retention | Then |
|---|---|---|
| Active pilot participants | Until pilot end | — |
| Post-pilot contact records | 90 days | Delete |
| Incident records | Per `security/DATA_RETENTION_MATRIX.md` | Retain for legal defence, restricted access |
| Verification records | In system, per retention matrix | — |
