export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

export const TIME_ZONE_OPTIONS = [
  { value: 'Europe/Berlin', label: 'Berlin · Mitteleuropäische Zeit' },
  { value: 'Europe/London', label: 'London · Westeuropäische Zeit' },
  { value: 'Europe/Lisbon', label: 'Lissabon · Westeuropäische Zeit' },
  { value: 'Europe/Paris', label: 'Paris · Mitteleuropäische Zeit' },
  { value: 'Europe/Madrid', label: 'Madrid · Mitteleuropäische Zeit' },
  { value: 'Europe/Rome', label: 'Rom · Mitteleuropäische Zeit' },
  { value: 'Europe/Athens', label: 'Athen · Osteuropäische Zeit' },
  { value: 'Europe/Helsinki', label: 'Helsinki · Osteuropäische Zeit' },
  { value: 'Europe/Bucharest', label: 'Bukarest · Osteuropäische Zeit' },
  { value: 'Europe/Istanbul', label: 'Istanbul · Türkische Zeit' },
  { value: 'America/New_York', label: 'New York · US-Ostküste' },
  { value: 'America/Chicago', label: 'Chicago · US-Zentralzeit' },
  { value: 'America/Los_Angeles', label: 'Los Angeles · US-Westküste' },
  { value: 'Asia/Tokyo', label: 'Tokio · Japanische Zeit' },
  { value: 'Asia/Shanghai', label: 'Shanghai · Chinesische Zeit' },
  { value: 'Australia/Sydney', label: 'Sydney · Australische Ostküste' },
  { value: 'UTC', label: 'UTC · Koordinierte Weltzeit' },
] as const;

export function getTimeZoneLabel(timeZone?: string) {
  return TIME_ZONE_OPTIONS.find((option) => option.value === timeZone)?.label || timeZone || DEFAULT_TIME_ZONE;
}
