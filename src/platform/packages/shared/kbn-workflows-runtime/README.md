# Workflow runtime contracts

Dependency-light execution values shared by the authoring package and the runner.
Statuses, execution constants and runtime-only types belong here. Authoring schemas,
connector catalogs, translations and UI do not. Never import `@kbn/workflows` from here:
that package re-exports these values for compatibility.
