import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { decideToolMode, parsePermissions, serverLabel, serverOf, shortToolName } from '@shared/permissions'
import type { ApprovalRequest, RunLogEntry } from '@shared/types'
import * as db from '../db'
import { emit } from '../events'

const pending = new Map<string, (approved: boolean) => void>()

export function answerApproval(id: string, approved: boolean): void {
  const resolve = pending.get(id)
  if (resolve) {
    pending.delete(id)
    resolve(approved)
  }
}

export function pendingApprovals(): string[] {
  return [...pending.keys()]
}

/**
 * Cada llamada a herramienta pasa por aquí. Se decide con los permisos de Mi flujo:
 * automático → se ejecuta; requiere OK → tarjeta de aprobación; borrador → no se ejecuta y
 * Claude debe dejar el contenido redactado; prohibido → no se ejecuta.
 */
export function makeGate(runId: string, opts: { draftsOnly: boolean; log: (e: RunLogEntry) => void }): CanUseTool {
  const rules = parsePermissions(db.getWorkflow().markdown)
  return async (toolName, input, { signal }) => {
    const { mode, reason } = decideToolMode(toolName, rules, { draftsOnly: opts.draftsOnly })
    const at = new Date().toISOString()
    const server = serverOf(toolName)
    const label = `${server ? serverLabel(server) : 'claude'} · ${shortToolName(toolName)}`

    if (mode === 'auto') return { behavior: 'allow', updatedInput: input }

    if (mode === 'deny') {
      opts.log({ at, type: 'denied', text: `${label}: prohibido (${reason})`, toolName, input })
      return { behavior: 'deny', message: `El usuario no permite esta acción (${reason}). No la intentes de otra forma; explica qué habría hecho falta.` }
    }

    if (mode === 'draft') {
      opts.log({ at, type: 'draft', text: `${label}: borrador preparado (${reason})`, toolName, input })
      return {
        behavior: 'deny',
        message:
          'Modo borrador: esta acción NO se ha ejecutado. Sigue con el resto y, en tu respuesta final, incluye el borrador completo (destinatario, asunto y texto, o los campos que correspondan) para que el usuario lo envíe.'
      }
    }

    // mode === 'ask'
    const req: ApprovalRequest = { id: randomUUID(), runId, toolName, serverName: server ? serverLabel(server) : null, input }
    const approved = await new Promise<boolean>((resolve) => {
      pending.set(req.id, resolve)
      signal.addEventListener('abort', () => answerApproval(req.id, false), { once: true })
      emit('approval-request', req)
    })
    emit('approval-closed', req.id)
    if (approved) {
      opts.log({ at: new Date().toISOString(), type: 'approved', text: `${label}: aprobado`, toolName, input })
      return { behavior: 'allow', updatedInput: input }
    }
    opts.log({ at: new Date().toISOString(), type: 'denied', text: `${label}: rechazado por ti`, toolName, input, byUser: true })
    return { behavior: 'deny', message: 'El usuario ha rechazado esta acción. No la repitas; termina con lo demás y deja el contenido como borrador en tu respuesta.' }
  }
}
