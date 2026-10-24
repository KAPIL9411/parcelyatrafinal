# Data Flow Diagrams

**Status:** Draft v0.1 · **Date:** 2026-10-24

---

## 1. Sender → booking (happy path)

```mermaid
sequenceDiagram
    participant S as Sender
    participant API as API
    participant M as Matching
    participant P as Pricing
    participant DB as DB
    S->>API: create parcel (category, weight, value, window)
    API->>API: eligibility checks (E1–E10)
    API->>P: quote request
    P->>DB: store immutable quote (15 min)
    P-->>API: price breakdown
    API-->>S: parcel + quote
    S->>API: GET /parcels/{id}/matches
    API->>M: candidates (hard filters)
    M-->>API: ranked trips + reasons (no PII)
    API-->>S: matches
    S->>API: POST /bookings (trip, quote, Idempotency-Key)
    API->>DB: tx: lock trip, reserve capacity, insert booking + event + outbox
    API-->>S: booking PENDING
    API->>API: notify traveller
```

## 2. Handover and delivery

```mermaid
sequenceDiagram
    participant S as Sender
    participant T as Traveller
    participant API as API
    participant DB as DB
    participant R as Receiver
    Note over API: CONFIRMED → PICKUP_READY (window opens)
    API->>S: pickup OTP (SMS)
    S->>T: shares OTP verbally/visually at handover
    T->>API: confirm pickup {otp, photo}
    API->>DB: verify hash, consume, store evidence, transition PICKED_UP
    T->>API: start transit
    API->>R: "parcel on the way" (no traveller PII)
    T->>API: arrived
    API->>R: delivery OTP (SMS)
    R->>T: shares OTP
    T->>API: confirm delivery {otp, photo}
    API->>DB: consume, transition DELIVERED, start dispute window
```

## 3. Money flow (sandbox until gates)

```mermaid
flowchart LR
    S[Sender] -->|pays| PP[Payment provider]
    PP -->|webhook authorised| API[API]
    API -->|ledger entry| L[(payment_ledger)]
    API -->|booking CONFIRMED| B[(bookings)]
    B -->|DELIVERED + window elapsed| E{Payout eligible?}
    E -->|dispute open| F[FROZEN]
    E -->|clear| P[Release instruction]
    P --> PP
    PP -->|payout| T[Traveller]
    PP -->|webhook payout.succeeded| API
    API --> L
```

**Critical:** Parcel Yatra never appears as the holder of funds in this diagram.

## 4. Verification data flow

```mermaid
flowchart TB
    T[Traveller] -->|ID image + selfie| UP[Upload endpoint]
    UP -->|magic-byte check, EXIF strip, re-encode| OBJ[(Private bucket)]
    OBJ -->|record| DB[(verifications PENDING)]
    DB --> Q[Review queue]
    Q --> R{Reviewer}
    R -->|approve/reject + reason| DB2[(decision + audit)]
    OBJ -.->|short-lived signed URL| R
    R -.->|view logged| AUD[(audit_log)]
```

## 5. Notification fan-out

```mermaid
flowchart LR
    E[Domain event] --> OB[Outbox]
    OB --> W[Worker]
    W --> T{Template + locale}
    T --> SMS[SMS]
    T --> WA[WhatsApp]
    T --> PUSH[Push]
    T --> EM[Email]
    W -->|status| DB[(notification_log - no PII in body copy stored encrypted)]
```

## 6. Data subject request flow

```mermaid
sequenceDiagram
    participant U as User
    participant API as API
    participant DB as DB
    participant S3 as Object storage
    U->>API: request export / deletion
    API->>DB: create DSR record (type, scope, due date)
    API->>DB: assemble export / mark deleted
    API->>S3: delete or revoke objects
    API-->>U: confirmation + what was retained and why
    Note over API,DB: 30-day hard delete job, then backup rotation
```

## 7. Where PII goes (and does not)

| Flow | PII present | Control |
|---|---|---|
| Matching results | Area, first name, rating band | No phone/address |
| Booking confirmation | Full name, masked phone | Post-match only |
| Handover | OTP (hashed at rest) | Never logged |
| Delivery | Receiver phone | Deleted/masked after 30 d |
| Notifications | Phone, first name | Templates reviewed, no item details |
| Analytics | Pseudonymous user id | No PII |
| Error tracking | Scrubbed | Denylist enforced |
