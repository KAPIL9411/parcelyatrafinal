# ADR-NNN: <Short decision title>

**Status:** Proposed | Accepted | Superseded by ADR-NNN | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** <names/roles>
**Supersedes:** <ADR-NNN or none>

---

## 1. Context

What is true today that forces a decision? Include constraints, not preferences:

- the constraint (legal, operational, technical, budget)
- what happens if we do nothing
- what we do *not* know yet

Keep this section free of the answer. If the context reads like a justification for a decision already
made, it is not a context section.

## 2. Decision

One sentence, active voice:

> We will <do X> because <reason>, accepting <cost>.

Then the specifics: what changes, what is explicitly out of scope, what is deferred.

## 3. Options considered

| Option | Pros | Cons | Rejected because |
|---|---|---|---|
| A | | | |
| B | | | |
| C (chosen) | | | — |

At least two real options. A table with one option is a memo, not a decision record.

## 4. Consequences

### Positive
-

### Negative (accepted)
-

### Neutral / follow-up work
-

## 5. Reversal cost

How expensive is it to undo this in six months?

| Aspect | Cost |
|---|---|
| Data migration | |
| Code changes | |
| Operational | |
| Contractual/legal | |

If the answer is "very expensive", say so plainly — that is the most useful line in the document.

## 6. Revisit trigger

The specific, measurable condition under which this decision should be reopened:

> Revisit when <metric> exceeds <threshold>, or when <event> happens.

Not "revisit periodically". That never happens.

## 7. Evidence and links

- Related ADRs:
- Requirements:
- Tests:
- External sources (with access date and what was actually observed):

## 8. Honesty check

Answer these before marking Accepted:

- [ ] Does this decision depend on an unverified legal position? (If yes, name it.)
- [ ] Does it assume traffic or demand we have not measured?
- [ ] Have we written down what we are *not* building because of this?
- [ ] Would a new engineer understand *why* from this document alone, in a year?
