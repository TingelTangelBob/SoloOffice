/** Zerlegt `page` oder `page/filter` aus einem Link-Baustein. */
export function splitHelpPage(page: string): { page: string; filter?: string } {
  const [head, ...rest] = page.split('/');
  const filter = rest.join('/');
  return filter ? { page: head, filter } : { page: head };
}
