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
| `cuadrilla` (núcleo) | 8 agentes · 7 skills de estándar · 17 comandos · 4 hooks · MCP de GitHub, Atlassian y Playwright |
| `cuadrilla-python-fastapi` | Python + FastAPI + PostgreSQL (psycopg 3, SQL a mano, uv/ruff/mypy/pytest) |
| `cuadrilla-dotnet` | .NET + ASP.NET Core (4 proyectos, Dapper o EF Core, FluentValidation, xUnit) |
| `cuadrilla-node-typescript` | API en Node + TypeScript (Fastify, Zod, pg/Kysely, Vitest) |
| `cuadrilla-java-spring` | Java + Spring Boot (JdbcClient o JPA, Flyway, ArchUnit, JUnit 5) |
| `cuadrilla-react` | Frontend React + TypeScript + Vite + Tailwind v4 para cualquier backend |
| `cuadrilla-codex` (opcional) | Codex CLI como segundo ejecutor y revisor, siempre verificado por Claude |

Los comandos, hooks y servidores MCP están detallados en el [README en inglés](README.md#commands).

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
