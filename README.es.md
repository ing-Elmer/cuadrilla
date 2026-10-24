# Cuadrilla — un equipo de ingeniería para Claude Code

*[Read in English](README.md)*

Cuadrilla convierte a [Claude Code](https://claude.com/claude-code) en un **equipo de ingeniería
con un estándar escrito**: un orquestador que planifica y reparte, especialistas por stack que
implementan en paralelo, revisores que nunca editan, un auditor de seguridad, QA en un navegador
real y **hooks de protección** que hacen cumplir los límites de verdad, no como texto en un prompt.

Funciona con **cualquier lenguaje**. Los packs por stack suman reglas concretas y profundas para
Python/FastAPI, .NET, Node/TypeScript, Java/Spring y React.

## Por qué lo eligen los equipos

- **Límites en código, no en prompts.** El hook `guard` mira el comando *completo*: bloquea
  `cd api && git push`, `bash -c "…"` o `type .env` igual que `git push`. Además se niega a
  escribir secretos (API keys, tokens, claves privadas, cadenas de conexión con contraseña) en
  cualquier archivo. Lo respaldan 97 tests automáticos.
- **Una sola fuente de verdad para los checks.** `.claude/cuadrilla.json` declara cómo se instala,
  verifica, formatea, levanta y audita cada componente. `/cuadrilla:verify`, los hooks y el CI
  generado leen lo mismo: lo local y el CI nunca se desalinean.
- **Contrato primero, después trabajo en paralelo.** Una feature que cruza componentes arranca
  con un contrato explícito (endpoint, DTOs, envelope, errores, permiso) y cada especialista
  trabaja en paralelo.
- **Revisiones confiables.** Los revisores no editan, confirman cada hallazgo en el código, los
  ordenan por severidad con `archivo:línea` y cierran con un veredicto. En GitHub, cada PR recibe
  comentarios inline de Claude: consultivos, nunca aprueba solo.
- **Responde en tu idioma.** Los prompts están en inglés por calidad; el equipo responde, comenta
  el código y documenta en español, inglés o portugués (se elige al instalar).
- **Liviano.** ~2.800 tokens fijos por sesión; todo lo demás se carga bajo demanda.

## Qué incluye

| Plugin | Qué agrega |
|---|---|
| `cuadrilla` (núcleo) | 8 agentes · 7 skills de estándar · 18 comandos · 5 hooks · MCP de GitHub, Atlassian y Playwright |
| `cuadrilla-python-fastapi` | Python + FastAPI + PostgreSQL (psycopg 3, SQL a mano, uv/ruff/mypy/pytest) |
| `cuadrilla-dotnet` | .NET + ASP.NET Core (4 proyectos, Dapper o EF Core, FluentValidation, xUnit) |
| `cuadrilla-node-typescript` | API en Node + TypeScript (Fastify, Zod, pg/Kysely, Vitest) |
| `cuadrilla-java-spring` | Java + Spring Boot (JdbcClient o JPA, Flyway, ArchUnit, JUnit 5) |
| `cuadrilla-react` | Frontend React + TypeScript + Vite + Tailwind v4 para cualquier backend |
| `cuadrilla-codex` (opcional) | Codex CLI como segundo ejecutor y revisor, siempre verificado por Claude |

Los comandos, hooks y servidores MCP están detallados en el [README en inglés](README.md#commands).

**Nota sobre MCP:** `github` (necesita `GITHUB_PAT`) y `atlassian` (OAuth con `/mcp`) son opcionales. Si no los configuras, `/mcp` mostrará `github` como fallido ("Authorization header is badly formatted"); es esperado y no afecta nada más: Cuadrilla usa el CLI `gh`. En Windows: `setx GITHUB_PAT "<token>"` y reinicia Claude Code.

## Métricas

Los hooks llevan un registro local en `.claude/cuadrilla/metrics.jsonl` de lo que frena al
equipo: qué regla de `guard` bloqueó o pidió confirmación, qué patrones prohibidos encontró
`stop-check` (por patrón y extensión), cuántos errores de lint tuvo cada componente y qué agentes,
skills y comandos se usaron. `/cuadrilla:report` lo convierte en un informe y explica los tres
patrones que más se repiten con una corrección concreta, para mejorar el estándar con evidencia.

- **Nunca registra** comandos, prompts, descripciones de tareas, código, rutas de archivos ni
  secretos.
- **No sale de la máquina:** la carpeta se ignora a sí misma en git y no se envía nada.
- `/cuadrilla:report 30 anonymous` además oculta los nombres de componentes y las reglas del
  proyecto y quita los ids de sesión, para compartirlo con quien mantiene el kit.
- Se apaga con `"metrics": false` en `.claude/cuadrilla.json` o con `CUADRILLA_METRICS=off`.

## Modo desatendido

Para que el equipo trabaje sin nadie mirando (desde un programador de tareas, un job de CI o
un runner de agentes como OpenJarvis) y revisar el resultado como un PR en borrador. El
runner define las variables en el entorno del proceso `claude`; no se pueden activar desde el
repositorio, así que el agente no puede activárselas solo.

```bash
export CUADRILLA_UNATTENDED=1
export CUADRILLA_AGENT_BRANCH_PREFIX=agent/   # opcional, es el valor por defecto
claude -p "/cuadrilla:ticket #42"
```

- Todo lo que pedía confirmación (merge/rebase, SQL, migraciones, instalaciones forzadas) pasa
  a estar bloqueado.
- Se permite un único push: `git push [-u] origin <prefijo><nombre>`, como comando solo.
- `gh pr create` tiene que usar `--draft`. Mergear, aprobar o marcar como listo sigue prohibido.
- Los agentes no se detienen a preguntar, registran sus **decisiones tomadas** y
  `/cuadrilla:ticket` termina en un PR en borrador con los checks fallidos al principio.

Ejecútalo en un contenedor o VM descartable, con un clon limpio, un token de grano fino limitado a
ese repositorio y protección de rama en la rama base. Detalle en el
[README en inglés](README.md#unattended-mode).

## Instalación

Requisitos: Claude Code, Node.js ≥ 18 (hooks) y git. Opcionales: `gh`, Docker.

```text
/plugin marketplace add <tu-usuario>/cuadrilla         # el repo de GitHub
/plugin install cuadrilla@cuadrilla                      # elegí el idioma de respuesta
/plugin install cuadrilla-python-fastapi@cuadrilla       # los packs de tus stacks
/plugin install cuadrilla-react@cuadrilla
```

Y en tu proyecto:

```text
/cuadrilla:adopt          # proyecto existente
/cuadrilla:adopt new      # desde cero
/cuadrilla:doctor         # verifica que todo esté conectado
```

Guía paso a paso: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

## Licencia

MIT: ver [LICENSE](LICENSE). Las skills de terceros que recomiendan los packs
conservan su licencia y se instalan desde su fuente original.
