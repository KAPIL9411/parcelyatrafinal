import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingBlock, Card } from './components/ui';
import { useSession } from './lib/session';

import { Landing } from './screens/Landing';
import { Login } from './screens/Login';
import { Send } from './screens/Send';
import { Bookings } from './screens/Bookings';
import { BookingDetail } from './screens/BookingDetail';
import { Trips } from './screens/Trips';
import { NewTrip } from './screens/NewTrip';
import { Verification } from './screens/Verification';
import { Profile } from './screens/Profile';
import { Admin } from './screens/Admin';
import { NotFound } from './screens/NotFound';
import {
  Grievance,
  Help,
  Pricing,
  Privacy,
  Prohibited,
  Safety,
  Terms,
} from './screens/StaticPages';

/**
 * Route-level loading is only used for the admin console, which most people never open. Every
 * sender-facing screen is in the main bundle because a 3G phone at a door should not wait on a
 * second network round-trip.
 */
const AdminLazy = lazy(async () => ({ default: Admin }));

function PageFallback() {
  return (
    <Card>
      <LoadingBlock lines={5} />
    </Card>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <PageFallback />;
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

function RequireStaff({ children }: { children: ReactNode }) {
  const { user, loading, isStaff } = useSession();

  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login?next=%2Fadmin" replace />;
  if (!isStaff) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <h1 className="text-xl font-semibold text-ink-900">Staff access only</h1>
        <p className="mt-2 text-sm text-ink-700">
          This area is limited to Parcel Yatra operations staff. Nothing here is available to a normal account.
        </p>
      </Card>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="login" element={<Login />} />

          <Route
            path="send"
            element={
              <RequireAuth>
                <Send />
              </RequireAuth>
            }
          />
          <Route
            path="bookings"
            element={
              <RequireAuth>
                <Bookings />
              </RequireAuth>
            }
          />
          <Route
            path="bookings/:bookingId"
            element={
              <RequireAuth>
                <BookingDetail />
              </RequireAuth>
            }
          />
          <Route
            path="trips"
            element={
              <RequireAuth>
                <Trips />
              </RequireAuth>
            }
          />
          <Route
            path="trips/new"
            element={
              <RequireAuth>
                <NewTrip />
              </RequireAuth>
            }
          />
          <Route
            path="verification"
            element={
              <RequireAuth>
                <Verification />
              </RequireAuth>
            }
          />
          <Route
            path="profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route
            path="admin"
            element={
              <RequireStaff>
                <Suspense fallback={<PageFallback />}>
                  <AdminLazy />
                </Suspense>
              </RequireStaff>
            }
          />
          <Route path="pricing" element={<Pricing />} />
          <Route path="prohibited" element={<Prohibited />} />
          <Route path="safety" element={<Safety />} />
          <Route path="help" element={<Help />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="grievance" element={<Grievance />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
