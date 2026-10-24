# Post-Incident Review: <INC-NNN — one-line summary>

**Severity:** SEV-1 | SEV-2 | SEV-3 | SEV-4
**Date of incident:** YYYY-MM-DD
**Date of review:** YYYY-MM-DD
**Author:** <name>
**Attendees:** <names>
**Status:** Draft | Reviewed | Actions closed

> Blameless but not vague. "Human error" is not a root cause; it is where the investigation starts.
> A person did something because the system made it easy, possible, or invisible.

---

## 1. Summary

Three sentences a non-engineer can understand:

1. What happened.
2. Who was affected and how.
3. What we have done so far.

## 2. Impact

| Dimension | Number | Notes |
|---|---|---|
| Users affected | | |
| Bookings affected | | |
| Money affected (₹) | | sandbox / real (state which) |
| Personal data exposed | yes / no / unknown | if yes: which categories, how many records |
| Duration of user-facing impact | | from first impact to resolution |
| Duration of internal detection lag | | from first impact to someone noticing |

**If personal data was exposed:** stop and follow `security/INCIDENT_RESPONSE_PLAN.md` before finishing
this document. The legal clock may already be running.

## 3. Timeline (IST)

| Time | Event | Source |
|---|---|---|
| | First anomalous signal (may predate detection) | |
| | Someone noticed | |
| | Incident declared | |
| | First mitigation attempt | |
| | Capability disabled / rollback started | |
| | Service restored | |
| | Fully verified | |

Note explicitly:
- How long between **first impact** and **detection**?
- How long between **detection** and **mitigation**?
- Was either of those longer than it should have been? Why?

## 4. What happened (technical narrative)

A factual account. No blame, no adjectives.

```
What the system was doing:
What changed:
What failed:
What the failure looked like from outside:
What the failure looked like from inside (logs, metrics):
```

## 5. Root cause

Use the five-whys, but stop when you reach a condition you can actually change:

1. Why did the user see an error? → …
2. Why did that happen? → …
3. Why was that possible? → …
4. Why was it not caught? → …
5. Why did the safeguard not exist? → …

**Root cause statement:** <one sentence naming a changeable condition>

## 6. Contributing factors

| Factor | Category | Contributed how |
|---|---|---|
| | process / code / config / monitoring / documentation / staffing | |

Contributing factors are not excuses. A deploy process with no canary is a real finding.

## 7. What made it worse

| Item | Detail |
|---|---|
| Detection lag | |
| Rollback difficulty | |
| Missing observability | |
| Unclear ownership | |
| Documentation gap | |

## 8. What went well

Say this honestly — it tells you what to protect.

-

## 9. Which check in the pack should have caught this?

| Check | Why it did not |
|---|---|
| `testing/TEST_CASES.md` | |
| `testing/SECURITY_TEST_CASES.md` | |
| `release/RELEASE_CHECKLIST.md` | |
| `security/INCIDENT_RESPONSE_PLAN.md` | |

If the answer is "no check covers this", that is a gap in the pack — add the check as an action.

## 10. Actions

| # | Action | Type | Owner | Due | Status |
|---|---|---|---|---|---|
| 1 | | prevent / detect / mitigate | | | |
| 2 | | | | | |
| 3 | | | | | |

Rules:
- Every action has **one** owner, not a team.
- Every action has a date.
- Prevention actions outrank detection actions only if the root cause is well understood — usually, add
  the detector first.
- No action is "be more careful".

## 11. Customer communication (if any was sent)

Paste the actual message. Assess:
- Was it accurate at the time it was sent?
- Did it speculate about cause?
- Did it tell the user what to do?
- Did it promise a timeline we then missed?

## 12. Money reconciliation (if money was involved)

| Step | Result |
|---|---|
| Payments frozen? | |
| Provider report pulled? | |
| Ledger compared? | |
| Orphan entries | |
| Phantom entries | |
| Amount mismatches | |
| Corrections made (with approval) | |
| Unexplained breaks remaining | must be 0 before payout re-enable |

## 13. Recurrence risk

> If we do nothing else, how likely is this to happen again in the next 90 days?

Low / Medium / High — and why.

## 14. Sign-off

| Role | Name | Date |
|---|---|---|
| Incident owner | | |
| Engineering lead | | |
| Founder (SEV-1/2) | | |

Actions closed: ____ / ____
Review closed: YYYY-MM-DD
