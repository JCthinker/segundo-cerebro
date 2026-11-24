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
