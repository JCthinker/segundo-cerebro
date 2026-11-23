import type { Settings } from './types'

/** Para qué se usa Claude: «quick» = leer y decidir qué hacer; «strong» = proponer y ejecutar soluciones. */
export type ModelTier = 'quick' | 'strong'

export const DEFAULT_QUICK_MODEL = 'claude-haiku-5-5'
export const DEFAULT_STRONG_MODEL = 'claude-opus-5-5'

/** Modelos que se ofrecen en Ajustes. */
export const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 · rápido y barato' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 · equilibrado' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 · el más potente' }
]

export function modelFor(tier: ModelTier, s: Pick<Settings, 'model' | 'quickModel'>): string {
  return tier === 'quick' ? s.quickModel || DEFAULT_QUICK_MODEL : s.model || DEFAULT_STRONG_MODEL
}
