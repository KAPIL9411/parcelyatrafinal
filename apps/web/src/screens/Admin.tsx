import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { DISPUTE_CATEGORY_LABELS, type DisputeCategory } from '@py/domain';

import {
  api,
  ApiError,
  type AdminBookingRow,
  type AdminDispute,
  type AdminVerification,
  type AuditEntry,
} from '../lib/api';
import { errorCopy, verificationReason } from '../lib/copy';
import { formatDateTime, inr, shortId, timeAgo } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  SectionHeading,
  Select,
  Sheet,
  SuccessPanel,
  TextInput,
  cn,
} from '../components/ui';
import { StatusChip, VerificationChip } from '../components/StatusChip';
import { ShieldCheckIcon, AlertTriangleIcon, SearchIcon, DocIcon, LockIcon } from '../components/icons';

type Tab = 'verifications' | 'bookings' | 'disputes' | 'audit';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'verifications', label: 'Verification queue' },
  { value: 'bookings', label: 'Bookings' },
  { value: 'disputes', label: 'Cases' },
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
                    Documents are not rendered in this console. A production build needs a signed, audited viewer.
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
