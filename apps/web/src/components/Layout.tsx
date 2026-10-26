import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useSession } from '../lib/session';
import { useOnline } from '../lib/hooks';
import { Button, cn } from './ui';
import {
  DocIcon,
  LogoutIcon,
  ParcelIcon,
  RouteIcon,
  UserIcon,
} from './icons';

function Wordmark() {
  return (
    <img
      src="/logo.png"
      alt="Parcel Yatra"
      className="h-8 w-auto max-w-[170px] object-contain select-none"
    />
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

      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link to="/" className="shrink-0 rounded-input" aria-label="Parcel Yatra home">
            <Wordmark />
          </Link>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    '-my-1 border-b-2 py-1 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-brand-600 text-ink-900'
                      : 'border-transparent text-ink-500 hover:text-ink-900',
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
                    '-my-1 border-b-2 py-1 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-brand-600 text-ink-900'
                      : 'border-transparent text-ink-500 hover:text-ink-900',
                  )
                }
              >
                Operations
              </NavLink>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {user ? (
              <>
                <Link
                  to="/profile"
                  className="hidden rounded-input px-3 py-2 text-sm font-medium text-ink-700 hover:bg-canvas sm:inline-block"
                >
                  {user.name ? user.name.split(' ')[0] : 'Account'}
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut().then(() => navigate('/'))}
                  className="grid h-10 w-10 place-items-center rounded-full text-ink-500 hover:bg-canvas hover:text-ink-900"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogoutIcon size={19} />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/help"
                  className="hidden rounded-input px-3 py-2 text-sm font-medium text-ink-500 hover:text-ink-900 sm:inline-block"
                >
                  Help
                </Link>
                <Button size="sm" onClick={() => navigate('/login')}>
                  Sign in
                </Button>
              </div>
            )}
          </div>
        </div>

        {!online ? (
          <div className="border-t border-line bg-canvas px-4 py-2 text-center text-sm text-ink-500" role="status">
            You’re offline. Changes will sync when the connection returns.
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-28 sm:px-6 md:pb-16">
        <Outlet />
      </main>

      <footer className="mt-auto border-t border-line bg-surface pb-24 md:pb-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm space-y-3">
              <Wordmark />
              <p className="text-sm leading-relaxed text-ink-500">
                Inter-city parcels carried by people already making the journey.
              </p>
            </div>

            <nav className="grid grid-cols-2 gap-x-10 gap-y-1 text-sm sm:grid-cols-3" aria-label="Footer">
              {([
                ['/pricing', 'Pricing'],
                ['/prohibited', 'Prohibited items'],
                ['/safety', 'Safety'],
                ['/help', 'Help'],
                ['/terms', 'Terms'],
                ['/privacy', 'Privacy'],
                ['/grievance', 'Grievance officer'],
              ] as Array<[string, string]>).map(([to, label]) => (
                <Link key={to} to={to} className="py-1 text-ink-500 hover:text-ink-900 hover:underline">
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-ink-500">
            <p>
              Parcels are not insured and live location is not tracked. We don’t carry cash, jewellery, medicines,
              electronics or passports.
            </p>
          </div>
        </div>
      </footer>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Mobile"
      >
        <div className="mx-auto grid max-w-md grid-cols-5">
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  isActive ? 'text-brand-700' : 'text-ink-500 hover:text-ink-900',
                )
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
