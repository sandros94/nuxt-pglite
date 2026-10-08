import type { ContentNavigationItem } from '@nuxt/content'
import type { NavigationMenuItem } from '@nuxt/ui'

/** Whether `path` is `section` itself or one of its pages. */
function isWithin(path: string, section: string): boolean {
  return path === section || path.startsWith(`${section}/`)
}

/** The first page of a navigation item: an area without an index page links to its first page. */
function firstPage(item: ContentNavigationItem): string {
  const [child] = item.children ?? []
  return item.page === false && child ? firstPage(child) : item.path
}

/**
 * The top-level folders of the docs collection (Guide, Recipes, Reference),
 * each with its own sidebar. `area` is the one the route is in.
 */
export function useDocsAreas() {
  const navigation = inject<Ref<ContentNavigationItem[] | null | undefined>>('navigation')
  const route = useRoute()

  const areas = computed(() => navigation?.value?.filter((item) => item.children?.length) ?? [])
  const area = computed(() => areas.value.find((item) => isWithin(route.path, item.path)))

  const links = computed<NavigationMenuItem[]>(() =>
    areas.value.map((item) => ({
      label: item.title,
      icon: typeof item.icon === 'string' ? item.icon : undefined,
      to: firstPage(item),
      active: isWithin(route.path, item.path),
    })),
  )

  return { area, links }
}
