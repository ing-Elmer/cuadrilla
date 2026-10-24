---
name: migration
description: Write the next numbered database migration script in the project's migrations folder, following the standard and the stack's convention. Never executes it.
argument-hint: '<description of the change>'
disable-model-invocation: true
---

Write the migration for: **$ARGUMENTS**

1. Take the migrations folder, database engine, schema and table prefix from the project profile
   (and the stack standard of the owning component for the naming convention, e.g. Flyway
   `V<NNN>__…` in Spring).
2. List the folder and compute the next free number. Warn if there are duplicate numbers.
3. Write the script following `cuadrilla:standard-data` and the style of the latest script of the
   same kind (idempotent where possible, one logical change, named constraints, FK indexes,
   comments on new objects, transaction where DDL is transactional).
4. If the change impacts repositories, DTOs or entities, list which files would need changes
   (don't modify them).
5. **Never run the script** or the migration tool. Show the file name and its content and tell
   the user how to run it on each environment.
