export type Page = (arg?: string) => HTMLElement | Promise<HTMLElement>;
const routes: Record<string, Page> = {};
let outlet: HTMLElement;

export const route = (path: string, page: Page) => { routes[path] = page; };

export async function render() {
  const [path, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const page = routes[path || 'home'] ?? routes.home;
  outlet.replaceChildren();
  outlet.append(await page(arg));
  window.scrollTo(0, 0);
  document.querySelectorAll('nav a').forEach((a) =>
    a.classList.toggle('on', a.getAttribute('href') === `#/${path || 'home'}`));
}

export function start(el: HTMLElement) {
  outlet = el;
  addEventListener('hashchange', render);
  void render();
}
