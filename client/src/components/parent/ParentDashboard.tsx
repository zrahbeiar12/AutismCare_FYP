import React, { Suspense, lazy, useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '../layout/DashboardLayout';
import { DashboardHome } from './DashboardHome';
import { PARENT_WELCOME_STORAGE_KEY, ParentWelcomeWizard } from './ParentWelcomeWizard';
import { getParentNavigationItems } from './parentNavigation';
import { useLanguage } from '../../i18n/LanguageContext';

const ChildManagement = lazy(() => import('./ChildManagement').then((m) => ({ default: m.ChildManagement })));
const ScreeningSection = lazy(() => import('./ScreeningSection').then((m) => ({ default: m.ScreeningSection })));
const AppointmentsSection = lazy(() => import('./AppointmentsSection').then((m) => ({ default: m.AppointmentsSection })));
const ParentLabReports = lazy(() => import('./ParentLabReports').then((m) => ({ default: m.ParentLabReports })));
const ParentScreenings = lazy(() => import('./ParentScreenings').then((m) => ({ default: m.ParentScreenings })));
const ParentHomeAssignments = lazy(() =>
  import('./ParentHomeAssignments').then((m) => ({ default: m.ParentHomeAssignments })),
);
const ParentTherapyReports = lazy(() =>
  import('../reports/ParentTherapyReports').then((m) => ({ default: m.ParentTherapyReports })),
);
const FacialScreeningSection = lazy(() =>
  import('./screening/FacialScreeningSection').then((m) => ({ default: m.FacialScreeningSection })),
);
const ParentMessages = lazy(() => import('./ParentMessages').then((m) => ({ default: m.ParentMessages })));

function SectionFallback() {
  return (
    <div className="flex min-h-[32vh] items-center justify-center text-sm text-muted-foreground" role="status">
      Loading…
    </div>
  );
}

type Section =
  | 'home'
  | 'children'
  | 'messages'
  | 'home-activities'
  | 'therapy-reports'
  | 'screening-questionnaires'
  | 'facial-screening'
  | 'total-screenings'
  | 'book-appointment'
  | 'appointments'
  | 'lab-reports';

const VALID_SECTIONS: Section[] = [
  'home',
  'children',
  'messages',
  'home-activities',
  'therapy-reports',
  'screening-questionnaires',
  'facial-screening',
  'total-screenings',
  'book-appointment',
  'appointments',
  'lab-reports',
];

function isSection(s: string): s is Section {
  return VALID_SECTIONS.includes(s as Section);
}

/** Legacy deep links used `screening`; map to questionnaires hub. */
function normalizeSectionState(s: string): string {
  if (s === 'screening') return 'screening-questionnaires';
  return s;
}

interface AuthUser {
  token: string;
  role: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface ParentDashboardProps {
  user?: AuthUser;
  onLogout?: () => void;
}

export function ParentDashboard({ user, onLogout }: ParentDashboardProps) {
  const [currentSection, setCurrentSection] = useState<Section>('home');
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(PARENT_WELCOME_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const location = useLocation();
  const navigate = useNavigate();

  // Safety net: restore clicks if a dialog teardown left pointer-events disabled.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.pointerEvents = 'auto';
    }
  }, []);

  useEffect(() => {
    const st = (location.state || {}) as { section?: string; openConversationId?: string };
    if (!st.section && !st.openConversationId) return;

    const raw = st.section;
    const s = raw ? normalizeSectionState(raw) : undefined;
    if (st.openConversationId) {
      setOpenConversationId(st.openConversationId);
    }
    if (s && isSection(s)) {
      setCurrentSection(s);
    } else if (st.openConversationId) {
      setCurrentSection('messages');
    }

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    if (currentSection !== 'messages') setOpenConversationId(null);
  }, [currentSection]);

  const { t } = useLanguage();
  const navigation = getParentNavigationItems(t);

  const handleSectionChange = (section: string) => {
    setCurrentSection(section as Section);
  };

  const handleNavigate = (section: string) => {
    if (isSection(section)) setCurrentSection(section);
  };
  const handleOpenWelcomeTour = useCallback(() => {
    // Force a closed -> open transition so replay is reliable across all browsers.
    setWelcomeOpen(false);
    if (typeof window !== "undefined") {
      window.setTimeout(() => setWelcomeOpen(true), 0);
      return;
    }
    setWelcomeOpen(true);
  }, []);

  const clearOpenConversation = useCallback(() => setOpenConversationId(null), []);

  const renderSection = () => {
    switch (currentSection) {
      case 'home':
        return (
          <DashboardHome onNavigate={handleNavigate} onOpenWelcomeTour={handleOpenWelcomeTour} />
        );
      case 'children':
        return (
          <Suspense fallback={<SectionFallback />}>
            <ChildManagement onQuickScreen={() => setCurrentSection('screening-questionnaires')} />
          </Suspense>
        );
      case 'messages':
        return (
          <Suspense fallback={<SectionFallback />}>
            <ParentMessages
              initialConversationId={openConversationId}
              onInitialConversationHandled={clearOpenConversation}
            />
          </Suspense>
        );
      case 'home-activities':
        return (
          <Suspense fallback={<SectionFallback />}>
            <ParentHomeAssignments />
          </Suspense>
        );
      case 'therapy-reports':
        return (
          <Suspense fallback={<SectionFallback />}>
            <ParentTherapyReports />
          </Suspense>
        );
      case 'screening-questionnaires':
        return (
          <Suspense fallback={<SectionFallback />}>
            <ScreeningSection />
          </Suspense>
        );
      case 'facial-screening':
        return (
          <Suspense fallback={<SectionFallback />}>
            <FacialScreeningSection />
          </Suspense>
        );
      case 'total-screenings':
        return (
          <Suspense fallback={<SectionFallback />}>
            <ParentScreenings />
          </Suspense>
        );
      case 'book-appointment':
        return (
          <Suspense fallback={<SectionFallback />}>
            <AppointmentsSection formOnly initialShowBooking />
          </Suspense>
        );
      case 'appointments':
        return (
          <Suspense fallback={<SectionFallback />}>
            <AppointmentsSection />
          </Suspense>
        );
      case 'lab-reports':
        return (
          <Suspense fallback={<SectionFallback />}>
            <ParentLabReports />
          </Suspense>
        );
      default:
        return <DashboardHome onNavigate={handleNavigate} />;
    }
  };

  return (
    <>
      {/* Mount wizard only while open to guarantee no stale overlay blocks clicks. */}
      {welcomeOpen ? (
        <ParentWelcomeWizard open={welcomeOpen} onOpenChange={setWelcomeOpen} />
      ) : null}
      <DashboardLayout
        navigation={navigation}
        currentSection={currentSection}
        onSectionChange={handleSectionChange}
        onLogout={onLogout}
        brandHref="/parent-dashboard"
      >
        {renderSection()}
      </DashboardLayout>
    </>
  );
}
