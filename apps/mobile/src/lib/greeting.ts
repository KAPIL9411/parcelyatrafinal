/**
 * The home hero greeting, derived from the device's local clock.
 *
 * Boundaries match the product copy: morning until noon, afternoon until 17:00, evening after.
 * Only the first word of the profile name is used — a full name in a greeting reads like a form.
 * Without a name the greeting stands alone instead of inventing one.
 */
export function greetingFor(date: Date, name: string | null | undefined): string {
  const hour = date.getHours();
  const part = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first} 👋` : `Good ${part}!`;
}
