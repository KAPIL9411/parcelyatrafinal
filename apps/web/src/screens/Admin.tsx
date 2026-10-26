import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { DISPUTE_CATEGORY_LABELS, type DisputeCategory } from '@py/domain';

import {
  api,
  ApiError,
  type AdminBookingRow,
  type AdminDispute,
  type AdminIncident,
  type AdminThreadMessage,
  type AdminVerification,
  type AuditEntry,
  type VerificationDocumentBundle,
} from '../lib/api';
import { errorCopy, verificationReason } from '../lib/copy';
import { formatDate, formatDateTime, inr, shortId, timeAgo } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  LoadingBlock,
  SectionHeading,
  Select,
  Sheet,
  Skeleton,
  SuccessPanel,
  TextInput,
  cn,
} from '../components/ui';
import { StatusChip, VerificationChip } from '../components/StatusChip';
import { ShieldCheckIcon, AlertTriangleIcon, SearchIcon, DocIcon, LockIcon } from '../components/icons';

type Tab = 'verifications' | 'bookings' | 'disputes' | 'incidents' | 'audit';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'verifications', label: 'Verification queue' },
  { value: 'bookings', label: 'Bookings' },
  { value: 'disputes', label: 'Cases' },
  { value: 'incidents', label: 'Incidents' },
  { value: 'audit', label: 'Audit log' },
];

export function Admin() {
  useDocumentTitle('Operations');
  const [tab, setTab] = useState<Tab>('verifications');

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Operations</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900 sm:text-2xl">Staff console</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every read and write here is written to the audit log with your account id.
        </p>
      </div>

      <div className="-mt-2 flex flex-wrap gap-6 border-b border-line" role="tablist" aria-label="Operations sections">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            onClick={() => setTab(option.value)}
            className={cn(
              '-mb-px border-b-2 px-1 py-2.5 text-sm font-medium transition-colors',
              tab === option.value
                ? 'border-brand-600 text-ink-900'
                : 'border-transparent text-ink-500 hover:text-ink-900',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === 'verifications' ? <VerificationQueue /> : null}
      {tab === 'bookings' ? <BookingSearch /> : null}
      {tab === 'disputes' ? <DisputeQueue /> : null}
      {tab === 'incidents' ? <IncidentQueue /> : null}
      {tab === 'audit' ? <AuditLog /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------- verification queue

const DECISION_REASONS = [
  { value: 'id_clear', label: 'ID is clear and matches' },
  { value: 'id_unreadable', label: 'ID photo unreadable' },
  { value: 'id_expired', label: 'ID has expired' },
  { value: 'id_mismatch', label: 'Name does not match the account' },
  { value: 'selfie_mismatch', label: 'Selfie does not match the ID' },
  { value: 'suspected_forgery', label: 'Document looks altered' },
  { value: 'incomplete_document', label: 'Part of the document is missing' },
];

function VerificationQueue() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<AdminVerification | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject' | 'request_more'>('approve');
  const [reason, setReason] = useState('id_clear');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'verifications'],
    queryFn: () => api.get<{ items: AdminVerification[] }>('/admin/verifications?state=pending&limit=100'),
  });

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/verifications/${selected.id}/decision`, {
        decision,
        reason_code: reason,
      });
      setDone(
        decision === 'approve'
          ? 'Approved. The traveller can publish a trip now.'
          : decision === 'reject'
            ? 'Rejected. The traveller sees the reason and can try again.'
            : 'More information requested. The record stays pending.',
      );
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'verifications'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Verification queue"
        description="Oldest first. Approving adds the traveller role; rejecting keeps the record for the next attempt."
      />

      {done ? <SuccessPanel title={done} /> : null}

      {query.isLoading ? (
        <Card>
          <p className="text-sm text-ink-500">Loading the queue…</p>
        </Card>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="There are no pending verifications. New submissions appear here automatically."
          icon={<ShieldCheckIcon size={22} />}
        />
      ) : (
        <div className="space-y-3">
          {query.data?.items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {item.id_type?.replaceAll('_', ' ') ?? 'ID document'}
                  </p>
                  <p className="tabular text-xs text-ink-500">
                    User {shortId(item.user_id)} · attempt {Math.min(3, item.attempts)} of 3 · submitted{' '}
                    {timeAgo(item.created_at)}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    The selfie and the document photos open in the decision sheet, one submission at a time.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <VerificationChip state={item.state} />
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelected(item);
                      setDecision('approve');
                      setReason('id_clear');
                      setDone(null);
                    }}
                  >
                    Decide
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          setError(null);
        }}
        title="Record a decision"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setSelected(null);
                setError(null);
              }}
            >
              Close
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              Save decision
            </Button>
          </>
        }
      >
        {selected ? <VerificationDocuments verificationId={selected.id} /> : null}

        <Banner tone="warn" title="Do not approve on a verbal assurance" icon>
          If the classification is uncertain, reject and escalate. The reason code is shown to the traveller.
        </Banner>

        <Field label="Decision" htmlFor="decision">
          <Select
            id="decision"
            value={decision}
            onChange={(event) => {
              const next = event.target.value as 'approve' | 'reject' | 'request_more';
              setDecision(next);
              setReason(next === 'approve' ? 'id_clear' : 'id_unreadable');
            }}
          >
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
            <option value="request_more">Ask for a better photo</option>
          </Select>
        </Field>

        <Field label="Reason code" htmlFor="reason" hint="This is the only explanation the traveller receives.">
          <Select id="reason" value={reason} onChange={(event) => setReason(event.target.value)}>
            {DECISION_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {reason && decision !== 'approve' ? (
          <p className="rounded-input bg-canvas px-3 py-2 text-sm text-ink-700">
            The traveller will read: “{verificationReason(reason)}”
          </p>
        ) : null}

        {error ? <ErrorPanel error={error} /> : null}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- the documents under review

type VerificationDocument = VerificationDocumentBundle['documents'][number];

/**
 * What a reviewer decides on.
 *
 * The photos are fetched when the sheet opens, not with the queue: each read is its own audited
 * event, and each URL it returns works for one file for a couple of minutes. So this query is never
 * kept fresh — reopening has to issue new links rather than reuse ones that already stopped working.
 */
function VerificationDocuments({ verificationId }: { verificationId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'verification-documents', verificationId],
    queryFn: () => api.get<VerificationDocumentBundle>(`/admin/verifications/${verificationId}/documents`),
    staleTime: 0,
    gcTime: 0,
  });
  const [zoomed, setZoomed] = useState<VerificationDocument | null>(null);

  if (query.isPending) return <LoadingBlock lines={4} />;
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;

  const { verification, applicant, documents } = query.data;

  return (
    <div className="space-y-3">
      <div className="rounded-input border border-line bg-canvas px-3 py-2">
        <p className="text-sm font-semibold text-ink-900">{applicant.name ?? 'No name on the account'}</p>
        <p className="tabular mt-0.5 text-xs text-ink-500">
          {applicant.phone_masked}
          {applicant.email ? ` · ${applicant.email}` : ''}
        </p>
        <p className="tabular mt-0.5 text-xs text-ink-500">
          {verification.id_type?.replaceAll('_', ' ') ?? 'identity document'} · attempt {verification.attempts} of 3 ·
          submitted {timeAgo(verification.created_at)} · account since {formatDate(applicant.member_since)}
          {applicant.fraud_flag ? ' · flagged for fraud' : ''}
        </p>
      </div>

      {documents.length === 0 ? (
        <Banner tone="warn" title="Nothing was stored with this submission" icon>
          The record exists but has no documents attached, so there is nothing to read. Reject it and ask the
          traveller to submit again.
        </Banner>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {documents.map((doc) => (
            <li key={doc.id}>
              <DocumentTile doc={doc} onZoom={() => setZoomed(doc)} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-500">
        These links open one file each and stop working in a few minutes — close and reopen the sheet for fresh
        ones. Every issue is written to the audit log against your account.
      </p>

      {zoomed ? <DocumentZoom doc={zoomed} onClose={() => setZoomed(null)} /> : null}
    </div>
  );
}

function DocumentTile({ doc, onZoom }: { doc: VerificationDocument; onZoom: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!doc.view_url) {
    // The submission promised the traveller their images would not be kept past this date.
    return (
      <Frame label={doc.label}>
        <p className="px-3 py-6 text-center text-xs text-ink-500">
          Past its retention date, so this console will not open it any more.
        </p>
      </Frame>
    );
  }

  return (
    <Frame label={doc.label}>
      <button type="button" onClick={onZoom} className="relative block h-44 w-full overflow-hidden">
        {loaded ? null : <Skeleton className="absolute inset-0 rounded-none" />}
        <img
          src={doc.view_url}
          alt={doc.label}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('h-full w-full bg-canvas object-contain transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
        />
      </button>
      {failed ? (
        <p className="px-3 py-2 text-center text-xs text-ink-500">
          The file is no longer in storage. Reject and ask the traveller to submit again.
        </p>
      ) : null}
    </Frame>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-input border border-line bg-surface">
      {children}
      <figcaption className="px-3 py-2 text-xs font-semibold text-ink-700">{label}</figcaption>
    </figure>
  );
}

/** Full-size reading of one document, rendered into `body` so the sheet's scroll box cannot clip it. */
function DocumentZoom({ doc, onClose }: { doc: VerificationDocument; onClose: () => void }) {
  const [actualSize, setActualSize] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-ink-900/95"
      role="dialog"
      aria-modal="true"
      aria-label={`${doc.label}, full size`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm font-semibold text-white">{doc.label}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setActualSize((on) => !on)}>
            {actualSize ? 'Fit to screen' : 'Actual size'}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <img
          src={doc.view_url!}
          alt={doc.label}
          onClick={() => setActualSize((on) => !on)}
          className={cn(
            'mx-auto rounded-input bg-surface',
            actualSize ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain',
          )}
        />
      </div>
      <p className="tabular px-4 pb-3 text-xs text-white/70">
        {Math.round(doc.byte_size / 1024)} KB · {doc.mime_type} · captured {timeAgo(doc.captured_at)} · SHA-256{' '}
        {doc.content_sha256.slice(0, 12)}…
      </p>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------- bookings

function BookingSearch() {
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [payoutTarget, setPayoutTarget] = useState<AdminBookingRow | null>(null);
  const [payoutError, setPayoutError] = useState<unknown>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'bookings', status, from],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (status) params.set('status', status);
      if (from) params.set('created_from', new Date(from).toISOString());
      return api.get<{ items: AdminBookingRow[] }>(`/admin/bookings?${params.toString()}`);
    },
  });

  async function releasePayout() {
    if (!payoutTarget) return;
    setPayoutBusy(true);
    setPayoutError(null);
    try {
      await api.post(`/admin/payouts/${payoutTarget.id}/release`, { reason_code: 'delivery_confirmed' });
    } catch (err) {
      setPayoutError(err);
    } finally {
      setPayoutBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeading title="Bookings" description="Search by state or creation date. Every search is audited." />

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status" htmlFor="status">
            <Select id="status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any status</option>
              {[
                'pending_traveller_acceptance',
                'payment_pending',
                'confirmed',
                'pickup_ready',
                'picked_up',
                'in_transit',
                'arrived',
                'delivered',
                'disputed',
                'payout_eligible',
                'paid_out',
                'refunded',
                'expired',
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Created on or after" htmlFor="from">
            <TextInput id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" fullWidth onClick={() => void query.refetch()}>
              <SearchIcon size={17} />
              Search
            </Button>
          </div>
        </div>
      </Card>

      {query.isLoading ? (
        <Card>
          <p className="text-sm text-ink-500">Searching…</p>
        </Card>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No bookings match" body="Change the filters and search again." icon={<DocIcon size={22} />} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs text-ink-500 uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Booking</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {query.data?.items.map((row) => (
                <tr key={row.id}>
                  <td className="tabular px-3 py-3 font-mono text-xs text-ink-900">{shortId(row.id)}</td>
                  <td className="px-3 py-3">
                    <StatusChip status={row.status} />
                  </td>
                  <td className="tabular px-3 py-3 text-right font-semibold text-ink-900">
                    {inr(row.agreed_total_paise)}
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-500">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Link to={`/bookings/${row.id}`} className="text-xs font-semibold text-brand-700 underline">
                        Open
                      </Link>
                      <button
                        type="button"
                        className="text-xs font-semibold text-ink-500 underline"
                        onClick={() => {
                          setPayoutTarget(row);
                          setPayoutError(null);
                        }}
                      >
                        Payout
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet
        open={Boolean(payoutTarget)}
        onClose={() => {
          setPayoutTarget(null);
          setPayoutError(null);
        }}
        title="Release the traveller payout"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPayoutTarget(null);
                setPayoutError(null);
              }}
            >
              Close
            </Button>
            <Button loading={payoutBusy} onClick={() => void releasePayout()}>
              Try to release
            </Button>
          </>
        }
      >
        <Banner tone="danger" title="Payouts are disabled at launch" icon>
          This button exists so the refusal is visible, not so money can move. The server answers
          PAYOUTS_NOT_ENABLED before any state changes.
        </Banner>
        <p className="flex gap-2 text-sm text-ink-700">
          <LockIcon size={17} className="mt-0.5 shrink-0" />
          Releasing money needs a contracted provider and written approval of the fund-flow model. Neither exists in
          this build.
        </p>
        {payoutError ? (
          <div className="rounded-card border border-warn-600/30 bg-warn-50 p-3 text-sm">
            <p className="font-semibold text-ink-900">{errorCopy(payoutError).title}</p>
            <p className="mt-1 text-ink-700">{errorCopy(payoutError).body}</p>
            {payoutError instanceof ApiError && payoutError.code === 'PAYOUTS_NOT_ENABLED' ? (
              <p className="mt-1 text-xs text-ink-500">Gate GATE-3 remains open. Nothing was changed.</p>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------- disputes

const OUTCOME_CODES = [
  'sender_favour',
  'traveller_favour',
  'insufficient_evidence',
  'goodwill',
  'no_fault',
];

function DisputeQueue() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<AdminDispute | null>(null);
  const [outcome, setOutcome] = useState<'sender' | 'traveller' | 'split'>('sender');
  const [code, setCode] = useState('sender_favour');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'disputes'],
    queryFn: () => api.get<{ items: AdminDispute[] }>('/admin/disputes?limit=100'),
  });

  async function resolve() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/disputes/${selected.id}/resolve`, {
        outcome,
        outcome_code: code,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setDone(true);
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'disputes'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Cases"
        description="Oldest first. Resolving moves the booking and unfreezes or voids the payout row."
      />

      {done ? <SuccessPanel title="Case resolved">The booking and payout row were updated.</SuccessPanel> : null}

      {query.isLoading ? (
        <Card>
          <p className="text-sm text-ink-500">Loading cases…</p>
        </Card>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No open cases" body="Nothing needs a decision." icon={<AlertTriangleIcon size={22} />} />
      ) : (
        <div className="space-y-3">
          {query.data?.items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-700">
                      {DISPUTE_CATEGORY_LABELS[item.category as DisputeCategory] ?? item.category}
                    </span>
                    <span className="text-xs font-semibold text-ink-500">{item.state.replaceAll('_', ' ')}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-ink-700">{item.description}</p>
                  <p className="tabular mt-1 text-xs text-ink-500">
                    Booking {shortId(item.booking_id)} · opened {timeAgo(item.created_at)}
                  </p>
                  {(item.evidence?.length ?? 0) > 0 ? (
                    <div className="mt-3 rounded-input border border-line bg-canvas px-3 py-2">
                      <p className="text-xs font-semibold text-ink-700">
                        {item.evidence!.length} item{item.evidence!.length === 1 ? '' : 's'} added after opening
                      </p>
                      <ul className="mt-1 space-y-1">
                        {item.evidence!.map((entry) => (
                          <li key={entry.id} className="text-xs text-ink-700">
                            <span className="font-semibold">
                              {entry.side === 'opener' ? 'Person who opened the case' : 'Other side'}:
                            </span>{' '}
                            {entry.note}
                            {entry.object_key ? ' (photo attached)' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/bookings/${item.booking_id}`} className="text-xs font-semibold text-brand-700 underline">
                    Open booking
                  </Link>
                  {item.state !== 'resolved' && item.state !== 'closed' ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelected(item);
                        setOutcome('sender');
                        setCode('sender_favour');
                        setNote('');
                        setDone(false);
                      }}
                    >
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          setError(null);
        }}
        title="Resolve this case"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setSelected(null);
                setError(null);
              }}
            >
              Close
            </Button>
            <Button loading={busy} onClick={() => void resolve()}>
              Record outcome
            </Button>
          </>
        }
      >
        <Banner tone="warn" title="A person must have reviewed the evidence" icon>
          This action moves money state. Only use it after reading the case and both sides' accounts.
        </Banner>

        <Field label="Outcome" htmlFor="outcome">
          <Select
            id="outcome"
            value={outcome}
            onChange={(event) => {
              const next = event.target.value as 'sender' | 'traveller' | 'split';
              setOutcome(next);
              setCode(next === 'traveller' ? 'traveller_favour' : next === 'sender' ? 'sender_favour' : 'split_settlement');
            }}
          >
            <option value="sender">Sender — the traveller is not paid</option>
            <option value="traveller">Traveller — the payout becomes eligible</option>
            <option value="split" disabled>
              Split — not available yet
            </option>
          </Select>
        </Field>
        <p className="text-xs text-ink-500">
          Split settlement needs a refund and settlement design we do not have. The server refuses it rather than
          guessing at an amount.
        </p>

        <Field label="Outcome code" htmlFor="code">
          <Select id="code" value={code} onChange={(event) => setCode(event.target.value)}>
            {OUTCOME_CODES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Internal note" htmlFor="note" optional hint="Visible in the audit log, not to either side.">
          <TextInput id="note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </Field>

        {error ? <ErrorPanel error={error} /> : null}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------- incidents

const INCIDENT_REASONS = [
  'parcel_handed_over',
  'delivered_late',
  'address_dispute_resolved',
  'traveller_confirmed_delivery',
  'parcel_lost_in_transit',
  'parcel_damaged',
  'traveller_no_show',
  'handover_failed',
];

const MESSAGE_REMOVAL_REASONS = [
  'contact_details_shared',
  'abusive_language',
  'off_platform_payment',
  'spam',
  'other_policy_breach',
];

function IncidentQueue() {
  const { user } = useSession();
  const [state, setState] = useState<'incident_open' | 'locked_for_review'>('incident_open');
  const [threadTarget, setThreadTarget] = useState<AdminIncident | null>(null);
  const [resolveTarget, setResolveTarget] = useState<AdminIncident | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);

  const roles = user?.roles ?? [];
  const canResolve = roles.includes('support_agent') || roles.includes('trust_safety');
  const canRemoveMessages = roles.includes('trust_safety');

  const query = useQuery({
    queryKey: ['admin', 'incidents', state],
    queryFn: () => api.get<{ items: AdminIncident[] }>(`/admin/incidents?state=${state}&limit=100`),
  });

  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Incidents"
        description="A booking held outside the normal flow: the parcel is not accounted for, so the payout is frozen until someone here decides."
      />

      {cleared ? <SuccessPanel title={cleared} /> : null}

      {!canResolve ? (
        <Banner tone="info" title="Read-only for your role">
          Your role can see the queue and the threads. Resolving an incident needs support or trust &amp; safety;
          removing a message needs trust &amp; safety. The server refuses either way — this console only tells you
          before you try.
        </Banner>
      ) : null}

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Held as" htmlFor="incident-state">
            <Select
              id="incident-state"
              value={state}
              onChange={(event) => setState(event.target.value as 'incident_open' | 'locked_for_review')}
            >
              <option value="incident_open">Incident open</option>
              <option value="locked_for_review">Locked for review</option>
            </Select>
          </Field>
          <div className="flex items-end sm:col-span-2">
            <Button variant="secondary" fullWidth onClick={() => void query.refetch()}>
              <SearchIcon size={17} />
              Refresh the queue
            </Button>
          </div>
        </div>
      </Card>

      {query.isLoading ? (
        <Card>
          <p className="text-sm text-ink-500">Loading the queue…</p>
        </Card>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing held"
          body={`No booking is currently in this state. New incidents appear here as soon as a traveller or sender reports one.`}
          icon={<AlertTriangleIcon size={22} />}
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.booking_id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip status={item.status} />
                    <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-700">
                      payout {item.payout_state.replaceAll('_', ' ')}
                    </span>
                    {item.reason_code ? (
                      <span className="text-xs font-semibold text-ink-500">{item.reason_code.replaceAll('_', ' ')}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-ink-900">
                    {item.sender_name ?? 'Sender'} <span className="text-ink-500">to</span>{' '}
                    {item.traveller_name ?? 'Traveller'}
                  </p>
                  <p className="tabular mt-1 text-xs text-ink-500">
                    Booking {shortId(item.booking_id)} · {inr(item.agreed_total_paise)} agreed ·{' '}
                    {inr(item.captured_paise)} captured ·{' '}
                    {item.opened_at ? `opened ${timeAgo(item.opened_at)} by ${item.opened_by ?? 'unknown'}` : 'opening event not recorded'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link
                    to={`/bookings/${item.booking_id}`}
                    className="text-xs font-semibold text-brand-700 underline"
                  >
                    Open booking
                  </Link>
                  <Button size="sm" variant="secondary" onClick={() => setThreadTarget(item)}>
                    Read thread
                  </Button>
                  {canResolve ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setResolveTarget(item);
                        setCleared(null);
                      }}
                    >
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <BookingThreadSheet
        incident={threadTarget}
        canRemove={canRemoveMessages}
        onClose={() => setThreadTarget(null)}
      />

      <IncidentResolveSheet
        incident={resolveTarget}
        onClose={() => setResolveTarget(null)}
        onResolved={(message) => {
          setResolveTarget(null);
          setCleared(message);
          void query.refetch();
        }}
      />
    </div>
  );
}

/**
 * The thread only ever opens from here. `GET /bookings/:id/conversation` answers 404 for staff on
 * purpose, so this route is the whole of a moderator's visibility — and every read of it is audited.
 */
function BookingThreadSheet({
  incident,
  canRemove,
  onClose,
}: {
  incident: AdminIncident | null;
  canRemove: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [pendingRemoval, setPendingRemoval] = useState<AdminThreadMessage | null>(null);
  const [reason, setReason] = useState(MESSAGE_REMOVAL_REASONS[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const query = useQuery({
    queryKey: ['admin', 'booking-messages', incident?.booking_id ?? ''],
    queryFn: () => api.get<{ items: AdminThreadMessage[] }>(`/admin/bookings/${incident!.booking_id}/messages`),
    enabled: Boolean(incident),
  });

  async function remove() {
    if (!pendingRemoval) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/messages/${pendingRemoval.id}/remove`, { reason_code: reason });
      setPendingRemoval(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'booking-messages', incident?.booking_id ?? ''] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={Boolean(incident)} onClose={onClose} title="Booking conversation">
      <Banner tone="warn" title="This read is recorded" icon>
        The audit log gets your account id, this booking and the number of messages you saw. Do not open
        threads you have no reason to read.
      </Banner>

      {!canRemove ? (
        <p className="text-xs text-ink-500">
          Removing a message needs the trust &amp; safety role. Nothing here would change it even if you tried.
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-sm text-ink-500">Loading the thread…</p>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-ink-500">These two never messaged each other on this booking.</p>
      ) : (
        <ul className="space-y-2">
          {query.data?.items.map((message) => (
            <li
              key={message.id}
              className={cn(
                'rounded-input border px-3 py-2 text-sm',
                message.removed_at ? 'border-line bg-canvas' : 'border-line bg-surface',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-ink-900">
                  {message.sender_name}
                  {message.sender_role ? ` · ${message.sender_role}` : ''}
                </p>
                <p className="text-xs text-ink-500">{formatDateTime(message.created_at)}</p>
              </div>
              <p className={cn('mt-1', message.removed_at ? 'text-ink-500 line-through' : 'text-ink-700')}>
                {message.body}
              </p>
              {message.removed_at ? (
                <p className="mt-1 text-xs text-danger-600">
                  Removed {formatDateTime(message.removed_at)}
                  {message.removed_reason ? ` · ${message.removed_reason.replaceAll('_', ' ')}` : ''}
                </p>
              ) : canRemove && message.kind !== 'system' ? (
                <div className="mt-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-ink-500 underline"
                    onClick={() => {
                      setPendingRemoval(message);
                      setError(null);
                    }}
                  >
                    Remove message
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pendingRemoval ? (
        <div className="mt-3 space-y-3 rounded-card border border-danger-600/30 bg-danger-50/60 p-3">
          <p className="text-sm font-semibold text-ink-900">Remove this message?</p>
          <p className="text-sm text-ink-700">{pendingRemoval.body}</p>
          <Field label="Reason code" htmlFor="message-reason" hint="Shown in the audit record, never edited away.">
            <Select id="message-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
              {MESSAGE_REMOVAL_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPendingRemoval(null);
                setError(null);
              }}
            >
              Keep it
            </Button>
            <Button variant="danger" size="sm" loading={busy} onClick={() => void remove()}>
              Remove message
            </Button>
          </div>
          {error ? <ErrorPanel error={error} /> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

function IncidentResolveSheet({
  incident,
  onClose,
  onResolved,
}: {
  incident: AdminIncident | null;
  onClose: () => void;
  onResolved: (message: string) => void;
}) {
  const [action, setAction] = useState<'clear' | 'compensate'>('clear');
  const [reason, setReason] = useState(INCIDENT_REASONS[0]!);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const compensated = incident?.captured_paise ?? 0;

  async function submit() {
    if (!incident) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ refund_id: string | null }>(`/admin/bookings/${incident.booking_id}/incident`, {
        action,
        reason_code: reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onResolved(
        action === 'clear'
          ? 'Cleared. The booking is payout_eligible and the traveller can be paid.'
          : res.refund_id
            ? `Compensated. Refund ${shortId(res.refund_id)} was opened for the full captured amount.`
            : 'Compensated. The refund was opened and the payout voided.',
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={Boolean(incident)}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="Close this incident"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              onClose();
            }}
          >
            Close
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Record outcome
          </Button>
        </>
      }
    >
      <Banner tone="danger" title="This decides whether a person gets paid" icon>
        Nothing here is reversible from the console. Read the thread and the booking events first.
      </Banner>

      <Field label="Outcome" htmlFor="incident-action">
        <Select
          id="incident-action"
          value={action}
          onChange={(event) => setAction(event.target.value as 'clear' | 'compensate')}
        >
          <option value="clear">Clear — the parcel is accounted for, the traveller keeps their share</option>
          <option value="compensate" disabled={compensated === 0}>
            Compensate — refund the sender, void the payout
          </option>
        </Select>
      </Field>

      {compensated === 0 ? (
        <p className="text-xs text-ink-500">
          Nothing was captured for this booking, so there is no money to send back. The server refuses
          compensation here rather than writing a "refunded" state that no ledger row agrees with.
        </p>
      ) : (
        <p className="text-xs text-ink-500">
          {inr(compensated)} was captured. Compensation opens a refund for exactly that amount, and voids the
          traveller's payout. A refund above the dual-approval threshold is created waiting for a second
          approver instead of going out at once.
        </p>
      )}

      <Field label="Reason code" htmlFor="incident-reason">
        <Select id="incident-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          {INCIDENT_REASONS.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Internal note" htmlFor="incident-note" optional hint="Stored on the refund and the audit entry, not shown to either side.">
        <TextInput
          id="incident-note"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      {error ? (
        <div className="rounded-card border border-warn-600/30 bg-warn-50 p-3 text-sm">
          <p className="font-semibold text-ink-900">{errorCopy(error).title}</p>
          <p className="mt-1 text-ink-700">{errorCopy(error).body}</p>
          {error instanceof ApiError && error.code === 'PAYMENT_NOT_PAYABLE' ? (
            <p className="mt-1 text-xs text-ink-500">Nothing was changed on this booking.</p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------- audit

function AuditLog() {
  const [resource, setResource] = useState('');
  const [resourceId, setResourceId] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'audit', resource, resourceId],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (resource) params.set('resource', resource);
      if (resourceId.trim()) params.set('resource_id', resourceId.trim());
      return api.get<{ items: AuditEntry[] }>(`/admin/audit-log?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <SectionHeading title="Audit log" description="Newest first. Reading this log is itself recorded." />

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Resource" htmlFor="resource">
            <Select id="resource" value={resource} onChange={(event) => setResource(event.target.value)}>
              <option value="">Any resource</option>
              {['booking', 'parcel', 'trip', 'verification', 'refund', 'dispute', 'payout', 'user'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Resource id" htmlFor="resourceId" optional>
            <TextInput
              id="resourceId"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              placeholder="UUID"
            />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" fullWidth onClick={() => void query.refetch()}>
              <SearchIcon size={17} />
              Search
            </Button>
          </div>
        </div>
      </Card>

      {query.isLoading ? (
        <Card>
          <p className="text-sm text-ink-500">Loading the log…</p>
        </Card>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No entries" body="Change the filters and search again." icon={<DocIcon size={22} />} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs text-ink-500 uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Actor</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {query.data?.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 text-xs text-ink-500">{formatDateTime(entry.created_at)}</td>
                  <td className="tabular px-3 py-2 font-mono text-xs text-ink-700">
                    {entry.actor_id ? shortId(entry.actor_id) : entry.actor_kind}
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold text-ink-900">{entry.action}</td>
                  <td className="tabular px-3 py-2 font-mono text-xs text-ink-500">
                    {entry.resource}
                    {entry.resource_id ? `/${shortId(entry.resource_id)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
