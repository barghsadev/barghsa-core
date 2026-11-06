import { RuleTester } from 'eslint';
import rule from './no-literal-colors.mjs';

new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
}).run('no-literal-colors', rule, {
  valid: [
    '<p className="text-primary bg-background" />',
    '<p style={{color: "var(--foreground)"}} />',
    '<a href="#overview">Details</a>',
    '<input placeholder="#RRGGBB" />',
  ],
  invalid: [
    '<p className="text-[#a42c35]" />',
    '<p style={{color: "#fff"}} />',
    '<p style={{color: "rgb(1 2 3 / 0.5)"}} />',
    '<p style={{color: "hsl(0 10% 10%)"}} />',
    '<p style={{color: `hsl(${hue}, 80%, 60%)`}} />',
    '<p style={{color: "oklch(0.5 0.1 180)"}} />',
  ].map((code) => ({ code, errors: [{ messageId: 'semantic' }] })),
});
