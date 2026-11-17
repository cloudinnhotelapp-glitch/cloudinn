// Shared browser-test helpers.
import { expect, type Page } from '@playwright/test';

// Opens a table row's action menu (the "more" button named "Actions for …") and chooses one item.
export async function rowAction(page: Page, rowLabel: string, item: string) {
  await page.getByRole('button', { name: rowLabel, exact: true }).click();
  const menu = page.getByRole('menu', { name: rowLabel, exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item, exact: true }).click();
}

// Finds large white surfaces and hard-to-read text, working in real pixels so every CSS colour format is handled.
export function darkThemeProblems(scope: string): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const rgba = (color: string): [number, number, number, number] => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!, a! / 255];
  };
  const backdrop = (element: Element): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = rgba(getComputedStyle(node).backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] === 1) break;
    }
    let result: [number, number, number] = [11, 17, 32];
    for (const [r, g, b, a] of layers.reverse()) result = [r * a + result[0] * (1 - a), g * a + result[1] * (1 - a), b * a + result[2] * (1 - a)];
    return result;
  };
  const luminance = (color: number[]) => {
    const [r, g, b] = color.map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const describe = (element: Element) => `${element.tagName.toLowerCase()}.${String(element.getAttribute('class')).slice(0, 70)}`;
  const problems: string[] = [];
  for (const element of Array.from(document.querySelectorAll(`${scope} *`))) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || element.closest('[hidden], [aria-hidden="true"], .material-symbols-outlined')) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const [r, g, b, a] = rgba(style.backgroundColor);
    if (a > 0.8 && r > 235 && g > 235 && b > 235 && box.width * box.height > 900) problems.push(`white surface: ${describe(element)}`);
    const hasText = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
    if (!hasText || element.closest(':disabled, [aria-disabled="true"]') || Number(style.opacity) < 1) continue;
    const text = rgba(style.color);
    // White text on the brand-coloured buttons is the existing design, identical in both themes.
    if (text[0] > 245 && text[1] > 245 && text[2] > 245) continue;
    const under = backdrop(element);
    const shown = [0, 1, 2].map((i) => text[i]! * text[3] + under[i]! * (1 - text[3]));
    const [light, dark] = [luminance(shown), luminance(under)].sort((x, y) => y - x) as [number, number];
    if ((light + 0.05) / (dark + 0.05) < 3) problems.push(`low contrast: ${describe(element)} "${element.textContent!.trim().slice(0, 30)}"`);
  }
  return [...new Set(problems)];
}
