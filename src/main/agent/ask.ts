import { randomUUID } from 'node:crypto'
import type { RunLogEntry } from '@shared/types'
import { dataChanged, emit } from '../events'
import { cerebroServer, connectedToolsSummary, userMcpServers } from './app-mcp'
import { baseSystem } from './context'
import { markAiFailure, markAiOk, runAgent } from './client'
import { makeGate } from './permissions-gate'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

const ASK_ROLE = `Eres el asistente del «segundo cerebro» del usuario. Respondes preguntas sobre sus notas, promesas, entregas, agenda y herramientas conectadas.
- Busca antes de responder (search_notes, list_items, get_events y las herramientas de lectura conectadas).
- Cita de dónde sacas cada dato: título de la nota o herramienta.
- Si te pide hacer algo, puedes hacerlo; las acciones que escriben pasan por sus permisos.
- Si no encuentras algo, dilo.`

export async function ask(history: ChatMessage[], onTool?: (name: string) => void): Promise<string> {
  const runId = `ask-${randomUUID()}`
  const transcript = history.map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.text}`).join('\n\n')
  const log = (e: RunLogEntry) => emit('ask-log', e)
  try {
    const r = await runAgent({
      system: baseSystem(ASK_ROLE) + `\n\n${connectedToolsSummary()}`,
      prompt: `Conversación hasta ahora:\n\n${transcript}\n\nResponde al último mensaje del usuario.`,
      mcpServers: { cerebro: cerebroServer({ allowWrites: true, onChange: () => dataChanged('items') }), ...userMcpServers() },
      canUseTool: makeGate(runId, { draftsOnly: false, log }),
      effort: 'high',
      maxTurns: 20,
      onEvent: (e) => {
        if (e.type === 'tool') onTool?.(e.text)
      }
    })
    markAiOk()
    return r.text
  } catch (e) {
    markAiFailure(e)
    throw e
  }
}
