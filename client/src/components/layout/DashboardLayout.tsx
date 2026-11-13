import { useState, useContext, useEffect } from 'react';
import { Button } from '../ui/button';
import { ThemeToggleButton } from '../ui/ThemeToggleButton';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Settings, LogOut, ChevronDown, ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { NotificationBell } from '../notifications/NotificationBell';
import { cn } from '../ui/utils';
import { MainLayout } from './MainLayout';
import { useLanguage } from '../../i18n/LanguageContext';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';

interface NavigationChild {
  id: string;
  label: string;
}

export interface NavigationItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  children?: NavigationChild[];
  group?: string;
  /** If set, sidebar uses React Router navigation instead of onSectionChange */
  to?: string;
  /** Active when pathname.startsWith(this) — use for nested routes e.g. /parent/case/:id */
  activePathPrefix?: string;
}

export type DashboardLayoutVariant = 'default' | 'clinical';

interface DashboardLayoutProps {
  navigation: NavigationItem[];
  currentSection: string;
  onSectionChange: (section: string) => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  children: React.ReactNode;
  title?: string;
  onOpenNotifications?: () => void;
  /**
   * Optional top-bar cluster (e.g. Messages + NotificationBell). When set, replaces the default bell-only slot.
   */
  communicationCluster?: React.ReactNode;
  /** Clinical: white/slate shell + sky accents (no purple gradients). */
  variant?: DashboardLayoutVariant;
  /** When set, logo + title navigate here (e.g. `/parent-dashboard`). */
  brandHref?: string;
  /** Appended to `<main>` — use to override surface styles (e.g. transparent + custom background). */
  mainClassName?: string;
}

export function DashboardLayout({
  navigation,
  currentSection,
  onSectionChange,
  onLogout,
  onOpenSettings,
  children,
  title = "AutismCare",
  onOpenNotifications,
  communicationCluster,
  variant = 'default',
  brandHref,
  mainClassName,
}: DashboardLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedDropdown, setExpandedDropdown] = useState<string | null>(null);
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const location = useLocation();
  const { t } = useLanguage();

  // Safety net: if a closed dialog ever leaves pointer-events disabled on <body>, restore clicks.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.pointerEvents = 'auto';
    }
  }, []);

  const linkItemActive = (item: NavigationItem) => {
    if (!item.to) return false;
    if (item.activePathPrefix) return location.pathname.startsWith(item.activePathPrefix);
    return location.pathname === item.to;
  };

  useEffect(() => {
    const parent = navigation.find((item) =>
      item.children?.some((c) => c.id === currentSection)
    );
    if (parent) setExpandedDropdown(parent.id);
  }, [currentSection, navigation]);

  // Extract user initials for avatar
  const fullName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
  const initials = fullName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase();

  const activeNavClass =
    'border-l-4 border-blue-600 bg-blue-50 font-medium text-blue-700';
  const sidebarActiveClass =
    'rounded-xl border border-blue-200 bg-blue-50 text-blue-700 shadow-sm';
  const sidebarChildActiveClass =
    'rounded-lg border border-blue-200 bg-blue-50 font-medium text-blue-700';

  const renderMobileNavigation = () => (
    <nav className="max-h-[calc(100dvh-4rem)] space-y-1 overflow-y-auto rounded-2xl bg-white p-2">
      {navigation.map((item) => {
        const Icon = item.icon;
        const hasChildren = item.children && item.children.length > 0;
        const isParentActive = hasChildren && item.children!.some((c) => currentSection === c.id);
        const isExpanded = expandedDropdown === item.id;
        if (hasChildren) {
          return (
            <div key={item.id} className="rounded-xl">
              <button
                onClick={() => setExpandedDropdown(isExpanded ? null : item.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-left transition-colors ${
                  isParentActive ? activeNavClass : 'hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`h-5 w-5 ${isParentActive ? item.color : 'text-slate-500'}`} />
                  <span className={`font-medium ${isParentActive ? item.color : 'text-slate-700'}`}>{item.label}</span>
                </div>
                <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </button>
              {isExpanded && item.children!.map((child) => {
                const isChildActive = currentSection === child.id;
                return (
                  <button
                    key={child.id}
                    onClick={() => {
                      onSectionChange(child.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg py-2 pl-4 pr-3 text-left text-sm transition-colors ${
                      isChildActive ? sidebarChildActiveClass : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {child.label}
                  </button>
                );
              })}
            </div>
          );
        }
        const isActive = item.to ? linkItemActive(item) : currentSection === item.id;
        if (item.to) {
          return (
            <Link
              key={item.id}
              to={item.to}
              onClick={() => setMobileMenuOpen(false)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 transition-colors ${
                isActive ? activeNavClass : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? item.color : 'text-slate-500'}`} />
              <span className={`font-medium ${isActive ? item.color : 'text-slate-700'}`}>{item.label}</span>
            </Link>
          );
        }
        return (
          <button
            key={item.id}
            onClick={() => {
              onSectionChange(item.id);
              setMobileMenuOpen(false);
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 transition-colors ${
              isActive ? activeNavClass : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Icon className={`h-5 w-5 ${isActive ? item.color : 'text-slate-500'}`} />
            <span className={`font-medium ${isActive ? item.color : 'text-slate-700'}`}>{item.label}</span>
          </button>
        );
      })}
      {/* Settings + Logout live in the desktop sidebar footer; phones only see this menu, so repeat them here. */}
      <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
        {onOpenSettings ? (
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenSettings();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-slate-700 transition-colors hover:bg-slate-100"
          >
            <Settings className="h-5 w-5 text-slate-500" />
            <span className="font-medium">{t('shell.settings')}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            onLogout?.();
          }}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-amber-700 transition-colors hover:bg-amber-50"
        >
          <LogOut className="h-5 w-5" />
          <span className="font-medium">{t('shell.logout')}</span>
        </button>
      </div>
    </nav>
  );

  const renderSidebarNavigation = () => (
    <div className="flex h-full min-h-0 flex-col justify-between">
      <nav className="flex-1 space-y-2 overflow-y-auto">
        {navigation.map((item) => {
          const Icon = item.icon;
          const hasChildren = item.children && item.children.length > 0;
          const isParentActive = hasChildren && item.children!.some((c) => currentSection === c.id);
          const isExpanded = expandedDropdown === item.id;
          if (hasChildren) {
            return (
              <div key={item.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => setExpandedDropdown(isExpanded ? null : item.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 transition-colors ${
                    isParentActive ? sidebarActiveClass : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon className={`h-5 w-5 shrink-0 ${isParentActive ? item.color : 'text-slate-500'}`} />
                    <span className={`truncate ${isParentActive ? item.color : 'text-slate-700'}`}>{item.label}</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                {isExpanded && (
                  <div className="ml-4 space-y-1 border-l border-slate-200 pl-4">
                    {item.children!.map((child) => {
                      const isChildActive = currentSection === child.id;
                      return (
                        <button
                          type="button"
                          key={child.id}
                          onClick={() => onSectionChange(child.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            isChildActive ? sidebarChildActiveClass : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          {child.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          const isActive = item.to ? linkItemActive(item) : currentSection === item.id;
          if (item.to) {
            return (
              <Link
                key={item.id}
                to={item.to}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                  isActive ? sidebarActiveClass : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? item.color ?? 'text-blue-700' : 'text-slate-500'}`} />
                <span className={isActive ? item.color ?? 'font-medium text-blue-700' : 'text-slate-700'}>
                  {item.label}
                </span>
              </Link>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                isActive ? sidebarActiveClass : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? item.color ?? 'text-blue-700' : 'text-slate-500'}`} />
              <span className={isActive ? item.color ?? 'font-medium text-blue-700' : 'text-slate-700'}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-4 shrink-0 space-y-2 border-t border-slate-200 pt-4">
        {onOpenSettings ? (
          <Button variant="outline" className="w-full justify-start bg-white" onClick={onOpenSettings}>
            <Settings className="mr-2 h-4 w-4" />
            {t('shell.settings')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="w-full justify-start text-amber-700 hover:bg-amber-50 hover:text-amber-800"
          onClick={onLogout || (() => {})}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t('shell.logout')}
        </Button>
      </div>
    </div>
  );

  return (
    <MainLayout
      title={title}
      brandHref={brandHref}
      mobileMenuOpen={mobileMenuOpen}
      onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
      headerActions={
        <>
          {communicationCluster ?? (
            <NotificationBell
              onViewAll={onOpenNotifications}
              variant={variant === 'clinical' ? 'clinical' : 'default'}
            />
          )}
          <LanguageSwitcher />
          <ThemeToggleButton variant={variant === 'clinical' ? 'minimal' : 'default'} />
          <div className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src="" />
              <AvatarFallback className="bg-blue-100 font-semibold text-blue-700">{initials}</AvatarFallback>
            </Avatar>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{t('shell.welcomeBack')}</p>
              <p className="truncate text-sm font-semibold text-slate-800">
                {user?.firstName} {user?.lastName}
              </p>
            </div>
          </div>
        </>
      }
      sidebar={renderSidebarNavigation()}
      mobileSidebar={renderMobileNavigation()}
      contentClassName={cn('bg-slate-50', mainClassName)}
    >
      {children}
    </MainLayout>
  );
}

