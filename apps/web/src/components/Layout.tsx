import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useSession } from "../lib/session";
import { useOnline, useUnreadChats, useUnreadNotifications } from "../lib/hooks";
import { Button, cn } from "./ui";
import { DocIcon, LogoutIcon, ParcelIcon, RouteIcon, UserIcon } from "./icons";

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
  { to: "/send", label: "Send a parcel" },
  { to: "/bookings", label: "My parcels" },
  { to: "/trips", label: "Travelling" },
  { to: "/help", label: "Help" },
];

const MOBILE_NAV = [
  { to: "/", label: "Home", icon: ParcelIcon },
  { to: "/send", label: "Send", icon: DocIcon },
  { to: "/bookings", label: "Parcels", icon: ParcelIcon },
  { to: "/trips", label: "Trips", icon: RouteIcon },
  { to: "/profile", label: "Account", icon: UserIcon },
];

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

/**
 * How many things are waiting for the signed-in person: unread messages and unread alerts.
 *
 * Both counts come from the server, which is the only place that knows what has been read. Capped so
 * a bad number cannot break the header layout.
 */
function useUnreadTotal(signedIn: boolean) {
  const chats = useUnreadChats(signedIn);
  const alerts = useUnreadNotifications(signedIn);
  const total = (chats.data?.total_unread ?? 0) + (alerts.data?.unread_count ?? 0);
  return { total, ready: Boolean(chats.data || alerts.data) };
}

function UnreadBadge({ total, className }: { total: number; className?: string }) {
  if (total <= 0) return null;
  return (
    <span
      className={cn(
        "tabular grid min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-bold text-white",
        className,
      )}
      aria-label={`${total} unread`}
    >
      {total > 99 ? '99+' : total}
    </span>
  );
}

function navLinkClass(isActive: boolean) {
  return cn(
    "rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
    isActive
      ? "bg-brand-600 text-white shadow-sm"
      : "text-ink-700 hover:bg-brand-50 hover:text-ink-900",
  );
}

export function Layout() {
  const { user, status, isStaff, signOut } = useSession();
  const online = useOnline();
  const unread = useUnreadTotal(Boolean(user));
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The landing page owns its own full-bleed hero, so it must not be boxed by the container.
  const isHome = pathname === "/";
  // The transparent header shows the hero photograph through it; once content scrolls beneath,
  // a light tint and hairline fade in so the links stay legible over anything.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />

      <header
        className={cn(
          "sticky top-0 z-30 transition-[background-color,border-color,box-shadow] duration-300",
          isHome && !scrolled
            ? "border-b border-transparent bg-transparent"
            : "border-b border-line bg-surface/85 shadow-card backdrop-blur-md",
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link
            to="/"
            className={cn(
              "shrink-0 rounded-input transition-colors",
              // The wordmark has an opaque white backing, so over the photograph it sits on a
              // frosted chip instead of floating as a white rectangle.
              isHome && !scrolled && "bg-white/90 px-2.5 py-1.5 shadow-card backdrop-blur-md",
            )}
            aria-label="Parcel Yatra home"
          >
            <Wordmark />
          </Link>

          <nav className="hidden items-center gap-1.5 md:flex" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => navLinkClass(isActive)}
              >
                {item.label}
              </NavLink>
            ))}
            {isStaff ? (
              <NavLink
                to="/admin"
                className={({ isActive }) => navLinkClass(isActive)}
              >
                Operations
              </NavLink>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {status === 'loading' ? (
              // The shape of the signed-in cluster, so the header does not change width when the
              // answer arrives. A Sign In button here would be a promise the session may break.
              <div className="flex items-center gap-2" aria-busy="true" aria-live="polite">
                <span className="sr-only">Checking your session</span>
                <span className="skeleton hidden h-9 w-24 rounded-input sm:block" aria-hidden="true" />
                <span className="skeleton h-10 w-10 rounded-full" aria-hidden="true" />
              </div>
            ) : user ? (
              <>
                <Link
                  to="/profile"
                  className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-ink-700 hover:bg-brand-50 sm:flex"
                >
                  {user.name ? user.name.split(" ")[0] : "Account"}
                  <UnreadBadge total={unread.total} />
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut().then(() => navigate("/"))}
                  className="grid h-10 w-10 place-items-center rounded-full text-ink-500 hover:bg-brand-50 hover:text-ink-900"
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
                  className="hidden rounded-full px-3 py-2 text-sm font-medium text-ink-700 hover:bg-brand-50 sm:inline-block"
                >
                  Help
                </Link>
                <Button size="sm" onClick={() => navigate("/login")}>
                  Sign in
                </Button>
              </div>
            )}
          </div>
        </div>

        {!online ? (
          <div
            className="border-t border-line bg-canvas px-4 py-2 text-center text-sm text-ink-500"
            role="status"
          >
            You’re offline. Changes will sync when the connection returns.
          </div>
        ) : null}
      </header>

      <main
        className={
          isHome
            ? "flex-1 pb-28 md:pb-16"
            : "mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-28 sm:px-6 md:pb-16"
        }
      >
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

            <nav
              className="grid grid-cols-2 gap-x-10 gap-y-1 text-sm sm:grid-cols-3"
              aria-label="Footer"
            >
              {(
                [
                  ["/pricing", "Pricing"],
                  ["/prohibited", "Prohibited items"],
                  ["/safety", "Safety"],
                  ["/help", "Help"],
                  ["/terms", "Terms"],
                  ["/privacy", "Privacy"],
                  ["/grievance", "Grievance officer"],
                ] as Array<[string, string]>
              ).map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  className="py-1 text-ink-500 hover:text-ink-900 hover:underline"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-ink-500">
            <p>
              Parcels are not insured and live location is not tracked. We don’t
              carry cash, jewellery, medicines, electronics or passports.
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
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-brand-700"
                    : "text-ink-500 hover:text-ink-900",
                )
              }
            >
              <span className="relative">
                <item.icon size={20} />
                {item.to === "/profile" ? (
                  <UnreadBadge total={unread.total} className="absolute -right-3 -top-2" />
                ) : null}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
