import { Link, Route, Routes } from 'react-router-dom';
import { RequireAdmin, RequireAuth } from './auth/guards';
import { Header } from './components/Header';
import { AccountPage } from './pages/Account';
import { AdminPage } from './pages/admin/Admin';
import { DashboardPage } from './pages/Dashboard';
import { KycPage } from './pages/Kyc';
import { LandingPage } from './pages/Landing';
import { LoginPage } from './pages/Login';
import { MatchDetailPage } from './pages/MatchDetail';
import { MatchesPage } from './pages/Matches';
import { RegisterPage } from './pages/Register';
import { RequestDetailPage } from './pages/RequestDetail';
import { RequestNewPage } from './pages/RequestNew';
import { RequestsSearchPage } from './pages/RequestsSearch';
import { TripDetailPage } from './pages/TripDetail';
import { TripNewPage } from './pages/TripNew';
import { TripsSearchPage } from './pages/TripsSearch';
import { VerifyEmailPage } from './pages/VerifyEmail';

function NotFound() {
  return (
    <div className="page narrow">
      <div className="card">
        <h1>Page not found</h1>
        <p className="muted">That page doesn't exist.</p>
        <Link className="btn" to="/">
          Go home
        </Link>
      </div>
    </div>
  );
}

export function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/kyc" element={<RequireAuth><KycPage /></RequireAuth>} />
          <Route path="/trips" element={<TripsSearchPage />} />
          <Route path="/trips/new" element={<RequireAuth><TripNewPage /></RequireAuth>} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/requests" element={<RequestsSearchPage />} />
          <Route path="/requests/new" element={<RequireAuth><RequestNewPage /></RequireAuth>} />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/matches" element={<RequireAuth><MatchesPage /></RequireAuth>} />
          <Route path="/matches/:id" element={<RequireAuth><MatchDetailPage /></RequireAuth>} />
          <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
          <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} CarryLink</span>
          <span className="muted">Verified travellers · Inspected items · Escrow-protected</span>
        </div>
      </footer>
    </>
  );
}
