import type { WorkLocationDay, WorkLocationDayType } from '../types';

export const WORK_LOCATION_DAY_TYPES: Array<{
  value: WorkLocationDayType;
  label: string;
  description: string;
}> = [
  {
    value: 'home_majority',
    label: 'Überwiegend in der häuslichen Wohnung gearbeitet',
    description: 'Der größte Teil der Arbeit fand in der Wohnung statt; an diesem Tag wurde keine außerhalb gelegene erste Betriebsstätte oder erste Tätigkeitsstätte aufgesucht.',
  },
  {
    value: 'home_no_other_workspace',
    label: 'Zu Hause gearbeitet; kein anderer Arbeitsplatz verfügbar',
    description: 'Für diese Tätigkeit stand dauerhaft kein anderer Arbeitsplatz zur Verfügung. Arbeit außerhalb der Wohnung am selben Tag ist ebenfalls möglich.',
  },
];

export function getWorkLocationDayLabel(dayType: WorkLocationDayType): string {
  return WORK_LOCATION_DAY_TYPES.find(item => item.value === dayType)?.label || 'Arbeitsort erfasst';
}

export function getCompletedWorkLocationDays(days: WorkLocationDay[], year: number, today: string): WorkLocationDay[] {
  const prefix = `${year}-`;
  return days.filter(day => day.date.startsWith(prefix) && day.date <= today);
}

export function localDateKey(date = new Date(), timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date).map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      // Ungültige Workspace-Zeitzonen fallen auf die lokale Gerätezeit zurück.
    }
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
