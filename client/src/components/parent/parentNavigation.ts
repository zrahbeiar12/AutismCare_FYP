import {
  Home,
  Baby,
  ClipboardList,
  Calendar,
  FlaskConical,
  FileText,
  FolderOpen,
  ListChecks,
  Stethoscope,
  MessageSquare,
} from 'lucide-react';
import type { NavigationItem } from '../layout/DashboardLayout';
import { STRINGS, type StringKey } from '../../i18n/strings';

/**
 * Parent sidebar order: care path first (children → case → day-to-day care),
 * then scheduling, dual screening entry (questionnaires + facial), history, labs.
 */
export function getParentNavigationItems(t: (key: StringKey) => string = defaultLabel): NavigationItem[] {
  return [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'children', label: t('nav.children'), icon: Baby },
    {
      id: 'child-case',
      label: t('nav.childCase'),
      icon: FolderOpen,
      to: '/parent/case',
      activePathPrefix: '/parent/case',
    },
    { id: 'messages', label: t('nav.messages'), icon: MessageSquare },
    { id: 'home-activities', label: t('nav.homeActivities'), icon: ListChecks },
    { id: 'therapy-reports', label: t('nav.therapyReports'), icon: Stethoscope },
    {
      id: 'appointments',
      label: t('nav.appointments'),
      icon: Calendar,
      children: [
        { id: 'book-appointment', label: t('nav.bookAppointment') },
        { id: 'appointments', label: t('nav.appointmentStatus') },
      ],
    },
    {
      id: 'screening',
      label: t('nav.screening'),
      icon: ClipboardList,
      children: [
        { id: 'screening-questionnaires', label: t('nav.questionnaires') },
        { id: 'facial-screening', label: t('nav.facialScreening') },
      ],
    },
    { id: 'total-screenings', label: t('nav.screeningHistory'), icon: FileText },
    { id: 'lab-reports', label: t('nav.labReports'), icon: FlaskConical },
  ];
}

function defaultLabel(key: StringKey): string {
  // English labels without a provider (tests, non-React callers).
  return STRINGS[key]?.en ?? String(key);
}
