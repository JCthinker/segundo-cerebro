/** Texto de la pregunta que se hace siempre antes de borrar una nota. */
export function deleteNoteQuestion(title: string, inside: number): string {
  const name = title.trim() ? `«${title.trim()}»` : 'esta nota sin título'
  const children =
    inside > 0 ? ` También se borrarán ${inside === 1 ? 'la nota' : `las ${inside} notas`} que tiene dentro.` : ''
  return `¿Borrar ${name}?${children} No se puede deshacer.`
}
