import { createFileRoute, Outlet } from '@tanstack/react-router'

/** /images (the list) and /images/$id (one image) are separate pages. */
export const Route = createFileRoute('/_app/images')({
  component: Outlet,
})
