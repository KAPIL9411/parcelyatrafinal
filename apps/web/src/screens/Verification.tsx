import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ID_TYPE_LABELS, ID_TYPES, type IdType } from '@py/domain';

import { api, type Verification as VerificationRecord } from '../lib/api';
import { verificationReason } from '../lib/copy';
import { formatDateTime } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { sampleImage, uploadPhoto } from '../lib/upload';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  ErrorPanel,
  Field,
  LoadingBlock,
  SectionHeading,
  Select,
  SuccessPanel,
} from '../components/ui';
import { VerificationChip } from '../components/StatusChip';
import { CameraIcon, CheckCircleIcon, LockIcon, ShieldCheckIcon } from '../components/icons';

export function Verification() {
  useDocumentTitle('Verify your ID');
  const { user } = useSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['verification', 'me'],
    queryFn: () => api.get<VerificationRecord>('/verifications/me'),
    enabled: Boolean(user),
  });

  const [idType, setIdType] = useState<IdType>('driving_licence');
  const [frontKey, setFrontKey] = useState('');
  const [backKey, setBackKey] = useState('');
  const [selfieKey, setSelfieKey] = useState('');
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const record = query.data;
  const state = record?.state ?? 'not_started';
  const attemptsLeft = Math.max(0, 3 - (record?.attempts ?? 0));
  const showForm = state === 'not_started' || (state === 'rejected' && retrying);
  const canSubmit = Boolean(frontKey && selfieKey && consent) && !busy;

  useEffect(() => {
    // A rejection is a new attempt, so start from a clean form when the user chooses to retry.
    if (retrying) {
      setFrontKey('');
      setBackKey('');
      setSelfieKey('');
      setConsent(false);
      setError(null);
    }
  }, [retrying]);

  async function attach(
    file: File | null,
    purpose: 'kyc_id' | 'kyc_selfie',
    set: (key: string) => void,
    label: string,
  ) {
    if (!file) return;
    setUploading(label);
    setError(null);
    try {
      const key = await uploadPhoto(file, purpose);
      set(key);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post<VerificationRecord>('/verifications', {
        id_type: idType,
        id_front_key: frontKey,
        ...(backKey ? { id_back_key: backKey } : {}),
        selfie_key: selfieKey,
        consent_version: 'v1',
      });
      setRetrying(false);
      await queryClient.invalidateQueries({ queryKey: ['verification'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Traveller verification</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900 sm:text-2xl">Verify your ID</h1>
          <p className="mt-1 text-sm text-ink-500">
            One photo ID and a selfie. A person checks them. It usually takes under 24 hours.
          </p>
        </div>
        <VerificationChip state={state} />
      </div>

      {state === 'verified' ? (
        <Card>
          <SuccessPanel title="You are verified to carry parcels">
            {record?.decided_at ? `Approved on ${formatDateTime(record.decided_at, true)}. ` : null}
            You can publish a trip now.
          </SuccessPanel>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/trips/new">
              <Button>Publish a trip</Button>
            </Link>
            <Link to="/trips">
              <Button variant="secondary">See my trips</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {state === 'pending' ? (
        <Card>
          <Banner tone="warn" title="Your verification is with our team">
            Usually within 24 hours. We will text you when it is decided. You cannot publish a trip until then.
          </Banner>
          <p className="mt-4 text-sm text-ink-700">
            Submitted {record ? formatDateTime(record.created_at, true) : ''} using{' '}
            {record?.id_type ? ID_TYPE_LABELS[record.id_type as IdType] ?? record.id_type : 'a photo ID'}.
          </p>
          <Link to="/help" className="mt-4 inline-block">
            <Button variant="secondary" size="sm">
              Contact support
            </Button>
          </Link>
        </Card>
      ) : null}

      {state === 'rejected' ? (
        <Card>
          <Banner tone="danger" title="This verification was not accepted">
            {verificationReason(record?.reason_code ?? null)}
          </Banner>
          <p className="mt-4 text-sm text-ink-700">
            {attemptsLeft > 0
              ? `You have ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left. Check the reason above, then submit again with clearer photos.`
              : 'You have used all three attempts. Contact support and a person will help you continue.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {attemptsLeft > 0 && !retrying ? (
              <Button variant="secondary" onClick={() => setRetrying(true)}>
                Try again
              </Button>
            ) : null}
            <Link to="/help">
              <Button variant="tertiary">Contact support</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {showForm ? (
        <Card className="space-y-5">
          <SectionHeading
            eyebrow="One time"
            title="Your ID"
            description="Use the original document, not a photocopy."
          />

          <Field label="Document type" htmlFor="idType">
            <Select id="idType" value={idType} onChange={(event) => setIdType(event.target.value as IdType)}>
              {ID_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ID_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>

          <PhotoField
            label="Front of the ID"
            hint="All four corners visible, no glare, number readable."
            uploaded={Boolean(frontKey)}
            busy={uploading === 'front'}
            onFile={(file) => void attach(file, 'kyc_id', setFrontKey, 'front')}
            onSample={() => void attach(sampleImage('id-front.png'), 'kyc_id', setFrontKey, 'front')}
          />

          <PhotoField
            label="Back of the ID"
            hint="Only if your document has information on the back."
            optional
            uploaded={Boolean(backKey)}
            busy={uploading === 'back'}
            onFile={(file) => void attach(file, 'kyc_id', setBackKey, 'back')}
            onSample={() => void attach(sampleImage('id-back.png'), 'kyc_id', setBackKey, 'back')}
          />

          <PhotoField
            label="A selfie"
            hint="Your face and the ID in the same photo, both clear."
            uploaded={Boolean(selfieKey)}
            busy={uploading === 'selfie'}
            onFile={(file) => void attach(file, 'kyc_selfie', setSelfieKey, 'selfie')}
            onSample={() => void attach(sampleImage('selfie.png'), 'kyc_selfie', setSelfieKey, 'selfie')}
          />

          <Checkbox
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            label="I agree to my ID being checked for this purpose"
            description="The photos are used to decide this verification. We do not use them for advertising or share them with senders."
          />

          {error ? <ErrorPanel error={error} /> : null}

          <Button fullWidth size="lg" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            Submit for verification
          </Button>

          <p className="text-xs text-ink-500">
            You will get a text when a person has decided. Nothing is published in the meantime.
          </p>
        </Card>
      ) : null}

      <Card className="bg-canvas">
        <h2 className="text-sm font-semibold text-ink-900">What we ask for, and what we do not</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
          <li className="flex gap-2">
            <CheckCircleIcon size={17} className="mt-0.5 shrink-0 text-success-600" />
            A driving licence, voter ID or passport. A selfie holding or beside it.
          </li>
          <li className="flex gap-2">
            <LockIcon size={17} className="mt-0.5 shrink-0 text-brand-700" />
            We never ask for Aadhaar, and we do not accept it if offered.
          </li>
          <li className="flex gap-2">
            <ShieldCheckIcon size={17} className="mt-0.5 shrink-0 text-brand-700" />
            Photos are visible only to the reviewer. They are not shown to senders.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function PhotoField({
  label,
  hint,
  optional = false,
  uploaded,
  busy,
  onFile,
  onSample,
}: {
  label: string;
  hint: string;
  optional?: boolean;
  uploaded: boolean;
  busy: boolean;
  onFile: (file: File | null) => void;
  onSample: () => void;
}) {
  return (
    <Field label={label} hint={hint} optional={optional}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-input border border-line-strong bg-surface px-4 text-sm font-medium text-ink-900 hover:bg-canvas">
          <CameraIcon size={18} />
          {uploaded ? 'Replace photo' : 'Take or choose a photo'}
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {import.meta.env.DEV ? (
          <Button variant="tertiary" size="sm" loading={busy} onClick={onSample}>
            Use sample image
          </Button>
        ) : null}

        {uploaded ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success-600">
            <CheckCircleIcon size={16} /> Attached
          </span>
        ) : busy ? (
          <span className="text-sm text-ink-500">Uploading…</span>
        ) : null}
      </div>
    </Field>
  );
}
