/**
 * App interface text in English, Urdu and Roman Urdu (parent-facing screens).
 * These are the app's own words, not clinical instruments; a native speaker should still review them before
 * deployment. Questionnaire items (M-CHAT-R, ASQ-3) are NOT here: they must come from the publishers'
 * validated translations — see public/i18n/questionnaires/README.md.
 */
export type Lang = 'en' | 'ur' | 'roman';

export const LANGS: { id: Lang; label: string; dir: 'ltr' | 'rtl'; speech: string }[] = [
  { id: 'en', label: 'English', dir: 'ltr', speech: 'en-US' },
  { id: 'ur', label: 'اردو', dir: 'rtl', speech: 'ur-PK' },
  { id: 'roman', label: 'Roman Urdu', dir: 'ltr', speech: 'ur-PK' },
];

type Entry = { en: string; ur: string; roman: string };

export const STRINGS = {
  // Navigation (parent)
  'nav.home': { en: 'Home', ur: 'ہوم', roman: 'Home' },
  'nav.children': { en: 'My Children', ur: 'میرے بچے', roman: 'Mere Bachay' },
  'nav.childCase': { en: 'Child Case', ur: 'بچے کی فائل', roman: 'Bachay ki File' },
  'nav.messages': { en: 'Messages', ur: 'پیغامات', roman: 'Paighamat' },
  'nav.homeActivities': { en: 'Home Activities', ur: 'گھر کی سرگرمیاں', roman: 'Ghar ki Sargarmiyan' },
  'nav.therapyReports': { en: 'Therapy Reports', ur: 'تھراپی رپورٹس', roman: 'Therapy Reports' },
  'nav.appointments': { en: 'Appointments', ur: 'ملاقاتیں', roman: 'Mulaqatein' },
  'nav.bookAppointment': { en: 'Book appointment', ur: 'ملاقات بُک کریں', roman: 'Mulaqat book karein' },
  'nav.appointmentStatus': { en: 'Appointment status', ur: 'ملاقات کی صورتحال', roman: 'Mulaqat ki surat-e-haal' },
  'nav.screening': { en: 'Screening', ur: 'اسکریننگ', roman: 'Screening' },
  'nav.questionnaires': { en: 'Questionnaires (M-CHAT / ASQ)', ur: 'سوالنامے (M-CHAT / ASQ)', roman: 'Sawalnamay (M-CHAT / ASQ)' },
  'nav.facialScreening': { en: 'Facial screening', ur: 'چہرے کی اسکریننگ', roman: 'Chehray ki screening' },
  'nav.screeningHistory': { en: 'Screening history', ur: 'اسکریننگ کی تاریخ', roman: 'Screening ki history' },
  'nav.labReports': { en: 'Lab Reports', ur: 'لیب رپورٹس', roman: 'Lab Reports' },

  // Shell
  'shell.logout': { en: 'Logout', ur: 'لاگ آؤٹ', roman: 'Logout' },
  'shell.settings': { en: 'Settings', ur: 'سیٹنگز', roman: 'Settings' },
  'shell.welcomeBack': { en: 'Welcome back', ur: 'خوش آمدید', roman: 'Khush aamdeed' },
  'shell.language': { en: 'Language', ur: 'زبان', roman: 'Zubaan' },
  'shell.easyRead': { en: 'Easy reading', ur: 'آسان پڑھائی', roman: 'Asaan parhai' },
  'shell.easyReadHint': {
    en: 'Bigger text and buttons, with a button to hear each question.',
    ur: 'بڑا متن اور بٹن، اور ہر سوال سننے کا بٹن۔',
    roman: 'Bara text aur buttons, aur har sawal sunnay ka button.',
  },

  // Generic answers (instrument files may override with their official wording)
  'answer.yes': { en: 'Yes', ur: 'ہاں', roman: 'Haan' },
  'answer.no': { en: 'No', ur: 'نہیں', roman: 'Nahin' },
  'answer.sometimes': { en: 'Sometimes', ur: 'کبھی کبھی', roman: 'Kabhi kabhi' },
  'answer.notYet': { en: 'Not Yet', ur: 'ابھی نہیں', roman: 'Abhi nahin' },

  // Screening
  'screening.listen': { en: 'Listen', ur: 'سنیں', roman: 'Sunein' },
  'screening.stop': { en: 'Stop', ur: 'روکیں', roman: 'Rokein' },
  'screening.noOfficialTranslation': {
    en: '',
    ur: 'اس سوالنامے کا تصدیق شدہ اردو ترجمہ ابھی شامل نہیں، اس لیے سوالات انگریزی میں ہیں۔ مدد کے لیے اپنے ڈاکٹر یا عملے سے پوچھیں۔',
    roman:
      'Is sawalnamay ka tasdeeq-shuda Urdu tarjuma abhi shamil nahin, is liye sawalat English mein hain. Madad ke liye apne doctor ya staff se poochein.',
  },
  'screening.noVoice': {
    en: 'This device has no voice for reading aloud.',
    ur: 'اس آلے میں آواز سے پڑھنے کی سہولت نہیں۔',
    roman: 'Is device mein awaaz se parhnay ki sahulat nahin.',
  },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;
