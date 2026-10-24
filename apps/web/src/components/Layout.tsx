import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useSession } from '../lib/session';
import { useOnline } from '../lib/hooks';
import { Button, cn } from './ui';
import {
  AlertTriangleIcon,
  DocIcon,
  LogoutIcon,
  ParcelIcon,
  RouteIcon,
  UserIcon,
} from './icons';

function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center">
      <img
        src="/logo.png"
        alt="Parcel Yatra"
        className="h-9 w-auto max-w-[180px] object-contain select-none"
      />
    </span>
  );
}

const NAV = [
  { to: '/send', label: 'Send a parcel' },
  { to: '/bookings', label: 'My parcels' },
  { to: '/trips', label: 'Travelling' },
  { to: '/help', label: 'Help' },
];

const MOBILE_NAV = [
  { to: '/', label: 'Home', icon: ParcelIcon },
  { to: '/send', label: 'Send', icon: DocIcon },
  { to: '/bookings', label: 'Parcels', icon: ParcelIcon },
  { to: '/trips', label: 'Trips', icon: RouteIcon },
  { to: '/profile', label: 'Account', icon: UserIcon },
];

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export function Layout() {
  const { user, isStaff, signOut } = useSession();
  const online = useOnline();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />

      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="shrink-0 rounded-input" aria-label="Parcel Yatra home">
            <Wordmark />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-input px-3 py-2 text-sm font-semibold transition-colors',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-canvas',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            {isStaff ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    'rounded-input px-3 py-2 text-sm font-semibold transition-colors',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-canvas',
                  )
                }
              >
                Operations
              </NavLink>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-accent-600/50 bg-accent-500/15 px-2.5 py-1 text-xs font-semibold text-warn-600 sm:inline-flex">
              <AlertTriangleIcon size={13} aria-hidden="true" />
              Test mode
            </span>

            {user ? (
              <div className="flex items-center gap-1">
                <Link
                  to="/profile"
                  className="hidden rounded-input px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-canvas sm:inline-block"
                >
                  {user.name ? user.name.split(' ')[0] : `…${user.phone_last4}`}
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut().then(() => navigate('/'))}
                  className="grid h-10 w-10 place-items-center rounded-full text-ink-500 hover:bg-canvas"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogoutIcon size={19} />
                </button>
              </div>
            ) : (
              <Button size="sm" onClick={() => navigate('/login')}>
                Sign in
              </Button>
            )}
          </div>
        </div>

        {!online ? (
          <div className="border-t border-warn-600/25 bg-warn-50 px-4 py-2 text-center text-sm text-warn-600" role="status">
            No connection. Changes will sync when you’re back.
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 md:pb-12">
        <Outlet />
      </main>

      <footer className="mt-auto border-t border-line bg-surface pb-24 md:pb-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm space-y-2">
              <Wordmark />
              <p className="text-sm text-ink-500">
                Inter-city parcels carried by people already making the journey. Bareilly ⇄ Delhi NCR and
                Bareilly ⇄ Lucknow at launch.
              </p>
            </div>

            <nav className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm" aria-label="Footer">
              {([
                ['/pricing', 'Pricing'],
                ['/prohibited', 'Prohibited items'],
                ['/safety', 'Safety'],
                ['/help', 'Help'],
                ['/terms', 'Terms (draft)'],
                ['/privacy', 'Privacy (draft)'],
                ['/grievance', 'Grievance officer'],
              ] as Array<[string, string]>).map(([to, label]) => (
                <Link key={to} to={to} className="py-1 text-ink-700 hover:text-brand-700 hover:underline">
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="mt-8 space-y-2 border-t border-line pt-5 text-xs text-ink-500">
            <p>
              <strong className="font-semibold text-warn-600">Test mode.</strong> No real money is charged and no
              real payout is made. This is a pilot build, not a production service.
            </p>
            <p>
              Your parcel is not insured. We don’t track the traveller’s live location. We don’t carry cash,
              jewellery, medicines, electronics or passports.
            </p>
          </div>
        </div>
      </footer>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Mobile"
      >
        <div className="grid grid-cols-5">
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold',
                  isActive ? 'text-brand-700' : 'text-ink-500',
                )
              }
            >
              <item.icon size={21} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
