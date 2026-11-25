import { createFileRoute, Outlet } from '@tanstack/react-router'

/** /containers (the list) and /containers/$id (one container) are separate pages. */
export const Route = createFileRoute('/_app/containers')({
  component: Outlet,
})
