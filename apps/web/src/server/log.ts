/** Central server log helper — keeps console.error call-sites uniform. */
export function logError(msg: string, err: unknown): void {
  console.error(msg, err);
}
