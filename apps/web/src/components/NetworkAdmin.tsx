import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '../lib/api';
import { formatDateTime, inr, toLocalInput } from '../lib/format';
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
  Skeleton,
  TextInput,
  cn,
} from './ui';

/**
 * Staff controls for the launch network: what is measured, what is approved, what is operational,
 * which hotspot is verified, and which pricing policy is live.
 *
 * The panel deliberately shows the status ladder instead of a single "live" flag. A city appearing
 * in a list is not a route that works, and a route with a distance is not a route somebody
 * approved. The server enforces the same ladder; a refusal here is the server's answer, not ours.
 */

type Coverage = {
  cities: Record<string, number>;
  routes: {
    total: number;
    measured: number;
    operational: number;
    by_status: Record<string, number>;
    operational_share: number | null;
  };
  hotspots: Array<{ city: string; total: number; verified: number; active: number; with_coordinates: number }>;
  postal_benchmarks: number;
  pricing_policies: Array<{ version: string; status: string }>;
};

type AdminRoute = {
  id: string;
  origin_city_id: string;
  dest_city_id: string;
  origin: string;
  dest: string;
  status: string;
  distance_km: number | null;
  duration_minutes: number | null;
  provider: string | null;
  measured_at: string | null;
  approved_at: string | null;
  notes: string | null;
};

type AdminHotspot = {
  id: string;
  city: string;
  city_id: string;
  zone: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  pickup_enabled: boolean;
  dropoff_enabled: boolean;
  service_modes: string[];
  status: string;
  verification_status: string;
  verification_notes: string | null;
  verified_at: string | null;
};

type AdminPolicy = {
  id: string;
  version: string;
  name: string;
  params: Record<string, unknown>;
  status: string;
  notes: string | null;
  activated_at: string | null;
  created_at: string;
};

type AdminBenchmark = {
  id: string;
  provider: string;
  service: string;
  category: string;
  weight_band: string;
  amount_paise: number;
  source_url: string;
  retrieved_at: string;
  effective_from: string | null;
  notes: string | null;
};

const STATUS_TONE: Record<string, string> = {
  candidate: 'bg-canvas text-ink-500',
  unverified: 'bg-canvas text-ink-500',
  draft: 'bg-canvas text-ink-500',
  calculated: 'bg-info-50 text-info-700',
  approved: 'bg-warn-50 text-warn-600',
  verified: 'bg-success-50 text-success-700',
  active: 'bg-success-50 text-success-700',
  operational: 'bg-success-50 text-success-700',
  failed: 'bg-danger-50 text-danger-700',
  rejected: 'bg-danger-50 text-danger-700',
  suspended: 'bg-danger-50 text-danger-700',
  retired: 'bg-canvas text-ink-500',
  paused: 'bg-canvas text-ink-500',
};

function Badge({ value }: { value: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        STATUS_TONE[value] ?? 'bg-canvas text-ink-500',
      )}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}

function useFailure() {
  const [message, setMessage] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setMessage(null);
    try {
      return await fn();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'The request failed. Nothing was changed.');
      return null;
    }
  };
  const banner = message ? (
    <Banner tone="danger" className="mb-3">
      {message}
    </Banner>
  ) : null;
  return { run, banner };
}

export function NetworkAdmin() {
  const { user } = useSession();
  const roles = user?.roles ?? [];
  const canTrust = roles.includes('trust_safety');
  const canFinance = roles.includes('finance');

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Network and pricing"
        description="Coverage, the route ladder, hotspot verification, pricing policies and recorded postal tariffs. Every write is audited."
      />
      {!canTrust && !canFinance ? (
        <Banner tone="warn">
          Your staff roles can read this page but not change it. Route and hotspot decisions need
          <span className="font-semibold"> trust_safety</span>; policies and tariffs need
          <span className="font-semibold"> finance</span>.
        </Banner>
      ) : null}

      <CoverageCard />
      <RoutesPanel canAct={canTrust} />
      <HotspotsPanel canAct={canTrust} />
      <PoliciesPanel canAct={canFinance} />
      <BenchmarksPanel canAct={canFinance} />
    </div>
  );
}

// ---------------------------------------------------------------------------- coverage

function CoverageCard() {
  const query = useQuery({
    queryKey: ['admin', 'geo', 'coverage'],
    queryFn: () => api.get<Coverage>('/admin/geo/coverage'),
  });

  if (query.isPending) {
    return (
      <Card>
        <Skeleton className="h-5 w-32" />
        <LoadingBlock lines={3} />
      </Card>
    );
  }
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;

  const c = query.data;
  const share = c.routes.operational_share === null ? '—' : `${Math.round(c.routes.operational_share * 100)}%`;

  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cities by status" value={Object.entries(c.cities).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none'} />
        <Stat label="Directed routes" value={`${c.routes.total}`} hint={`${c.routes.measured} measured · ${c.routes.operational} operational (${share})`} />
        <Stat label="Postal benchmarks" value={`${c.postal_benchmarks}`} hint="Recorded tariffs, never copied into our prices" />
        <Stat
          label="Pricing policies"
          value={c.pricing_policies.length ? c.pricing_policies.map((p) => `${p.version} (${p.status})`).join(' · ') : 'none'}
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="border-b border-line text-xs text-ink-500 uppercase">
            <tr>
              <th className="py-2 pr-3 font-semibold">City</th>
              <th className="py-2 pr-3 font-semibold">Hotspots</th>
              <th className="py-2 pr-3 font-semibold">With coordinates</th>
              <th className="py-2 pr-3 font-semibold">Verified</th>
              <th className="py-2 font-semibold">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {c.hotspots.map((row) => (
              <tr key={row.city}>
                <td className="py-2 pr-3 font-semibold text-ink-900">{row.city}</td>
                <td className="tabular py-2 pr-3 text-ink-700">{row.total}</td>
                <td className="tabular py-2 pr-3 text-ink-700">{row.with_coordinates}</td>
                <td className="tabular py-2 pr-3 text-ink-700">{row.verified}</td>
                <td className="tabular py-2 text-ink-700">{row.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.hotspots.every((h) => h.verified === 0) ? (
        <p className="mt-3 text-xs text-ink-500">
          No hotspot is verified, so doorstep pickup and drop-off are refused everywhere. That is the
          honest state, not a display problem.
        </p>
      ) : null}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------- routes

function RoutesPanel({ canAct }: { canAct: boolean }) {
  const client = useQueryClient();
  const [status, setStatus] = useState('');
  const { run, banner } = useFailure();
  const [openRow, setOpenRow] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'geo', 'routes', status],
    queryFn: () =>
      api.get<{ items: AdminRoute[] }>(
        `/admin/geo/routes?limit=200${status ? `&status=${status}` : ''}`,
      ),
  });

  async function act(route: AdminRoute, action: 'approve' | 'operational' | 'retire') {
    const ok = await run(() => api.post(`/admin/geo/routes/${route.id}/decision`, { action }));
    if (ok) void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
  }

  async function measure(route: AdminRoute) {
    const summary = await run(() =>
      api.post<{ pairs: number; resolved: number; failed: number; skippedApproved: number }>(
        '/admin/geo/routes/refresh',
        { pairs: [{ origin_city_id: route.origin_city_id, dest_city_id: route.dest_city_id }] },
      ),
    );
    if (summary) {
      setResult(
        `${summary.resolved} of ${summary.pairs} pair measured${
          summary.failed ? `, ${summary.failed} failed` : ''
        }. A measured pair is a candidate for approval, not an operational route.`,
      );
      void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
    }
  }

  const routes = query.data?.items ?? [];

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Routes</h3>
          <p className="text-sm text-ink-500">
            candidate → measured → approved → operational. Only an operational pair with a measured
            distance is bookable.
          </p>
        </div>
        <Field label="Status" htmlFor="route-status">
          <Select id="route-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['candidate', 'calculated', 'approved', 'operational', 'failed', 'retired'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {banner}
      {result ? (
        <Banner tone="info" className="mb-3">
          {result}
        </Banner>
      ) : null}

      {query.isPending ? (
        <LoadingBlock lines={5} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : routes.length === 0 ? (
        <EmptyState title="No routes" body="Nothing matches this filter." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-500 uppercase">
              <tr>
                <th className="py-2 pr-3 font-semibold">Direction</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Distance</th>
                <th className="py-2 pr-3 font-semibold">Provider</th>
                <th className="py-2 pr-3 font-semibold">Measured</th>
                <th className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {routes.map((route) => (
                <RouteRow
                  key={route.id}
                  route={route}
                  canAct={canAct}
                  expanded={openRow === route.id}
                  onToggle={() => setOpenRow(openRow === route.id ? '' : route.id)}
                  onMeasure={() => void measure(route)}
                  onAct={(a) => void act(route, a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RouteRow({
  route,
  canAct,
  expanded,
  onToggle,
  onMeasure,
  onAct,
}: {
  route: AdminRoute;
  canAct: boolean;
  expanded: boolean;
  onToggle: () => void;
  onMeasure: () => void;
  onAct: (action: 'approve' | 'operational' | 'retire') => void;
}) {
  return (
    <>
      <tr>
        <td className="py-2 pr-3 font-semibold text-ink-900">
          {route.origin} → {route.dest}
        </td>
        <td className="py-2 pr-3">
          <Badge value={route.status} />
        </td>
        <td className="tabular py-2 pr-3 text-ink-700">{route.distance_km === null ? '—' : `${route.distance_km} km`}</td>
        <td className="py-2 pr-3 text-ink-500">{route.provider ?? '—'}</td>
        <td className="py-2 pr-3 text-xs text-ink-500">{route.measured_at ? formatDateTime(route.measured_at) : '—'}</td>
        <td className="py-2">
          <button
            type="button"
            onClick={onToggle}
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            {expanded ? 'Hide' : 'Decide'}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="bg-canvas px-3 py-3">
            {canAct ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={onMeasure}
                  disabled={route.status === 'approved' || route.status === 'operational'}
                >
                  Measure with the provider
                </Button>
                <Button variant="secondary" onClick={() => onAct('approve')} disabled={route.status !== 'calculated'}>
                  Approve distance
                </Button>
                <Button variant="secondary" onClick={() => onAct('operational')} disabled={route.status !== 'approved'}>
                  Mark operational
                </Button>
                <Button variant="tertiary" onClick={() => onAct('retire')} disabled={route.status === 'retired'}>
                  Retire
                </Button>
              </div>
            ) : (
              <p className="text-sm text-ink-500">Your role can read routes but not change them.</p>
            )}
            <p className="mt-2 text-xs text-ink-500">
              Measuring calls the routing provider configured on the server. If the server has no key,
              it answers that routing is unavailable and nothing is written — no distance is invented.
              Approval requires a measured distance; operational requires approval plus both cities active.
            </p>
            {route.notes ? <p className="mt-2 text-xs text-ink-700">Note: {route.notes}</p> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------- hotspots

function HotspotsPanel({ canAct }: { canAct: boolean }) {
  const client = useQueryClient();
  const [city, setCity] = useState('');
  const { run, banner } = useFailure();
  const [openId, setOpenId] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'geo', 'hotspots', city],
    queryFn: () =>
      api.get<{ items: AdminHotspot[] }>(
        `/admin/geo/hotspots?limit=200${city ? `&city_id=${city}` : ''}`,
      ),
  });

  // The option list must not shrink with the filter, so it is read from the unfiltered query
  // (the same key when no filter is set, so no extra request).
  const all = useQuery({
    queryKey: ['admin', 'geo', 'hotspots', ''],
    queryFn: () => api.get<{ items: AdminHotspot[] }>('/admin/geo/hotspots?limit=200'),
  });

  const items = query.data?.items ?? [];
  const cities = [...new Map((all.data?.items ?? []).map((h) => [h.city_id, h.city])).entries()];

  async function save(hotspot: AdminHotspot, patch: Record<string, unknown>) {
    const ok = await run(() => api.patch(`/admin/geo/hotspots/${hotspot.id}`, patch));
    if (ok) void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
  }

  async function verify(hotspot: AdminHotspot, decision: 'verify' | 'reject' | 'suspend') {
    const ok = await run(() => api.post(`/admin/geo/hotspots/${hotspot.id}/verify`, { decision }));
    if (ok) void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Hotspots</h3>
          <p className="text-sm text-ink-500">
            A hotspot needs coordinates and a verification before it can take a parcel. Only verified,
            active ones are offered to senders.
          </p>
        </div>
        <Field label="City" htmlFor="hotspot-city" optional>
          <Select id="hotspot-city" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">All cities</option>
            {cities.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {banner}

      {query.isLoading ? (
        <LoadingBlock lines={5} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No hotspots" body="Nothing matches this filter." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-500 uppercase">
              <tr>
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 pr-3 font-semibold">City</th>
                <th className="py-2 pr-3 font-semibold">Coordinates</th>
                <th className="py-2 pr-3 font-semibold">Verification</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((hotspot) => (
                <HotspotRow
                  key={hotspot.id}
                  hotspot={hotspot}
                  canAct={canAct}
                  expanded={openId === hotspot.id}
                  onToggle={() => setOpenId(openId === hotspot.id ? '' : hotspot.id)}
                  onSave={(patch) => void save(hotspot, patch)}
                  onVerify={(d) => void verify(hotspot, d)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function HotspotRow({
  hotspot,
  canAct,
  expanded,
  onToggle,
  onSave,
  onVerify,
}: {
  hotspot: AdminHotspot;
  canAct: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onVerify: (decision: 'verify' | 'reject' | 'suspend') => void;
}) {
  const [lat, setLat] = useState(hotspot.lat === null ? '' : String(hotspot.lat));
  const [lng, setLng] = useState(hotspot.lng === null ? '' : String(hotspot.lng));

  return (
    <>
      <tr>
        <td className="py-2 pr-3 font-semibold text-ink-900">
          {hotspot.name}
          <p className="text-xs font-normal text-ink-500">{hotspot.address}</p>
        </td>
        <td className="py-2 pr-3 text-ink-700">{hotspot.city}</td>
        <td className="tabular py-2 pr-3 text-ink-700">
          {hotspot.lat === null || hotspot.lng === null ? 'none' : `${hotspot.lat}, ${hotspot.lng}`}
        </td>
        <td className="py-2 pr-3">
          <Badge value={hotspot.verification_status} />
        </td>
        <td className="py-2 pr-3">
          <Badge value={hotspot.status} />
        </td>
        <td className="py-2">
          <button type="button" onClick={onToggle} className="font-semibold text-brand-700 underline underline-offset-2">
            {expanded ? 'Hide' : 'Edit'}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="bg-canvas px-3 py-3">
            {canAct ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Latitude" htmlFor={`lat-${hotspot.id}`}>
                    <TextInput
                      id={`lat-${hotspot.id}`}
                      inputMode="decimal"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="28.367"
                    />
                  </Field>
                  <Field label="Longitude" htmlFor={`lng-${hotspot.id}`}>
                    <TextInput
                      id={`lng-${hotspot.id}`}
                      inputMode="decimal"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      placeholder="79.430"
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={lat.trim() === '' || lng.trim() === '' || !coordsParseable(lat, lng)}
                    onClick={() => onSave({ lat: Number(lat), lng: Number(lng) })}
                  >
                    Save coordinates
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => onVerify('verify')}>
                    Verify
                  </Button>
                  <Button variant="tertiary" onClick={() => onVerify('reject')}>
                    Reject
                  </Button>
                  <Button variant="tertiary" onClick={() => onVerify('suspend')}>
                    Suspend
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() => onSave({ status: hotspot.status === 'active' ? 'paused' : 'active' })}
                  >
                    {hotspot.status === 'active' ? 'Pause' : 'Activate'}
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() =>
                      onSave({
                        pickup_enabled: !hotspot.pickup_enabled,
                        service_modes: hotspot.service_modes.includes('doorstep')
                          ? hotspot.service_modes
                          : [...hotspot.service_modes, 'doorstep'],
                      })
                    }
                  >
                    {hotspot.pickup_enabled ? 'Disable pickup' : 'Allow pickup'}
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() =>
                      onSave({
                        dropoff_enabled: !hotspot.dropoff_enabled,
                        service_modes: hotspot.service_modes.includes('doorstep')
                          ? hotspot.service_modes
                          : [...hotspot.service_modes, 'doorstep'],
                      })
                    }
                  >
                    {hotspot.dropoff_enabled ? 'Disable drop-off' : 'Allow drop-off'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-500">Your role can read hotspots but not change them.</p>
            )}
            <p className="mt-2 text-xs text-ink-500">
              Verification needs coordinates. Moving the coordinates of an active hotspot is refused until
              it is verified again. Activation needs both.
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------- policies

function PoliciesPanel({ canAct }: { canAct: boolean }) {
  const client = useQueryClient();
  const { run, banner } = useFailure();
  const [showForm, setShowForm] = useState(false);
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [baseRupees, setBaseRupees] = useState('12');
  const [perKm, setPerKm] = useState('0.18');
  const [perKg, setPerKg] = useState('4');
  const [commissionPct, setCommissionPct] = useState('6');

  const query = useQuery({
    queryKey: ['admin', 'geo', 'policies'],
    queryFn: () => api.get<{ items: AdminPolicy[] }>('/admin/geo/policies'),
  });

  async function activate(policy: AdminPolicy) {
    const ok = await run(() => api.post(`/admin/geo/policies/${policy.id}/activate`, {}));
    if (ok) void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
  }

  async function createDraft() {
    const params = {
      baseFarePaise: Math.round(Number(baseRupees) * 100),
      routeRatePaisePerKm: Math.round(Number(perKm) * 100),
      weightRatePaisePerKg: Math.round(Number(perKg) * 100),
      commissionRate: Number(commissionPct) / 100,
    };
    const ok = await run(() => api.post('/admin/geo/policies', { version: version.trim(), name: name.trim(), params }));
    if (ok) {
      void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
      setShowForm(false);
      setVersion('');
      setName('');
    }
  }

  const policies = query.data?.items ?? [];

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Pricing policies</h3>
          <p className="text-sm text-ink-500">One policy is active at a time. Activating one retires the current active.</p>
        </div>
        {canAct ? (
          <Button variant="secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'New draft'}
          </Button>
        ) : null}
      </div>

      {banner}

      {showForm && canAct ? (
        <div className="mb-4 grid gap-3 rounded-input bg-canvas p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Version" htmlFor="policy-version">
            <TextInput id="policy-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="launch-2026-11-experiment" />
          </Field>
          <Field label="Name" htmlFor="policy-name">
            <TextInput id="policy-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="November experiment" />
          </Field>
          <Field label="Base fare (₹)" htmlFor="policy-base">
            <TextInput id="policy-base" inputMode="decimal" value={baseRupees} onChange={(e) => setBaseRupees(e.target.value)} />
          </Field>
          <Field label="Per road km (₹)" htmlFor="policy-km">
            <TextInput id="policy-km" inputMode="decimal" value={perKm} onChange={(e) => setPerKm(e.target.value)} />
          </Field>
          <Field label="Per billable kg (₹)" htmlFor="policy-kg">
            <TextInput id="policy-kg" inputMode="decimal" value={perKg} onChange={(e) => setPerKg(e.target.value)} />
          </Field>
          <Field label="Commission (%)" htmlFor="policy-commission">
            <TextInput id="policy-commission" inputMode="decimal" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button onClick={() => void createDraft()} disabled={!version.trim() || !name.trim()}>
              Save as draft
            </Button>
            <p className="mt-2 text-xs text-ink-500">
              Tunables you do not set here fall back to the compiled launch defaults. A draft changes no
              price until it is activated, and an invalid policy refuses to activate.
            </p>
          </div>
        </div>
      ) : null}

      {query.isPending ? (
        <LoadingBlock lines={3} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : policies.length === 0 ? (
        <EmptyState title="No policies" body="The launch policy should be here; check the migration ran." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-500 uppercase">
              <tr>
                <th className="py-2 pr-3 font-semibold">Version</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Base</th>
                <th className="py-2 pr-3 font-semibold">Per km</th>
                <th className="py-2 pr-3 font-semibold">Per kg</th>
                <th className="py-2 pr-3 font-semibold">Commission</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {policies.map((policy) => (
                <tr key={policy.id}>
                  <td className="py-2 pr-3 font-semibold text-ink-900">
                    {policy.version}
                    <p className="text-xs font-normal text-ink-500">{policy.name}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge value={policy.status} />
                  </td>
                  <td className="tabular py-2 pr-3 text-ink-700">{inr(Number(policy.params.baseFarePaise ?? 0))}</td>
                  <td className="tabular py-2 pr-3 text-ink-700">
                    {policy.params.routeRatePaisePerKm === undefined ? '—' : `₹${(Number(policy.params.routeRatePaisePerKm) / 100).toFixed(2)}`}
                  </td>
                  <td className="tabular py-2 pr-3 text-ink-700">
                    {policy.params.weightRatePaisePerKg === undefined ? '—' : `₹${(Number(policy.params.weightRatePaisePerKg) / 100).toFixed(2)}`}
                  </td>
                  <td className="tabular py-2 pr-3 text-ink-700">
                    {policy.params.commissionRate === undefined ? '—' : `${Math.round(Number(policy.params.commissionRate) * 1000) / 10}%`}
                  </td>
                  <td className="py-2">
                    {canAct && policy.status !== 'active' ? (
                      <Button variant="tertiary" onClick={() => void activate(policy)}>
                        Activate
                      </Button>
                    ) : (
                      <span className="text-xs text-ink-500">{policy.status === 'active' ? 'live now' : '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- benchmarks

function BenchmarksPanel({ canAct }: { canAct: boolean }) {
  const client = useQueryClient();
  const { run, banner } = useFailure();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    provider: 'India Post',
    service: 'Speed Post',
    category: 'documents',
    weight_band: 'up to 0.5 kg',
    amount_rupees: '',
    source_url: '',
    retrieved_at: toLocalInput(new Date()),
  });

  const query = useQuery({
    queryKey: ['admin', 'geo', 'benchmarks'],
    queryFn: () => api.get<{ items: AdminBenchmark[]; note?: string }>('/admin/geo/benchmarks'),
  });

  async function record() {
    const ok = await run(() =>
      api.post('/admin/geo/benchmarks', {
        provider: form.provider.trim(),
        service: form.service.trim(),
        category: form.category.trim(),
        weight_band: form.weight_band.trim(),
        amount_paise: Math.round(Number(form.amount_rupees) * 100),
        source_url: form.source_url.trim(),
        retrieved_at: toIsoWithOffset(form.retrieved_at),
      }),
    );
    if (ok) {
      void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
      setShowForm(false);
    }
  }

  async function remove(benchmark: AdminBenchmark) {
    const ok = await run(() => api.delete(`/admin/geo/benchmarks/${benchmark.id}`));
    if (ok) void client.invalidateQueries({ queryKey: ['admin', 'geo'] });
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const benchmarks = query.data?.items ?? [];

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Postal benchmarks</h3>
          <p className="text-sm text-ink-500">
            Third-party tariffs, recorded with their source. They never enter our prices and no saving is
            claimed from them automatically.
          </p>
        </div>
        {canAct ? (
          <Button variant="secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'Record a tariff'}
          </Button>
        ) : null}
      </div>

      {banner}

      {showForm && canAct ? (
        <div className="mb-4 grid gap-3 rounded-input bg-canvas p-3 sm:grid-cols-2">
          <Field label="Provider" htmlFor="bm-provider">
            <TextInput id="bm-provider" value={form.provider} onChange={set('provider')} />
          </Field>
          <Field label="Service" htmlFor="bm-service">
            <TextInput id="bm-service" value={form.service} onChange={set('service')} />
          </Field>
          <Field label="Category" htmlFor="bm-category">
            <TextInput id="bm-category" value={form.category} onChange={set('category')} />
          </Field>
          <Field label="Weight band" htmlFor="bm-band">
            <TextInput id="bm-band" value={form.weight_band} onChange={set('weight_band')} />
          </Field>
          <Field label="Amount (₹)" htmlFor="bm-amount">
            <TextInput id="bm-amount" inputMode="decimal" value={form.amount_rupees} onChange={set('amount_rupees')} />
          </Field>
          <Field label="Retrieved" htmlFor="bm-when">
            <TextInput id="bm-when" type="datetime-local" value={form.retrieved_at} onChange={set('retrieved_at')} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Source URL" htmlFor="bm-source" hint="Where you read this tariff. Required.">
              <TextInput id="bm-source" value={form.source_url} onChange={set('source_url')} placeholder="https://..." />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button
              onClick={() => void record()}
              disabled={!form.provider.trim() || !form.service.trim() || !form.source_url.trim() || !form.amount_rupees.trim()}
            >
              Save benchmark
            </Button>
          </div>
        </div>
      ) : null}

      {query.isPending ? (
        <LoadingBlock lines={2} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : benchmarks.length === 0 ? (
        <EmptyState
          title="No benchmarks recorded"
          body="Nothing has been read from a postal tariff page and recorded here, so the product shows no comparison and claims no saving."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-500 uppercase">
              <tr>
                <th className="py-2 pr-3 font-semibold">Provider</th>
                <th className="py-2 pr-3 font-semibold">Category</th>
                <th className="py-2 pr-3 font-semibold">Weight band</th>
                <th className="py-2 pr-3 font-semibold">Amount</th>
                <th className="py-2 pr-3 font-semibold">Source</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {benchmarks.map((b) => (
                <tr key={b.id}>
                  <td className="py-2 pr-3 text-ink-900">
                    {b.provider} · {b.service}
                  </td>
                  <td className="py-2 pr-3 text-ink-700">{b.category}</td>
                  <td className="py-2 pr-3 text-ink-700">{b.weight_band}</td>
                  <td className="tabular py-2 pr-3 font-semibold text-ink-900">{inr(b.amount_paise)}</td>
                  <td className="py-2 pr-3 text-xs">
                    <a className="text-brand-700 underline underline-offset-2" href={b.source_url} target="_blank" rel="noreferrer">
                      {hostOf(b.source_url)}
                    </a>
                  </td>
                  <td className="py-2">
                    {canAct ? (
                      <Button variant="tertiary" onClick={() => void remove(b)}>
                        Delete
                      </Button>
                    ) : (
                      <span className="text-xs text-ink-500">read only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The benchmark schema wants an offset-aware timestamp; the browser knows its own offset. */
function toIsoWithOffset(localValue: string): string {
  const date = new Date(localValue);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** A stored source URL is staff-entered, so a malformed one must not break the table. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

/** Both halves are needed together, and a blank field is not a coordinate. */
function coordsParseable(lat: string, lng: string): boolean {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}
