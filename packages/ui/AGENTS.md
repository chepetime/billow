# @billow/ui

This is Billow's shared presentation layer. Keep components prop-driven and
framework-agnostic: no database access, Next.js routing, auth clients, or
application state. Place reusable primitives in `src/base`, composed blocks in
`src/partials`, and adapters in `src/providers`.

Generated shadcn primitives live in `@billow/shadcn`. Compose them here rather
than modifying them. Business logic belongs in the consuming application.
