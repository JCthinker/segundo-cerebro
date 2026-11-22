import { useState } from 'react'
import type { AiStatus } from '@shared/types'
import { call, useAction } from './api'
import { Button, Card, ErrorNote, Icon } from './components/ui'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const test = useAction(async () => setAi(await call<AiStatus>('ai.test')))
  const finish = useAction(async (demo: boolean) => {
    await call('onboarding.finish', { demo })
    onDone()
  })

  return (
    <div className="drag flex h-full items-center justify-center p-8">
      <div className="no-drag w-full max-w-xl">
        <div className="mb-6 flex items-center gap-2 text-clay">
          <Icon name="sparkles" className="h-6 w-6" />
          <span className="text-[13px] font-medium">Segundo cerebro</span>
        </div>
        {step === 1 ? (
          <>
            <h1 className="text-[28px] font-semibold tracking-tight">Lo que tienes que hacer hoy y los próximos días, en una pantalla</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              Escribe como siempre. Claude detecta lo que prometiste y lo que vence, lo prioriza según tus reglas y, si quieres, lo resuelve con tus herramientas. Siempre con tu permiso.
            </p>
            <Card className="mt-6 p-4">
              <div className="font-medium">Conecta Claude</div>
              <p className="mt-1 text-[13px] text-muted">
                La app usa la sesión de Claude Code de este ordenador. Si aún no has iniciado sesión, abre Terminal, escribe <code className="rounded bg-hover px-1">claude</code> y sigue los pasos. También puedes usar una API key en Ajustes.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Button busy={test.busy} onClick={() => test.run()}>
                  Comprobar conexión
                </Button>
                {ai ? <span className={`text-[13px] ${ai.ok ? 'text-success' : 'text-danger'}`}>{ai.detail}</span> : null}
              </div>
              <ErrorNote>{test.error}</ErrorNote>
            </Card>
            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={() => setStep(2)}>
                {ai?.ok ? 'Siguiente' : 'Seguir sin Claude por ahora'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[28px] font-semibold tracking-tight">¿Cómo quieres empezar?</h1>
            <div className="mt-6 grid gap-3">
              <button onClick={() => finish.run(true)} className="rounded-xl border border-line bg-raised p-4 text-left hover:border-line-strong">
                <div className="font-medium">Con datos de ejemplo</div>
                <p className="mt-1 text-[13px] text-muted">Una persona ficticia con notas, promesas, entregas, agenda y su «Mi flujo» escrito. Lo mejor para ver cómo funciona.</p>
              </button>
              <button onClick={() => finish.run(false)} className="rounded-xl border border-line bg-raised p-4 text-left hover:border-line-strong">
                <div className="font-medium">Desde cero</div>
                <p className="mt-1 text-[13px] text-muted">Empiezas con una plantilla de «Mi flujo» para rellenar a tu manera.</p>
              </button>
            </div>
            <ErrorNote>{finish.error}</ErrorNote>
          </>
        )}
      </div>
    </div>
  )
}
