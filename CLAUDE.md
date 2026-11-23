# Cómo trabajar en Segundo Cerebro

El dueño de la app no es programador. Habla en español: explica todo en lenguaje llano, sin jerga, y no le pidas pasos técnicos que puedas hacer tú.

## Producto

- Lo principal es el **dashboard**: qué hacer hoy y los próximos días. Prioriza la simplicidad; no añadas conceptos ni pantallas nuevas sin que lo pida.
- Toda la interfaz y los textos, en español.

## Proceso fijo para cada cambio

1. **Hacer el cambio** y añadir o ajustar tests en `tests/` cuando toque lógica (`src/shared/`, `src/main/`).
2. **Comprobar**: `npm run typecheck` y `npm test` tienen que pasar. Si algo falla, arréglalo antes de seguir; no publiques nada en rojo.
3. **Probar sin tocar sus datos reales** cuando haga falta abrir la app: `CEREBRO_DATA_DIR=/tmp/cerebro-prueba npm run dev`.
4. **Guardar en GitHub sin preguntar**: commit en `main` con mensaje corto en español que diga qué cambia para él (no cómo), y `git push origin main`.
5. **Publicar la versión nueva sin preguntar** cuando la tarea esté terminada y haya cambios en la app: sigue la skill `/publicar` (`.claude/skills/publicar/SKILL.md`). Una publicación por tarea terminada, no por cada commit. Los cambios que no afectan a la app (solo README, solo tests, `CLAUDE.md`, skills) se guardan pero no se publican.
6. **Contarle el resultado** en dos o tres frases: qué cambia para él, en qué versión está y cómo verlo.

## Nunca

- Subir secretos (`.env`, API keys), bases de datos (`*.db`) ni datos de prueba.
- Publicar desde cambios sin guardar: `scripts/release.sh` ya compila desde lo guardado en git, no lo esquives.
- Cambiar a mano el número de versión en `package.json`: lo hace el script.
