/**
 * The homepage and campaign console.
 *
 * Three jobs, in the order the page presents them:
 *
 *  1. **the live page** — what version is published, what the draft changes, and one button that puts
 *     the draft in front of every user;
 *  2. **campaigns** — a scheduled overlay with its own window, priority and platforms, so Diwali can
 *     be prepared in October and go live without an app release;
 *  3. **history** — every release, and a rollback that creates a new version instead of rewriting the
 *     past.
 *
 * Publishing is a trust-and-safety action. The API enforces that; this console mirrors it by
 * disabling the controls rather than letting a support agent press a button that will fail.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  defaultHomepageConfig,
  visibleSections,
  type HomeHero,
  type HomepageConfig,
  type HomepageDocument,
  type HomeSection,
} from '@py/domain';

import {
  ApiError,
  homepageAdmin,
  type CampaignInput,
  type HomepageMediaItem,
  type HomepagePlatform,
  type HomepageRelease,
  type HomepageReleaseSummary,
} from '../lib/api';
import { formatInstant, isoToZoned, zonedToIso } from '../lib/homepage';
import { uploadPhoto } from '../lib/upload';
import { useSession } from '../lib/session';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingBlock,
  SectionHeading,
  Select,
  Sheet,
  SuccessPanel,
  TextArea,
  TextInput,
  cn,
} from './ui';
import { Chip } from './StatusChip';
import { HomepageEditor } from './HomepageEditor';

type Tab = 'page' | 'campaigns' | 'history';

const PLATFORMS: HomepagePlatform[] = ['android', 'ios', 'web'];

// Mirrors `WRITE_ROLES` in `apps/api/src/routes/admin-homepage.ts`: the server is the authority, this
// only decides which controls are worth showing.
const WRITE_ROLES = ['trust_safety'];

function canPublish(roles: string[] | undefined): boolean {
  return (roles ?? []).some((role) => WRITE_ROLES.includes(role));
}

function issuesOf(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const issues = (error.details as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues.filter((value): value is string => typeof value === 'string') : [];
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const issues = issuesOf(error);
    if (issues.length) return issues.join(' · ');
    return error.message;
  }
  return 'That did not work. Check your connection and try again.';
}

export function HomepageAdmin() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('page');
  const [preview, setPreview] = useState<{ draft: boolean; campaignId: string | null } | null>(null);

  const state = useQuery({
    queryKey: ['admin', 'homepage'],
    queryFn: homepageAdmin.state,
    staleTime: 15_000,
  });

  const writable = canPublish(user?.roles);

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'homepage'] });
  }

  if (state.isLoading) {
    return (
      <Card>
        <LoadingBlock lines={6} />
      </Card>
    );
  }

  if (state.isError || !state.data) {
    return (
      <Card>
        <EmptyState
          title="The homepage console could not load"
          body={errorText(state.error)}
          action={
            <Button type="button" variant="secondary" onClick={() => void state.refetch()}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }

  const data = state.data;

  return (
    <div className="space-y-5">
      <PublicationStatus
        published={data.published}
        draft={data.draft}
        campaigns={data.campaigns}
        liveCampaignId={data.live_campaign_id}
        onPreview={() => setPreview({ draft: Boolean(data.draft), campaignId: null })}
      />

      {!writable ? (
        <Banner tone="warn" title="You can look, but not publish">
          Saving drafts and publishing need the trust-and-safety or console-owner role. Everything
          here is read-only for your account.
        </Banner>
      ) : null}

      <div className="-mt-2 flex flex-wrap gap-6 border-b border-line" role="tablist" aria-label="Homepage sections">
        {(
          [
            { value: 'page', label: 'Homepage' },
            { value: 'campaigns', label: `Campaigns (${data.campaigns.length})` },
            { value: 'history', label: 'Versions' },
          ] as Array<{ value: Tab; label: string }>
        ).map((option) => (
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

      {tab === 'page' ? (
        <PageTab
          published={data.published}
          draft={data.draft}
          writable={writable}
          onReload={reload}
          onPreview={(draft) => setPreview({ draft, campaignId: null })}
        />
      ) : null}

      {tab === 'campaigns' ? (
        <CampaignsTab
          campaigns={data.campaigns}
          published={data.published}
          writable={writable}
          liveCampaignId={data.live_campaign_id}
          onReload={reload}
          onPreview={(campaignId) => setPreview({ draft: false, campaignId })}
        />
      ) : null}

      {tab === 'history' ? (
        <HistoryTab history={data.history} writable={writable} onReload={reload} />
      ) : null}

      {preview ? (
        <PreviewSheet
          open
          draft={preview.draft}
          campaignId={preview.campaignId}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------- status

function PublicationStatus({
  published,
  draft,
  campaigns,
  liveCampaignId,
  onPreview,
}: {
  published: HomepageRelease | null;
  draft: HomepageRelease | null;
  campaigns: HomepageRelease[];
  liveCampaignId: string | null;
  onPreview: () => void;
}) {
  const live = campaigns.find((campaign) => campaign.id === liveCampaignId);
  const scheduled = campaigns.filter(
    (campaign) => campaign.status === 'published' && campaign.id !== liveCampaignId,
  );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Homepage</p>
          <h2 className="mt-1 text-lg font-semibold text-ink-900">
            {published ? `Version ${published.version} is live` : 'No page is published'}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {published
              ? `Published ${formatInstant(published.published_at)}`
              : 'Every phone is showing its bundled default page.'}
            {draft ? ' · an unpublished draft exists.' : ''}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onPreview}>
          Preview
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Chip tone={live ? 'success' : 'neutral'}>{live ? `Campaign live: ${live.name}` : 'No campaign live'}</Chip>
        {scheduled.length ? (
          <Chip tone="brand">
            {scheduled.length} scheduled campaign{scheduled.length === 1 ? '' : 's'}
          </Chip>
        ) : null}
        <Chip tone={draft ? 'warn' : 'neutral'}>{draft ? 'Draft not published' : 'No draft'}</Chip>
      </div>

      {live ? (
        <p className="text-xs text-ink-500">
          {live.name} runs until {formatInstant(live.ends_at)}. After that the base page returns
          automatically, with no action from anyone.
        </p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------- page

function PageTab({
  published,
  draft,
  writable,
  onReload,
  onPreview,
}: {
  published: HomepageRelease | null;
  draft: HomepageRelease | null;
  writable: boolean;
  onReload: () => Promise<void>;
  onPreview: (draft: boolean) => void;
}) {
  const baseline = draft?.config ?? published?.config ?? defaultHomepageConfig();
  const baselineJson = useMemo(() => JSON.stringify(baseline), [baseline]);
  const [config, setConfig] = useState<HomepageConfig>(baseline);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'save' | 'publish' | 'discard' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A publish, a rollback or a refetch replaces the baseline; the editor follows it rather than
  // silently keeping a stale copy that would be re-saved over the new version.
  useEffect(() => {
    setConfig(baseline);
    setNote('');
  }, [baselineJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(config) !== baselineJson;

  async function save(): Promise<boolean> {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const result = await homepageAdmin.saveDraft(config, note.trim() || undefined);
      if (result.draft) setConfig(result.draft.config);
      await onReload();
      setNotice('Draft saved. Users still see the published version until you publish.');
      return true;
    } catch (caught) {
      setError(caught);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish(): Promise<void> {
    setBusy('publish');
    setError(null);
    setNotice(null);
    try {
      if (dirty || !draft) {
        const saved = await homepageAdmin.saveDraft(config, note.trim() || undefined);
        if (!saved.draft) throw new Error('The draft could not be saved.');
      }
      const result = await homepageAdmin.publish(note.trim() || undefined);
      await onReload();
      setNotice(`Version ${result.published.version} is live for every user.`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  async function discard(): Promise<void> {
    setBusy('discard');
    setError(null);
    setNotice(null);
    try {
      await homepageAdmin.discardDraft();
      await onReload();
      setNotice('Draft discarded. The published page was not touched.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">
              {draft ? 'Editing the draft' : 'Editing a new draft'}
            </h3>
            <p className="mt-0.5 text-sm text-ink-500">
              {draft
                ? 'Changes stay private until you publish.'
                : `Starting from version ${published?.version ?? 0}. Saving creates a draft; publishing puts it live.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!writable || busy !== null}
              onClick={() => onPreview(true)}
            >
              Preview draft
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={busy === 'save'}
              disabled={!writable || busy !== null || !dirty}
              onClick={() => void save()}
            >
              Save draft
            </Button>
            <Button
              type="button"
              size="sm"
              loading={busy === 'publish'}
              disabled={!writable || busy !== null}
              onClick={() => void publish()}
            >
              Publish now
            </Button>
            {draft ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                loading={busy === 'discard'}
                disabled={!writable || busy !== null}
                onClick={() => void discard()}
              >
                Discard draft
              </Button>
            ) : null}
          </div>
        </div>

        <Field label="Publish note" optional hint="Stored with the release and shown in the history.">
          <TextInput
            value={note}
            maxLength={200}
            placeholder="e.g. Diwali creative, approved by ops"
            disabled={!writable || busy !== null}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        {dirty ? (
          <Banner tone="warn" title="Unsaved changes">
            Publishing saves the draft first, so nothing on this screen is lost.
          </Banner>
        ) : null}

        {notice ? <SuccessPanel title={notice} /> : null}
        {error ? (
          <Banner tone="danger" title="That did not save">
            {errorText(error)}
          </Banner>
        ) : null}
      </Card>

      <HomepageEditor
        config={config}
        onChange={setConfig}
        disabled={!writable || busy !== null}
        timeZone="Asia/Kolkata"
        onUpload={uploadArtwork}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------- campaigns

interface CampaignForm {
  id: string | null;
  name: string;
  starts_at: string;
  ends_at: string;
  timeZone: string;
  priority: number;
  platforms: HomepagePlatform[];
  note: string;
  config: HomepageConfig;
}

function nextWeekend(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

function CampaignsTab({
  campaigns,
  published,
  writable,
  liveCampaignId,
  onReload,
  onPreview,
}: {
  campaigns: HomepageRelease[];
  published: HomepageRelease | null;
  writable: boolean;
  liveCampaignId: string | null;
  onReload: () => Promise<void>;
  onPreview: (campaignId: string) => void;
}) {
  const [form, setForm] = useState<CampaignForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const rank = { draft: 0, published: 1, archived: 2 } as const;
    return campaigns
      .slice()
      .sort((a, b) => rank[a.status] - rank[b.status] || b.version - a.version);
  }, [campaigns]);

  function startNew(): void {
    const window = nextWeekend();
    setForm({
      id: null,
      name: '',
      starts_at: isoToZoned(window.start, 'Asia/Kolkata'),
      ends_at: isoToZoned(window.end, 'Asia/Kolkata'),
      timeZone: 'Asia/Kolkata',
      priority: 10,
      platforms: ['android', 'ios', 'web'],
      note: '',
      config: published?.config ?? defaultHomepageConfig(),
    });
  }

  function startEdit(campaign: HomepageRelease): void {
    setForm({
      id: campaign.id,
      name: campaign.name,
      starts_at: isoToZoned(campaign.starts_at, 'Asia/Kolkata'),
      ends_at: isoToZoned(campaign.ends_at, 'Asia/Kolkata'),
      timeZone: 'Asia/Kolkata',
      priority: campaign.priority,
      platforms: campaign.platforms,
      note: campaign.note ?? '',
      config: campaign.config,
    });
  }

  async function act(label: string, run: () => Promise<void>): Promise<void> {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await run();
      await onReload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Festive and promo campaigns</h3>
            <p className="mt-0.5 text-sm text-ink-500">
              A campaign layers a theme, hero and section list over the base page for a fixed window.
              When the window closes the base page returns by itself.
            </p>
          </div>
          <Button type="button" size="sm" disabled={!writable || busy !== null} onClick={startNew}>
            New campaign
          </Button>
        </div>

        {notice ? <SuccessPanel title={notice} /> : null}
        {error ? (
          <Banner tone="danger" title="That did not work">
            {errorText(error)}
          </Banner>
        ) : null}
      </Card>

      {ordered.length === 0 ? (
        <Card>
          <EmptyState
            title="No campaigns yet"
            body="Create one for the next festival, upload the artwork, and schedule the window. Nothing goes live until you publish it."
            action={
              writable ? (
                <Button type="button" variant="secondary" onClick={startNew}>
                  Create the first campaign
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : null}

      <div className="space-y-3">
        {ordered.map((campaign) => {
          const live = campaign.id === liveCampaignId;
          const isDraft = campaign.status === 'draft';
          const isPublished = campaign.status === 'published';
          const over = campaign.ends_at ? new Date(campaign.ends_at).getTime() < Date.now() : false;

          return (
            <Card key={campaign.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-semibold text-ink-900">{campaign.name}</h4>
                    <Chip tone={isDraft ? 'warn' : live ? 'success' : over ? 'neutral' : 'brand'}>{live
                        ? 'Live now'
                        : isDraft
                          ? 'Draft'
                          : isPublished
                            ? over
                              ? 'Window closed'
                              : 'Scheduled'
                            : 'Archived'}</Chip>
                    <span className="text-xs text-ink-500">v{campaign.version}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-500">
                    {formatInstant(campaign.starts_at)} → {formatInstant(campaign.ends_at)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Priority {campaign.priority} · {campaign.platforms.join(', ')} · theme{' '}
                    {campaign.config.theme.key}
                    {campaign.rolled_back_from ? ` · restored from v${campaign.rolled_back_from}` : ''}
                  </p>
                  {campaign.note ? (
                    <p className="mt-1 text-xs text-ink-500">{campaign.note}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => onPreview(campaign.id)}
                  >
                    Preview
                  </Button>
                  {isDraft ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!writable || busy !== null}
                        onClick={() => startEdit(campaign)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        loading={busy === `publish:${campaign.id}`}
                        disabled={!writable || busy !== null}
                        onClick={() =>
                          void act(`publish:${campaign.id}`, async () => {
                            await homepageAdmin.publishCampaign(campaign.id);
                            setNotice(
                              `${campaign.name} is published. It appears when its window opens.`,
                            );
                          })
                        }
                      >
                        Publish
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        loading={busy === `delete:${campaign.id}`}
                        disabled={!writable || busy !== null}
                        onClick={() =>
                          void act(`delete:${campaign.id}`, async () => {
                            await homepageAdmin.deleteCampaign(campaign.id);
                            setNotice('Draft campaign deleted.');
                          })
                        }
                      >
                        Delete
                      </Button>
                    </>
                  ) : null}

                  {!isDraft ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={busy === `duplicate:${campaign.id}`}
                      disabled={!writable || busy !== null}
                      onClick={() =>
                        void act(`duplicate:${campaign.id}`, async () => {
                          await homepageAdmin.duplicateCampaign(campaign.id);
                          setNotice('Copied as a new draft. The original is unchanged.');
                        })
                      }
                    >
                      Duplicate
                    </Button>
                  ) : null}

                  {isPublished ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      loading={busy === `unpublish:${campaign.id}`}
                      disabled={!writable || busy !== null}
                      onClick={() =>
                        void act(`unpublish:${campaign.id}`, async () => {
                          await homepageAdmin.unpublishCampaign(campaign.id);
                          setNotice(`${campaign.name} is no longer published.`);
                        })
                      }
                    >
                      Unpublish
                    </Button>
                  ) : null}
                </div>
              </div>

              {isPublished && !live && !over ? (
                <p className="text-xs text-ink-500">
                  Published and waiting for its window. It will replace the current page at{' '}
                  {formatInstant(campaign.starts_at)}.
                </p>
              ) : null}
            </Card>
          );
        })}
      </div>

      {form ? (
        <CampaignSheet
          form={form}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSaved={async (message) => {
            setForm(null);
            setNotice(message);
            await onReload();
          }}
        />
      ) : null}
    </div>
  );
}

function CampaignSheet({
  form,
  onChange,
  onClose,
  onSaved,
}: {
  form: CampaignForm;
  onChange: (next: CampaignForm) => void;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const startsAt = zonedToIso(form.starts_at, form.timeZone);
  const endsAt = zonedToIso(form.ends_at, form.timeZone);
  const windowValid = Boolean(startsAt && endsAt && new Date(endsAt) > new Date(startsAt!));
  const nameValid = form.name.trim().length > 0;
  const platformsValid = form.platforms.length > 0;

  function set<K extends keyof CampaignForm>(key: K, value: CampaignForm[K]): void {
    onChange({ ...form, [key]: value });
  }

  async function submit(): Promise<void> {
    if (!startsAt || !endsAt || !nameValid || !platformsValid) return;
    setBusy(true);
    setError(null);
    try {
      const body: CampaignInput = {
        name: form.name.trim(),
        config: form.config,
        starts_at: startsAt,
        ends_at: endsAt,
        priority: form.priority,
        platforms: form.platforms,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      };
      if (form.id) await homepageAdmin.updateCampaign(form.id, body);
      else await homepageAdmin.createCampaign(body);
      await onSaved(
        form.id
          ? 'Campaign saved. Publish it when the creative is approved.'
          : 'Campaign created as a draft. Nothing is visible until you publish it.',
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={form.id ? 'Edit campaign' : 'New campaign'}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={busy || !nameValid || !windowValid || !platformsValid}
            onClick={() => void submit()}
          >
            {form.id ? 'Save campaign' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Campaign name" hint="Internal only — users never see this.">
          <TextInput
            value={form.name}
            maxLength={80}
            placeholder="Diwali 2026"
            disabled={busy}
            onChange={(event) => set('name', event.target.value)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Time zone" hint="Windows are stored as instants.">
            <Select
              value={form.timeZone}
              disabled={busy}
              onChange={(event) => set('timeZone', event.target.value)}
            >
              <option value="Asia/Kolkata">India (IST, UTC+05:30)</option>
              <option value="Asia/Dubai">Dubai (UTC+04:00)</option>
              <option value="Asia/Singapore">Singapore (UTC+08:00)</option>
              <option value="Europe/London">London</option>
              <option value="America/New_York">New York</option>
              <option value="UTC">UTC</option>
            </Select>
          </Field>
          <Field label="Priority" hint="Higher wins when two campaigns overlap.">
            <TextInput
              type="number"
              min={0}
              max={1000}
              value={form.priority}
              disabled={busy}
              onChange={(event) => set('priority', Number(event.target.value))}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Starts"
            error={!startsAt ? 'Enter a valid date and time.' : null}
            hint={startsAt ? `Goes live ${formatInstant(startsAt, form.timeZone)}` : undefined}
          >
            <TextInput
              type="datetime-local"
              value={form.starts_at}
              disabled={busy}
              onChange={(event) => set('starts_at', event.target.value)}
            />
          </Field>
          <Field
            label="Ends"
            error={!windowValid ? 'The end must be after the start.' : null}
            hint={endsAt ? `Falls back ${formatInstant(endsAt, form.timeZone)}` : undefined}
          >
            <TextInput
              type="datetime-local"
              value={form.ends_at}
              disabled={busy}
              onChange={(event) => set('ends_at', event.target.value)}
            />
          </Field>
        </div>

        <Field label="Platforms" hint="A campaign can be Android-only during a staged rollout.">
          <div className="flex flex-wrap gap-4 pt-1">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={form.platforms.includes(platform)}
                  disabled={busy}
                  onChange={(event) =>
                    set(
                      'platforms',
                      event.target.checked
                        ? [...form.platforms, platform]
                        : form.platforms.filter((value) => value !== platform),
                    )
                  }
                />
                {platform}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Note" optional hint="Approval reference, creative source, anything the next editor needs.">
          <TextArea
            rows={2}
            value={form.note}
            maxLength={300}
            disabled={busy}
            onChange={(event) => set('note', event.target.value)}
          />
        </Field>

        {error ? (
          <Banner tone="danger" title="That did not save">
            {errorText(error)}
          </Banner>
        ) : null}

        <div className="rounded-input bg-canvas p-3">
          <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Campaign content</p>
          <p className="mt-1 text-xs text-ink-500">
            Theme keys override the base palette. A hero replaces the carousel; a section list replaces
            the page's sections. Leave either empty to inherit the base page.
          </p>
        </div>

        <HomepageEditor
          config={form.config}
          onChange={(config) => set('config', config)}
          disabled={busy}
          timeZone={form.timeZone}
          onUpload={uploadArtwork}
        />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------- history

function HistoryTab({
  history,
  writable,
  onReload,
}: {
  history: HomepageReleaseSummary[];
  writable: boolean;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function restore(version: number): Promise<void> {
    setBusy(version);
    setError(null);
    setNotice(null);
    try {
      const result = await homepageAdmin.rollback(version);
      await onReload();
      setNotice(`Version ${version} was restored as version ${result.published.version}.`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900">Every release</h3>
        <p className="text-sm text-ink-500">
          A rollback publishes the old configuration as a new version. Nothing is deleted, so “what was
          live on the 12th” always has an answer.
        </p>
        {notice ? <SuccessPanel title={notice} /> : null}
        {error ? (
          <Banner tone="danger" title="Rollback failed">
            {errorText(error)}
          </Banner>
        ) : null}
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs tracking-wide text-ink-500 uppercase">
              <th className="px-4 py-2.5 font-medium">Version</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Published</th>
              <th className="px-4 py-2.5 font-medium">Note</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {history.map((release) => (
              <tr key={release.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink-900">v{release.version}</td>
                <td className="px-4 py-2.5">
                  <Chip tone={
                      release.status === 'published'
                        ? 'success'
                        : release.status === 'draft'
                          ? 'warn'
                          : 'neutral'
                    }>{release.status}</Chip>
                </td>
                <td className="px-4 py-2.5 text-ink-700">{formatInstant(release.published_at)}</td>
                <td className="px-4 py-2.5 text-ink-500">
                  {release.rolled_back_from ? `Restored from v${release.rolled_back_from}. ` : ''}
                  {release.note ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {release.status === 'archived' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={busy === release.version}
                      disabled={!writable || busy !== null}
                      onClick={() => void restore(release.version)}
                    >
                      Restore
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- preview

function PreviewSheet({
  open,
  draft,
  campaignId,
  onClose,
}: {
  open: boolean;
  draft: boolean;
  campaignId: string | null;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<HomepagePlatform>('android');

  const query = useQuery({
    queryKey: ['admin', 'homepage', 'preview', draft, campaignId, platform],
    queryFn: () => homepageAdmin.preview({ draft, platform, campaignId }),
    enabled: open,
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={draft ? 'Preview draft' : 'Preview published page'}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-500">
            Exactly what a phone receives, after validation. Text is real, images are the uploaded
            artwork.
          </p>
          <Select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as HomepagePlatform)}
            className="h-9 w-32 text-xs"
          >
            {PLATFORMS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>

        {query.isLoading ? <LoadingBlock lines={8} /> : null}
        {query.isError ? (
          <Banner tone="danger" title="Preview failed">
            {errorText(query.error)}
          </Banner>
        ) : null}
        {query.data ? <PhonePreview document={query.data.document} /> : null}
      </div>
    </Sheet>
  );
}

/** A compact, honest rendering of the document: same copy, same order, same colours. */
function PhonePreview({ document }: { document: HomepageDocument }) {
  const sections = visibleSections(document);
  const hero: HomeHero | undefined = document.hero[0];
  const gradient = hero?.gradient ?? document.theme.gradient ?? document.theme.hero_gradient ?? ['#0b3bff', '#061a7a'];
  const brand = document.theme.brand ?? '#0a57ff';
  const accent = document.theme.accent ?? '#e8b33c';
  const surface = document.theme.surface ?? '#ffffff';
  const canvas = document.theme.canvas ?? '#f6f7fa';
  const navy = document.theme.navy ?? '#0a1730';

  return (
    <div className="space-y-2">
      <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-[26px] border border-line-strong bg-surface shadow-card">
        <div style={{ backgroundColor: surface }} className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className="grid h-6 w-6 place-items-center rounded-lg text-[11px] font-bold text-white"
              style={{ backgroundColor: brand }}
            >
              P
            </span>
            <span className="text-xs font-bold" style={{ color: navy }}>
              Parcel Yatra
            </span>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[10px] font-semibold"
            style={{ backgroundColor: `${brand}18`, color: navy }}
          >
            Pickup city
          </span>
        </div>

        <div
          className="relative flex h-[168px] flex-col justify-end p-4"
          style={
            hero?.image_url
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(8,18,38,0.15), rgba(8,18,38,0.82)), url(${hero.image_url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : { backgroundImage: `linear-gradient(150deg, ${gradient.join(', ')})` }
          }
        >
          {hero?.eyebrow ? (
            <span className="mb-1 w-fit rounded-full bg-black/25 px-2 py-0.5 text-[9px] font-bold tracking-widest text-white">
              {hero.eyebrow.toUpperCase()}
            </span>
          ) : null}
          <p className="text-[19px] leading-tight font-bold text-white">
            {hero?.headline ?? 'Your parcel. Their journey.'}
          </p>
          {hero?.subtitle ? (
            <p className="mt-1 text-[11px] leading-snug text-white/85">{hero.subtitle}</p>
          ) : null}
          {hero?.cta ? (
            <span
              className="mt-2 w-fit rounded-full px-3 py-1.5 text-[11px] font-semibold"
              style={{ backgroundColor: accent, color: navy }}
            >
              {hero.cta.label}
            </span>
          ) : null}
        </div>

        <div className="-mt-3 px-3">
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2.5 shadow-card ring-1 ring-black/5">
            <span className="text-[11px] font-semibold" style={{ color: navy }}>
              Where should we send it?
            </span>
          </div>
        </div>

        <div style={{ backgroundColor: canvas }} className="space-y-3 px-3 py-3">
          {sections.map((section) => (
            <PreviewSection
              key={section.id}
              section={section}
              brand={brand}
              accent={accent}
              navy={navy}
              surface={surface}
            />
          ))}
          {sections.length === 0 ? (
            <p className="text-[11px] text-ink-500">No sections are visible right now.</p>
          ) : null}
        </div>
      </div>

      <p className="text-center text-xs text-ink-500">
        Version {document.version} · generated {formatInstant(document.generated_at)} ·{' '}
        {document.campaign ? `campaign “${document.campaign.name}”` : 'base page'}
      </p>
    </div>
  );
}

function PreviewSection({
  section,
  brand,
  accent,
  navy,
  surface,
}: {
  section: HomeSection;
  brand: string;
  accent: string;
  navy: string;
  surface: string;
}) {
  const items = section.items ?? [];
  const background = section.background ?? surface;
  const text = section.text_color ?? navy;
  const tint = section.accent_color ?? brand;

  return (
    <div
      className="overflow-hidden rounded-xl p-3"
      style={{ backgroundColor: background, border: `1px solid ${navy}14` }}
    >
      {section.title ? (
        <p className="text-[12px] font-semibold" style={{ color: text }}>
          {section.title}
        </p>
      ) : null}
      {section.subtitle ? (
        <p className="mt-0.5 text-[10px]" style={{ color: `${text}b0` }}>
          {section.subtitle}
        </p>
      ) : null}

      {section.type === 'category_grid' && items.length ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {items.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-1 rounded-lg px-2 py-2"
              style={{ backgroundColor: `${accent}18` }}
            >
              <span className="truncate text-[10px] font-semibold" style={{ color: text }}>
                {item.title}
              </span>
              {item.badge ? (
                <span
                  className="shrink-0 rounded-full px-1 py-0.5 text-[8px] font-bold"
                  style={{ backgroundColor: tint, color: '#ffffff' }}
                >
                  {item.badge}
                </span>
              ) : item.image_url ? (
                <img src={item.image_url} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
              ) : null}
            </div>
          ))}
        </div>
      ) : items.length ? (
        <div className="mt-2 space-y-1.5">
          {items.slice(0, 4).map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px]" style={{ color: text }}>
                {item.origin && item.dest ? `${item.origin} → ${item.dest}` : item.title}
              </span>
              {item.badge ? (
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                  style={{ backgroundColor: accent, color: navy }}
                >
                  {item.badge}
                </span>
              ) : (
                <span className="shrink-0 text-[10px]" style={{ color: tint }}>
                  ›
                </span>
              )}
            </div>
          ))}
          {items.length > 4 ? (
            <p className="text-[9px]" style={{ color: `${text}90` }}>
              +{items.length - 4} more
            </p>
          ) : null}
        </div>
      ) : section.type === 'campaign_hero' || section.type === 'business_promo' || section.type === 'carry_promo' ? (
        <div
          className="mt-2 rounded-lg p-3"
          style={{
            backgroundImage: section.image_url
              ? `linear-gradient(180deg, rgba(8,18,38,0.25), rgba(8,18,38,0.8)), url(${section.image_url})`
              : `linear-gradient(135deg, ${navy}, ${brand})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <span className="text-[11px] font-semibold text-white">
            {section.title ?? 'Campaign'}
          </span>
        </div>
      ) : (
        <p className="mt-1 text-[10px]" style={{ color: `${text}90` }}>
          Nothing to show in this section.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- uploads

/**
 * Artwork goes through the same two-step upload as verification documents: ask the API for a key,
 * write the bytes, then register the object so the homepage validator will accept its URL.
 */
async function uploadArtwork(file: File): Promise<string> {
  const objectKey = await uploadPhoto(file, 'campaign_art');
  const media: HomepageMediaItem = await homepageAdmin.registerMedia(objectKey);
  return media.url;
}
