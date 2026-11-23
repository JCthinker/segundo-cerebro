/** ¿Es `candidate` más nueva que `current`? ("0.1.10" > "0.1.9"; acepta "v" delante.) */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.replace(/^v/, '').split('.').map(Number)
  const b = current.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d > 0
  }
  return false
}
