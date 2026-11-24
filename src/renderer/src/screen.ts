/**
 * Qué está viendo el usuario, para que Claude lo sepa cuando le habla desde el panel.
 * App pone la pantalla; cada página puede añadir un detalle (la nota abierta, la pestaña…).
 */
let page = ''
let detail: string | null = null

export function setScreenPage(p: string): void {
  page = p
  detail = null
}

export function setScreenDetail(d: string | null): void {
  detail = d
}

export function describeScreen(): string {
  return [page, detail].filter(Boolean).join(' · ')
}
