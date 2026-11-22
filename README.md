# Segundo Cerebro

App de escritorio en la que tomar notas es solo una de las entradas de un asistente personal. A partir de tus notas, tu calendario y tus herramientas (Jira, Slack, correo…), te dice:

- qué es lo importante hoy y por qué,
- qué prometiste y a quién,
- qué entregas se acercan (teniendo en cuenta el tiempo de preparación),
- qué tienes que preparar antes de cada reunión.

Además, puede **resolver trabajo** en tus herramientas, como mover un ticket, escribir en Slack o preparar un correo, siempre con los permisos que tú definas.

Todo se rige por **Mi flujo**, una página viva que escribes tú y que Claude lee como si fuera un skill.

> Estado: en construcción. La priorización, los permisos y la lectura de calendarios están hechos y tienen tests. La interfaz y la capa de IA están en desarrollo.

## Requisitos

- Node.js 22 o superior
- Para la IA, una de estas dos opciones:
  - **Claude Code** instalado y con sesión iniciada (uso personal), o
  - una **API key de Anthropic** (obligatoria si distribuyes la app a otras personas; Anthropic no permite que apps de terceros ofrezcan el inicio de sesión de claude.ai).

## Desarrollo

```bash
npm install
npm test
npm run dev
```

## Estructura

```
src/shared/   lógica pura: priorización, permisos, fechas, tipos
src/main/     proceso principal de Electron: base de datos, calendario, agente
src/renderer/ interfaz (React)
tests/        tests con Vitest
```
