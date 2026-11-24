/** Palabras con las que alguien dice «adelante» sin pedir nada más. */
const GO_WORDS = new Set(
  'si vale ok okay adelante hazlo hacerlo haz dale perfecto correcto de acuerdo venga genial bien muy continua continuar sigue seguir ejecuta ejecutalo empieza puedes lo me parece todo esta por favor porfa claro con ello eso asi gracias go yes'.split(' ')
)

/** ¿El mensaje es solo un «sí, adelante»? Entonces se ejecuta el plan, no se rehace. */
export function isGoAhead(text: string): boolean {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return words.length > 0 && words.length <= 8 && words.every((w) => GO_WORDS.has(w))
}

/**
 * Junta todo lo que el usuario le ha ido diciendo a Claude en el panel de una tarea
 * (y lo que ya se hizo antes) en un único encargo.
 */
export function buildGoal(messages: string[], alreadyDone?: string | null): string {
  const said = messages.map((m) => m.trim()).filter(Boolean)
  let goal =
    said.length <= 1
      ? (said[0] ?? '')
      : `Lo que te ha ido diciendo el usuario, en orden (si algo se contradice, manda lo último):\n${said.map((m) => `- ${m}`).join('\n')}`
  const done = alreadyDone?.trim()
  if (done) goal += `${goal ? '\n\n' : ''}Lo que ya hiciste antes en esta tarea (no lo repitas):\n${done}`
  return goal
}
