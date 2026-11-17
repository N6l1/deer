import { useCallback } from 'react';
import { useApp } from '../state/store';

const en = {
  appTagline: 'Unofficial configurator for DrunkDeer keyboards',
  tabColour: 'Colour', tabPerformance: 'Performance', tabRemap: 'Remap',
  userManual: 'User Manual', firmware: 'Firmware Download', lightMode: 'Light mode', darkMode: 'Dark mode', language: 'Language',
  connect: 'Connect keyboard', connectDemo: 'Try demo keyboard', disconnect: 'Disconnect', connected: 'Connected', disconnected: 'No keyboard',
  connecting: 'Connecting…', model: 'Model', firmwareVer: 'Firmware', unsupportedBrowser: 'This browser has no WebHID. Use Chrome, Edge, Brave or Opera on desktop.',
  unknownModel: 'Unrecognised keyboard: identity bytes {bytes}. Read-only.', readOnlyModel: '{model} is read-only in DeerTune until its protocol is verified on hardware.',
  save: 'Save to Keyboard', saving: 'Saving…', pending: '{n} pending', noChanges: 'No changes', savedOk: 'Saved {n} packets', dryRunDone: 'Dry run: {n} packets shown in the log, nothing sent',
  dryRun: 'Dry-run mode', dryRunHint: 'Show the exact bytes that would be sent, without sending them.', experimental: 'Allow experimental writes',
  experimentalHint: 'Enables Last Win, Dual-Trigger, remap and knob packets. Their byte formats conflict between sources; verify with captures first.',
  settings: 'Settings', log: 'HID log', clearLog: 'Clear', copyLog: 'Copy', rawIdentity: 'Raw identity reply', sniffer: 'WebHID sniffer',
  profiles: 'Profiles', addProfile: 'New profile', importExport: 'Import / export', import: 'Import JSON', exportAll: 'Export all', exportOne: 'Export',
  rename: 'Rename', duplicate: 'Duplicate', delete: 'Delete', confirmDelete: 'Delete profile "{name}"?', onboardProfiles: 'Onboard profiles are not supported on this model/firmware; profiles are stored in this browser.',
  wasd: 'WASD', allKeys: 'All keys', character: 'Character', numerals: 'Numerals', clear: 'Clear', selected: '{n} selected', selectHint: 'Click, Ctrl/Shift+click or drag to select keys',
  actionPoint: 'Set Action Point', actionPointHint: 'Travel depth at which the key registers.', mm: 'mm', noSelection: 'Select keys on the map first',
  rapidTrigger: 'Rapid Trigger Mode', rtHint: 'Re-trigger as soon as the key moves by the sensitivity distance, instead of at a fixed point.',
  downstroke: 'Press sensitivity (downstroke)', upstroke: 'Release sensitivity (upstroke)',
  turbo: 'Turbo mode', turboHint: 'Firmware turbo mode. Cannot be combined with keystroke tracking or Last Win.',
  tracking: 'Keystroke tracking', trackingHint: 'Streams live key depth from the keyboard so you can watch travel on the map.',
  lastWin: 'Last Win', lastWinHint: 'SOCD: when both keys of a pair are held, only the most recently pressed one is active. Requires Rapid Trigger.',
  rdt: 'Release Dual-Trigger', rdtHint: 'A key sends a second action when released past a set travel.', addPair: 'Add pair', pickTwo: 'Select exactly two keys on the map, then add.',
  pressKey: 'Press key', releaseKey: 'Release key', activeAt: 'Press fires at', resetAt: 'Release fires at',
  resetAll: 'Reset all keys', confirmReset: 'Reset actuation and Rapid Trigger values on every key to defaults? Not written until you save.',
  liveView: 'Live travel', liveHint: 'Turn on keystroke tracking and save to stream key depth.', depth: 'Depth', actuationLine: 'actuation', resetLine: 'reset',
  effect: 'Effect', brightness: 'Brightness', speed: 'Speed', direction: 'Direction', baseColour: 'Base colour', rainbow: 'Rainbow',
  customRgb: 'Custom per-key RGB', brush: 'Brush', fillAll: 'Fill all', eyedropper: 'Eyedropper', paintHint: 'Click or drag over keys to paint them.',
  presetOnly: 'Effects use the keyboard’s 7 preset colours. Any colour is available in Custom per-key mode.', needsCapture: 'needs capture',
  directionHint: 'Direction byte is not confirmed for the A75 Pro yet.',
  layer: 'Layer', layerBase: 'Base', layerFn1: 'Fn', layerFn2: 'Fn2', pickKey: 'Click a key to remap it', current: 'Current', default: 'Default',
  resetKey: 'Reset key', resetAllRemap: 'Reset all remaps', knob: 'Knob', knobHint: 'Knob event IDs (1–6) are unconfirmed; capture the official driver first.',
  knobCw: 'Rotate right', knobCcw: 'Rotate left', knobPress: 'Press', unbound: 'Default',
  g_letters: 'Letters', g_numbers: 'Numbers', g_basic: 'Symbols', g_function: 'F-keys', g_navigation: 'Navigation', g_keypad: 'Keypad',
  g_modifiers: 'Modifiers', g_media: 'Media', g_mouse: 'Mouse', g_keyboard: 'Keyboard', g_disable: 'Disable',
  experimentalBadge: 'experimental', disclaimer: 'Unofficial. Not affiliated with DrunkDeer. Use at your own risk.',
  backupDone: 'Backup saved to your downloads before the first write.', cancel: 'Cancel', ok: 'OK', confirm: 'Confirm', close: 'Close',
  planTitle: 'About to send {n} packets', planDry: 'Dry-run is on: these will only be logged.', send: 'Send',
  demoNote: 'Demo keyboard: a simulated A75 Pro (firmware 0.023). Nothing leaves this page.',
};

export type Strings = typeof en;
export type StringKey = keyof Strings;

const ar: Strings = {
  appTagline: 'أداة إعداد غير رسمية للوحات مفاتيح DrunkDeer',
  tabColour: 'الألوان', tabPerformance: 'الأداء', tabRemap: 'إعادة التعيين',
  userManual: 'دليل المستخدم', firmware: 'تنزيل البرنامج الثابت', lightMode: 'الوضع الفاتح', darkMode: 'الوضع الداكن', language: 'اللغة',
  connect: 'توصيل لوحة المفاتيح', connectDemo: 'جرّب لوحة تجريبية', disconnect: 'قطع الاتصال', connected: 'متصل', disconnected: 'لا توجد لوحة مفاتيح',
  connecting: 'جارٍ الاتصال…', model: 'الطراز', firmwareVer: 'البرنامج الثابت', unsupportedBrowser: 'هذا المتصفح لا يدعم WebHID. استخدم Chrome أو Edge أو Brave أو Opera على الحاسوب.',
  unknownModel: 'لوحة غير معروفة: بايتات التعريف {bytes}. للقراءة فقط.', readOnlyModel: '{model} للقراءة فقط في DeerTune حتى يتم التحقق من البروتوكول على الجهاز.',
  save: 'حفظ في لوحة المفاتيح', saving: 'جارٍ الحفظ…', pending: '{n} تغييرات معلّقة', noChanges: 'لا توجد تغييرات', savedOk: 'تم إرسال {n} حزمة', dryRunDone: 'تشغيل تجريبي: {n} حزمة في السجل، لم يُرسل شيء',
  dryRun: 'وضع التشغيل التجريبي', dryRunHint: 'اعرض البايتات التي ستُرسل بالضبط دون إرسالها.', experimental: 'السماح بالكتابة التجريبية',
  experimentalHint: 'يفعّل حزم Last Win والتشغيل المزدوج وإعادة التعيين والمقبض. تنسيقاتها متعارضة بين المصادر؛ تحقّق بالالتقاط أولاً.',
  settings: 'الإعدادات', log: 'سجل HID', clearLog: 'مسح', copyLog: 'نسخ', rawIdentity: 'رد التعريف الخام', sniffer: 'أداة التقاط WebHID',
  profiles: 'الملفات الشخصية', addProfile: 'ملف جديد', importExport: 'استيراد / تصدير', import: 'استيراد JSON', exportAll: 'تصدير الكل', exportOne: 'تصدير',
  rename: 'إعادة تسمية', duplicate: 'تكرار', delete: 'حذف', confirmDelete: 'حذف الملف "{name}"؟', onboardProfiles: 'الملفات المدمجة غير مدعومة في هذا الطراز؛ تُحفظ الملفات في هذا المتصفح.',
  wasd: 'WASD', allKeys: 'كل المفاتيح', character: 'الحروف', numerals: 'الأرقام', clear: 'إلغاء التحديد', selected: '{n} محدد', selectHint: 'انقر أو Ctrl/Shift+نقر أو اسحب لتحديد المفاتيح',
  actionPoint: 'نقطة التفعيل', actionPointHint: 'عمق الضغط الذي يُسجَّل عنده المفتاح.', mm: 'مم', noSelection: 'حدّد مفاتيح على الخريطة أولاً',
  rapidTrigger: 'وضع الزناد السريع', rtHint: 'إعادة التفعيل فور تحرك المفتاح بمسافة الحساسية بدلاً من نقطة ثابتة.',
  downstroke: 'حساسية الضغط', upstroke: 'حساسية التحرير',
  turbo: 'وضع التيربو', turboHint: 'وضع التيربو في البرنامج الثابت. لا يجتمع مع تتبع الضغطات أو Last Win.',
  tracking: 'تتبع الضغطات', trackingHint: 'يبث عمق المفاتيح مباشرة لتشاهد الحركة على الخريطة.',
  lastWin: 'الأخير يفوز (Last Win)', lastWinHint: 'SOCD: عند ضغط مفتاحي الزوج معاً يبقى الأحدث فقط فعّالاً. يتطلب الزناد السريع.',
  rdt: 'التشغيل المزدوج عند التحرير', rdtHint: 'يرسل المفتاح إجراءً ثانياً عند تحريره بعد مسافة محددة.', addPair: 'إضافة زوج', pickTwo: 'حدّد مفتاحين بالضبط ثم أضف.',
  pressKey: 'مفتاح الضغط', releaseKey: 'مفتاح التحرير', activeAt: 'الضغط عند', resetAt: 'التحرير عند',
  resetAll: 'إعادة ضبط كل المفاتيح', confirmReset: 'إعادة قيم التفعيل والزناد السريع لكل المفاتيح إلى الافتراضي؟ لن تُكتب حتى تحفظ.',
  liveView: 'الحركة المباشرة', liveHint: 'فعّل تتبع الضغطات واحفظ لبث عمق المفاتيح.', depth: 'العمق', actuationLine: 'التفعيل', resetLine: 'إعادة الضبط',
  effect: 'التأثير', brightness: 'السطوع', speed: 'السرعة', direction: 'الاتجاه', baseColour: 'اللون الأساسي', rainbow: 'قوس قزح',
  customRgb: 'ألوان مخصصة لكل مفتاح', brush: 'الفرشاة', fillAll: 'تعبئة الكل', eyedropper: 'القطّارة', paintHint: 'انقر أو اسحب فوق المفاتيح لتلوينها.',
  presetOnly: 'تستخدم التأثيرات الألوان السبعة المدمجة. أي لون متاح في الوضع المخصص لكل مفتاح.', needsCapture: 'يحتاج التقاط',
  directionHint: 'بايت الاتجاه غير مؤكد لطراز A75 Pro بعد.',
  layer: 'الطبقة', layerBase: 'الأساسية', layerFn1: 'Fn', layerFn2: 'Fn2', pickKey: 'انقر مفتاحاً لإعادة تعيينه', current: 'الحالي', default: 'الافتراضي',
  resetKey: 'إعادة المفتاح', resetAllRemap: 'إعادة كل التعيينات', knob: 'المقبض', knobHint: 'معرّفات أحداث المقبض (1–6) غير مؤكدة؛ التقط حركة البرنامج الرسمي أولاً.',
  knobCw: 'تدوير لليمين', knobCcw: 'تدوير لليسار', knobPress: 'ضغط', unbound: 'افتراضي',
  g_letters: 'الحروف', g_numbers: 'الأرقام', g_basic: 'الرموز', g_function: 'مفاتيح F', g_navigation: 'التنقل', g_keypad: 'لوحة الأرقام',
  g_modifiers: 'المعدِّلات', g_media: 'الوسائط', g_mouse: 'الفأرة', g_keyboard: 'لوحة المفاتيح', g_disable: 'تعطيل',
  experimentalBadge: 'تجريبي', disclaimer: 'غير رسمي. لا علاقة له بشركة DrunkDeer. الاستخدام على مسؤوليتك.',
  backupDone: 'حُفظت نسخة احتياطية في التنزيلات قبل أول كتابة.', cancel: 'إلغاء', ok: 'موافق', confirm: 'تأكيد', close: 'إغلاق',
  planTitle: 'سيتم إرسال {n} حزمة', planDry: 'التشغيل التجريبي مفعّل: ستُسجَّل فقط.', send: 'إرسال',
  demoNote: 'لوحة تجريبية: محاكاة لطراز A75 Pro (برنامج ثابت 0.023). لا يغادر شيء هذه الصفحة.',
};

export const LANGS = { en: { name: 'English', dir: 'ltr', strings: en }, ar: { name: 'العربية', dir: 'rtl', strings: ar } } as const;
export type Lang = keyof typeof LANGS;

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = LANGS[lang].strings[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function useT() {
  const lang = useApp((s) => s.settings.lang);
  return useCallback((key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}
