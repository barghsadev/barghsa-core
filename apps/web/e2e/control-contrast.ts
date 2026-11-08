import type { Locator } from '@playwright/test';

export async function measureControlContrast(
  control: Locator,
  kind: 'boundary' | 'underline' | 'indicator' | 'focus' | 'text',
  indicator?: string,
  textOpacity = 1
) {
  return control.evaluate(
    (element, { kind, indicator, textOpacity }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const resolve = (...colors: string[]) => {
        context.clearRect(0, 0, 1, 1);
        for (const color of colors) {
          if (!CSS.supports('color', color)) throw new Error(`Invalid color: ${color}`);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
        }
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return [red!, green!, blue!] as const;
      };
      const luminance = (rgb: readonly [number, number, number]) =>
        rgb.reduce((sum, channel, index) => {
          const value = channel / 255;
          const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
        }, 0);
      const compare = (first: string[], second: string[]) => {
        const a = luminance(resolve(...first));
        const b = luminance(resolve(...second));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const surroundings = ['white'];
      const ancestors: Element[] = [];
      for (let node = element.parentElement; node; node = node.parentElement)
        ancestors.unshift(node);
      for (const ancestor of ancestors)
        surroundings.push(getComputedStyle(ancestor).backgroundColor);
      const style = getComputedStyle(element);
      const fill = [...surroundings, style.backgroundColor];
      if (kind === 'text') {
        const ink =
          textOpacity === 1
            ? style.color
            : `color-mix(in srgb, ${style.color} ${textOpacity * 100}%, transparent)`;
        return compare([...fill, ink], fill);
      }
      if (kind === 'boundary' || kind === 'underline') {
        const edge = kind === 'boundary' ? 'Top' : 'Bottom';
        const border =
          style[`border${edge}Style`] !== 'none' && parseFloat(style[`border${edge}Width`]) > 0
            ? style[`border${edge}Color`]
            : 'transparent';
        return Math.max(compare(fill, surroundings), compare([...fill, border], surroundings));
      }
      if (kind === 'focus') {
        const ring = style.boxShadow
          .split(/,(?![^()]*\))/)
          .find((layer) => layer.includes('0px 0px 0px 4px'))
          ?.match(/(?:rgb[a]?|color|oklab|oklch)\([^)]+\)/)?.[0];
        if (!ring) throw new Error('Missing keyboard focus ring');
        return compare([...surroundings, ring], surroundings);
      }
      const target = element.querySelector(indicator!);
      if (!target) throw new Error(`Missing indicator: ${indicator}`);
      const cue = getComputedStyle(target);
      const color = target.matches('svg') ? cue.color : cue.backgroundColor;
      return compare([...fill, color], fill);
    },
    { kind, indicator, textOpacity }
  );
}
