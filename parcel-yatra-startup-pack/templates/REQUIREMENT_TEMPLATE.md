# Requirement: <FR-NNN — short name>

**Status:** Draft | Review | Approved | Implemented | Dropped
**Owner:** <name>
**Phase:** 0 | 1 | 2 | 3 | 4 | 5
**Source:** user story / legal gate / incident / decision

---

## 1. Requirement

> The system shall <observable behaviour> so that <user or business outcome>.

One sentence, testable. If it contains "and", it is probably two requirements.

## 2. Why now

- What breaks if this is not built?
- Which phase gate or user journey depends on it?
- What is the cost of deferring one phase?

If the answer is "it would be nice", the priority is P2 at best.

## 3. Acceptance criteria

Written as observable facts, each independently testable.

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | | | |
| AC-2 | | | |
| AC-3 | | | |

Include the unhappy paths explicitly:

| # | Given | When | Then |
|---|---|---|---|
| AC-4 | a request without `Idempotency-Key` | the booking endpoint is called | `400 IDEMPOTENCY_KEY_REQUIRED` |
| AC-5 | a non-party caller | a booking is requested by id | `404`, not `403` |

## 4. States to handle

Every requirement that touches a screen or a resource must enumerate:

- [ ] Loading
- [ ] Empty (first use)
- [ ] Empty (no results after filtering)
- [ ] Recoverable error
- [ ] Unrecoverable error
- [ ] Offline
- [ ] Pending verification / pending approval
- [ ] Rejected / blocked (with reason and appeal path)
- [ ] Success / terminal

A requirement that lists only the success path is incomplete, not simple.

## 5. Data and privacy

| Question | Answer |
|---|---|
| What personal data is collected? | |
| Is any of it sensitive? (Aadhaar, health, financial) | |
| Retention period and why | |
| Who can see it | |
| Is it exported, logged, or sent to a third party? | |
| Consent basis | |

**Rule:** if the answer to "is any of it sensitive" is yes, stop — this pack's default is not to store
it (`legal/PRIVACY_DATA_PROTECTION.md`).

## 6. Money

| Question | Answer |
|---|---|
| Does this touch money? | yes / no |
| If yes: who computes the amount? | server only |
| Integer paise? | yes / no |
| Does it need idempotency? | |
| Does it need an audit entry? | |
| Does it need dual approval? | (> ₹1,000) |

Any requirement that lets a client influence an amount is rejected at review.

## 7. Test mapping

| Test ID | Covers |
|---|---|
| TC-XXX-01 | AC-1 |
| TC-XXX-02 | AC-2 |

An approved requirement with no test ID is not approved; it is a wish.

## 8. Non-goals

Explicitly out of scope for this requirement:

-
-

## 9. Dependencies and risks

| Type | Item |
|---|---|
| Depends on | |
| Blocks | |
| Legal gate | |
| Risk | |

## 10. Review

| Role | Name | Date | Verdict |
|---|---|---|---|
| Product | | | |
| Engineering | | | |
| Legal (if applicable) | | | |

## 11. Definition of done

- [ ] Code + tests merged
- [ ] Contract assertion added if it changes the API
- [ ] Audit/telemetry added if it changes money or identity
- [ ] Hindi string added
- [ ] All nine states implemented
- [ ] Runbook updated if it adds an alert
- [ ] Requirement status set to Implemented
