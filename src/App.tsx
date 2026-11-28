import React, { useCallback, useState } from 'react';
import { BRAND_CONFIG } from './config/brand';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PrivacyBlurProvider } from './context/PrivacyBlurContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AmbientCanvas } from './components/LiquidGlass/AmbientCanvas';
import { CalmDots } from './components/CalmLoadingIndicator';
import { LandingPage } from './components/LandingPage';
import { ExperienceRatingPrompt } from './components/ExperienceRatingPrompt';
import type { ExperienceRatingRecord } from './core/experienceRatings';

function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      return await factory();
    }
  });
}

const AuthModal = lazyWithRetry(() =>
  import('./components/AuthModal').then((m) => ({ default: m.AuthModal }))
);

const AuthenticatedShell = lazyWithRetry(() =>
  import('./components/AuthenticatedShell').then((m) => ({ default: m.AuthenticatedShell }))
);

const BootLoader: React.FC = () => (
  <div className="min-h-dvh flex items-center justify-center p-6">
    <div className="glass-surface rounded-3xl px-8 py-7 text-center space-y-3">
      <div className="flex justify-center">
        <CalmDots className="text-sky-600 dark:text-sky-400" />
      </div>
      <p className="text-sm font-medium text-[#16243E] dark:text-[#E6EFFC]">
        Đang khởi tạo {BRAND_CONFIG.name}...
      </p>
    </div>
  </div>
);

const StudyCheckShell: React.FC = () => {
  const { user, profile, loading } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [hasUserRated, setHasUserRated] = useState(false);
  const [latestSubmittedRating, setLatestSubmittedRating] =
    useState<ExperienceRatingRecord | null>(null);
  const [ratingOpenRequest, setRatingOpenRequest] = useState<{
    id: number;
    initialStars?: 1 | 2 | 3 | 4 | 5;
  } | null>(null);

  const handleOpenRatingModal = useCallback((initialStars?: 1 | 2 | 3 | 4 | 5) => {
    setRatingOpenRequest({ id: Date.now() + Math.random(), initialStars });
  }, []);

  const handleRatingStatusChange = useCallback(
    (status: { hasRated: boolean; lastRecord?: ExperienceRatingRecord | null }) => {
      setHasUserRated(status.hasRated);
      if (status.lastRecord) {
        setLatestSubmittedRating(status.lastRecord);
      }
    },
    []
  );

  if (loading) {
    return <BootLoader />;
  }

  // Unauthenticated Landing Experience
  if (!user) {
    return (
      <>
        <LandingPage
          onOpenAuth={(mode) => {
            setAuthModalMode(mode);
            setAuthModalOpen(true);
          }}
          hasUserRated={hasUserRated}
          onOpenRatingModal={handleOpenRatingModal}
          latestSubmittedRating={latestSubmittedRating}
        />
        {authModalOpen && (
          <React.Suspense fallback={null}>
            <AuthModal
              open={authModalOpen}
              initialMode={authModalMode}
              onClose={() => setAuthModalOpen(false)}
            />
          </React.Suspense>
        )}
        <ExperienceRatingPrompt
          externalOpenRequest={ratingOpenRequest}
          onStatusChange={handleRatingStatusChange}
        />
      </>
    );
  }

  // Authenticated Workspace Shell (code-split cleanly on demand)
  return (
    <>
      <React.Suspense fallback={<BootLoader />}>
        <AuthenticatedShell />
      </React.Suspense>
      <ExperienceRatingPrompt
        userUid={user.uid}
        userEmailVerified={user.emailVerified}
        defaultDisplayName={profile?.displayName || user.displayName}
        defaultGrade={profile?.grade}
        externalOpenRequest={ratingOpenRequest}
        onStatusChange={handleRatingStatusChange}
      />
    </>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <PrivacyBlurProvider>
          <AmbientCanvas>
            <StudyCheckShell />
          </AmbientCanvas>
        </PrivacyBlurProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
