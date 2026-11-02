import { useEffect, type MouseEvent, type ReactNode } from "react";
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
import { DownloadButton } from "./DownloadButton";
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

/** Marketing sections on the landing page, reachable from every route. */
const SECTION_LINKS = [
  { id: "app", label: "App preview" },
  { id: "how-it-works", label: "How it works" },
  { id: "safety", label: "Safety" },
  { id: "faq", label: "FAQ" },
];

const MOBILE_NAV = [
  { to: "/", label: "Home", icon: ParcelIcon },
  { to: "/send", label: "Send", icon: DocIcon },
  { to: "/bookings", label: "Parcels", icon: ParcelIcon },
  { to: "/trips", label: "Trips", icon: RouteIcon },
  { to: "/profile", label: "Account", icon: UserIcon },
];

/** Routes that belong to the signed-in web app, where the tab bar still makes sense. */
const APP_ROUTES = [
  "/send",
  "/bookings",
  "/parcels",
  "/trips",
  "/verification",
  "/profile",
  "/admin",
];

function scrollToSection(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  element.scrollIntoView({ behavior: "smooth" });
  window.history.replaceState(null, "", `/#${id}`);
  return true;
}

function ScrollToTop() {
  const location = useLocation();
  const target = (location.state as { scrollTo?: string } | null)?.scrollTo;

  useEffect(() => {
    // A cross-page section link navigates home with a target; the landing page is committed by
    // the time effects run, so the section is there to scroll to. A reloaded `/#section` URL gets
    // the same treatment, which the native anchor jump cannot be trusted to survive.
    if (target && scrollToSection(target)) return;
    const hash = location.hash.slice(1);
    if (hash && scrollToSection(hash)) return;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname, location.key, location.hash, target]);

  return null;
}

/**
 * A link to a landing-page section that also works from another route: navigate home first and let
 * `ScrollToTop` scroll once the landing page has committed. `scroll-mt-*` on each section clears the
 * sticky header.
 */
function SectionLink({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  function jump(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (pathname !== "/") {
      navigate("/", { state: { scrollTo: id } });
      return;
    }
    scrollToSection(id);
  }

  return (
    <a href={`/#${id}`} onClick={jump} className={className}>
      {children}
    </a>
  );
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

export function Layout() {
  const { user, status, isStaff, signOut } = useSession();
  const online = useOnline();
  const unread = useUnreadTotal(Boolean(user));
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The landing page owns its own full-bleed sections, so it must not be boxed by the container.
  const isHome = pathname === "/";
  // The app-style tab bar is for the signed-in product screens, not the marketing site.
  const showAppNav = APP_ROUTES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />

      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 shadow-card backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link
            to="/"
            className="shrink-0 rounded-input"
            aria-label="Parcel Yatra home"
          >
            <Wordmark />
          </Link>

          <nav
            className="hidden items-center gap-1 lg:flex"
            aria-label="Sections"
          >
            {SECTION_LINKS.map((item) => (
              <SectionLink
                key={item.id}
                id={item.id}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-brand-50 hover:text-ink-900"
              >
                {item.label}
              </SectionLink>
            ))}
            <Link
              to="/help"
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-brand-50 hover:text-ink-900"
            >
              Help
            </Link>
            {isStaff ? (
              <Link
                to="/admin"
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-brand-50 hover:text-ink-900"
              >
                Operations
              </Link>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block">
              <DownloadButton size="sm" label="Get the app" />
            </div>

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
              pathname !== "/login" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate("/login")}
                >
                  Sign in
                </Button>
              )
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
        className={cn(
          "flex-1",
          !isHome && "mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6",
          showAppNav && "pb-28 md:pb-16",
        )}
      >
        <Outlet />
      </main>

      <footer
        className={cn(
          "mt-auto border-t border-line bg-surface",
          showAppNav && "pb-24 md:pb-0",
        )}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm space-y-3">
              <Wordmark />
              <p className="text-sm leading-relaxed text-ink-500">
                Inter-city parcels carried by people already making the journey.
                The Android app is where parcels are posted, matched and handed
                over.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <DownloadButton size="sm" />
                {!user && pathname !== "/login" ? (
                  <Link
                    to="/login"
                    className="text-sm font-semibold text-brand-700 underline underline-offset-4"
                  >
                    Sign in
                  </Link>
                ) : null}
              </div>
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

      {showAppNav ? (
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
      ) : null}
    </div>
  );
}
