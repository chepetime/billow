# @billow/shadcn

This package contains unmodified shadcn/ui sources. Add and refresh shadcn
components from `apps/web` with the shadcn CLI; its monorepo configuration
routes generated UI files here.

Do not add Billow-specific behavior or styling here. Compose application UI in
`@billow/ui` or in a web wrapper that extends a shadcn component and re-exports
the application-facing API.
