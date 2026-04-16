// Segment-level Suspense fallback. Required so client components that
// use `useSearchParams` (plugins, settings, agents, etc.) don't bail the
// prerenderer in Next 15.
export default function MainLoading() {
  return null;
}
