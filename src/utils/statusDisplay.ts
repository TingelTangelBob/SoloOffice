import { stateLabel, stateTone } from '../../backend/shared/stateMachines.js';
import type { StateMachineName, StateTone } from '../../backend/shared/stateMachines.js';

// Anzeige der Fachstatus. Werte, Beschriftungen und Farbton kommen aus dem
// gemeinsamen Register `backend/shared/stateMachines.js`; hier steht nur die
// Zuordnung von Farbton zu Tailwind-Klassen. Die Klassen müssen als ganze
// Zeichenketten im Quelltext stehen, sonst entfernt Tailwind sie beim Build.

const BADGE_CLASSES: Record<StateTone, string> = {
  neutral: 'bg-gray-100 text-gray-800',
  primary: 'bg-primary-light-custom text-primary-custom',
  success: 'bg-green-100 text-green-800',
  progress: 'bg-yellow-100 text-yellow-800',
  warning: 'bg-orange-100 text-orange-800',
  warningStrong: 'bg-orange-200 text-orange-900',
  danger: 'bg-red-100 text-red-800',
  dangerStrong: 'bg-red-200 text-red-900',
  settled: 'bg-blue-100 text-blue-800',
};

const DOT_CLASSES: Record<StateTone, string> = {
  neutral: 'bg-gray-400',
  primary: 'bg-primary-custom',
  success: 'bg-green-500',
  progress: 'bg-yellow-500',
  warning: 'bg-orange-500',
  warningStrong: 'bg-orange-500',
  danger: 'bg-red-500',
  dangerStrong: 'bg-red-500',
  settled: 'bg-blue-500',
};

/** Deutsche Beschriftung eines Status; unbekannte Werte erscheinen als „Unbekannt“, nie als Rohschlüssel. */
export function statusLabel(machine: StateMachineName, status: unknown): string {
  return stateLabel(machine, status);
}

/** Hintergrund- und Textfarbe für ein Status-Etikett. */
export function statusBadgeClass(machine: StateMachineName, status: unknown): string {
  return BADGE_CLASSES[stateTone(machine, status)];
}

/** Farbe des Statuspunkts in schmalen Tabellen. */
export function statusDotClass(machine: StateMachineName, status: unknown): string {
  return DOT_CLASSES[stateTone(machine, status)];
}

export function statusTone(machine: StateMachineName, status: unknown): StateTone {
  return stateTone(machine, status);
}
