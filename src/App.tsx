import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AuthPage from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import LegalPage from "./pages/LegalPage";
import OAuthConsentPage from "./pages/OAuthConsentPage";
import { useAuth } from "./hooks/useAuth";
import { useAppRuntime } from "./hooks/useAppRuntime";
import { useWeekStore } from "./hooks/useWeekStore";
import { ThemeProvider } from "./contexts/ThemeContext";
import StreexLogo from "./components/StreexLogo";
import AppUpdateNotice from "./components/AppUpdateNotice";
import { Button } from "./components/ui/button";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { lifecycleDebug } from "./lib/appLifecycle";
import { AnimatedStreexLogo, StreexMotionBackground } from "./components/StreexMotionBrand";

const AppShell = lazy(() => import("./pages/AppShell"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const WeeklyEntryPage = lazy(() => import("./pages/WeeklyEntryPage"));
const ComparisonsPage = lazy(() => import("./pages/ComparisonsPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const CareerPage = lazy(() => import("./pages/CareerPage"));
const JourneyPage = lazy(() => import("./pages/JourneyPage"));
const MonthlyRecapPage = lazy(() => import("./pages/MonthlyRecapPage"));
const LettersPage = lazy(() => import("./pages/LettersPage"));
const AssistantPage = lazy(() => import("./pages/AssistantPage"));
const DeepInsightsPage = lazy(() => import("./pages/DeepInsightsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <StreexLogo className="h-9" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          Loading workspace
        </p>
      </div>
    </div>
  );
}

const App = () => {
  useAppLifecycle();
  const { user, session, loading: authLoading, signIn, signUp, signOut } = useAuth();
  const store = useWeekStore(user);
  const { access, updateNotice, dismissUpdateNotice } = useAppRuntime(user, session, signOut);

  if (authLoading) {
    lifecycleDebug("splash shown", { reason: "auth session restoration" });
    return (
      <div className="streex-premium-shell min-h-screen flex flex-col items-center justify-center gap-7 px-6 text-center">
        <StreexMotionBackground density="splash" />
        <AnimatedStreexLogo variant="splash" />
        <p className="relative z-10 text-[11px] sm:text-xs uppercase tracking-[0.34em] text-white/50 font-semibold">
          Gig Earnings Tracker
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/privacy" element={<LegalPage type="privacy" />} />
            <Route path="/terms" element={<LegalPage type="terms" />} />
            <Route path="/oauth/consent" element={<OAuthConsentPage user={null} signIn={signIn} signUp={signUp} />} />
            <Route path="*" element={<AuthPage signIn={signIn} signUp={signUp} />} />
          </Routes>
        </BrowserRouter>
      </>
    );
  }

  if (access.loading) {
    lifecycleDebug("splash shown", { reason: "initial account access validation", userId: user.id });
    return (
      <div className="streex-premium-shell min-h-screen flex flex-col items-center justify-center gap-7 px-6 text-center">
        <StreexMotionBackground density="splash" />
        <AnimatedStreexLogo variant="splash" />
        <p className="relative z-10 text-[11px] sm:text-xs uppercase tracking-[0.34em] text-white/50 font-semibold">
          Preparing Streex
        </p>
      </div>
    );
  }

  if (access.status !== "active") {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex items-center justify-center bg-background px-5">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 text-center">
            <StreexLogo className="h-10 mx-auto" />
            <div className="space-y-2">
              <h1 className="text-xl font-bold">Account restricted</h1>
              <p className="text-sm text-muted-foreground">
                Your account is currently restricted. Please contact support.
              </p>
            </div>
            <Button type="button" onClick={signOut} className="w-full">
              Sign Out
            </Button>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        {updateNotice && (
          <AppUpdateNotice
            latestVersion={updateNotice.latestVersion}
            message={updateNotice.message}
            required={updateNotice.required}
            onLater={dismissUpdateNotice}
            onSignOut={signOut}
          />
        )}
        <Suspense fallback={<RouteLoadingFallback />}>
          <BrowserRouter>
            <Routes>
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/oauth/consent" element={<OAuthConsentPage user={user} signIn={signIn} signUp={signUp} />} />
              <Route element={<AppShell store={store} user={user} onSignOut={signOut} />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/entry" element={<WeeklyEntryPage />} />
                <Route path="/compare" element={<ComparisonsPage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/achievements" element={<AchievementsPage />} />
                <Route path="/career" element={<CareerPage />} />
                <Route path="/journey" element={<JourneyPage />} />
                <Route path="/recap" element={<MonthlyRecapPage />} />
                <Route path="/letters" element={<LettersPage />} />
                <Route path="/assistant" element={<AssistantPage />} />
                <Route path="/deep-insights" element={<DeepInsightsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/admin" element={<AdminPage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </Suspense>
      </TooltipProvider>
    </ThemeProvider>
  );
};

export default App;
