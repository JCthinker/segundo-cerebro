import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { call, useEvent } from '../api'
import { Icon } from './ui'

/** Estado de las actualizaciones, vivo: se actualiza cuando el proceso principal avisa. */
export function useUpdateStatus(): UpdateStatus | null {
  const [s, setS] = useState<UpdateStatus | null>(null)
  useEffect(() => void call<UpdateStatus>('update.status').then(setS), [])
  useEvent<UpdateStatus>('update-status', setS)
  return s
}

/** Franja arriba cuando hay una versión nueva lista para instalar. */
export function UpdateBanner() {
  const s = useUpdateStatus()
  if (s?.state !== 'ready') return null
  return (
    <div className="flex items-center gap-2 border-b border-line bg-panel px-8 py-2 text-[12.5px]">
      <Icon name="download" className="text-clay" />
      <span className="flex-1">
        Hay una versión nueva de la app ({s.version}). Se instalará sola cuando cierres la app, o ahora si reinicias.
      </span>
      <button className="font-medium underline" onClick={() => void call('update.install')}>
        Reiniciar ahora
      </button>
    </div>
  )
}
