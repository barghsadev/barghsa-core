# Shared UI

Product imports use `@barghsa/ui`, `@barghsa/ui/form`, `@barghsa/ui/sonner` and `@barghsa/ui/direction-provider`. Import `@barghsa/ui/styles.css` once in the application. The package exports matching ESM/CommonJS declarations and keeps module boundaries for tree shaking. `pnpm --filter @barghsa/ui build` checks both formats and verifies that a Button-only browser bundle excludes Dialog, DatePicker and calendar libraries.

## Component catalogue

Run `pnpm --filter @barghsa/ui stories` for the local Ladle catalogue on `127.0.0.1:61000`. Build it with `pnpm --filter @barghsa/ui stories:build`, then use `stories:preview` to inspect the static output. `stories:typecheck` checks examples and real component props with the same strict compiler settings.

The catalogue uses the real shared components, CSS tokens and locally bundled fonts. Its RTL control selects Persian/Vazirmatn; LTR selects English/Inter. Light and dark controls apply the same document class and direction context used by the components. [Ladle providers](https://ladle.dev/docs/providers/) supply these controls to each story. The documentation compiler aliases the legacy JSX namespace expected by Ladle's MDX/Prism declarations to React 19's actual JSX types; it does not disable library checks or alter product types.

Stories group related compound components: primitives and their variants, menus/overlays, Base UI widgets, bound form adapters, filters/lists/cells, and workflow states. All examples use local sample data and callbacks. They make no account or business API requests. Story source and builds are excluded from product entries, navigation and the package's distribution files.

Use the shared `DirectionProvider` around headless widgets so portal placement follows the active direction. Give NumberField its input identifier on the root, not on NumberFieldInput, so its increment/decrement controls target the correct input. A labelled AvatarBadge needs a semantic role, such as `role="img"`; decorative badges can use `aria-hidden`. Command separators are decorative listbox content and are hidden from assistive technology.

`Label` accepts `required` for a decorative asterisk, localized `optional` text, and `disabled` for labels placed before disabled inputs. Keep the native input's `required`/`disabled` state in sync; the label does not change validation. `Badge dot` keeps its children as screen-reader text and shows only a colored dot on a transparent background. Input adornments compose `InputGroupInput`, logical start/end addons, labelled buttons, and associated helper/error text; block addons also work with `InputGroupTextarea`. The primitives stories demonstrate password visibility, clearing, status icons and text prefixes/suffixes without changing input binding or refs.

`Textarea` uses native content sizing, with a resize/reset fallback for browsers without it. It preserves native props and refs, including an explicit inline height. Use `TextareaWithCounter` when a limit needs a visible description: supply `maxLength` and a localized `counterLabel(count, limit)` formatter. It keeps existing helper/error descriptions and adds the counter description, handles controlled/uncontrolled values and native form resets, and uses the same UTF-16 units as native `maxLength`. Counter code is an opt-in export so ordinary textarea consumers can drop it.

`Alert` supports `info`, `success`, `warning`, `error` and `critical`, alongside the existing `default` and `destructive` variants. Critical alerts pulse a decorative ring while keeping text readable; reduced motion stops the animation. Compose `AlertAction` with `AlertDismiss` for separate actions and closing. Supply the dismiss button's localized `dismissLabel` and an `onDismiss` callback that owns removal and any follow-up focus. The dismiss button never submits a form.

The production-browser runner also tests the separately built catalogue:

```sh
BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs e2e/ladle-components.spec.ts --workers=3
```

Use the prebuilt flag only after verifying matching product and catalogue outputs. The catalogue test server binds only loopback, serves the immutable story build and closes after the run. Component scans keep all accessibility assertions; failed examples must be corrected before acceptance. Catalogue evidence does not certify customer routes, live providers or release readiness.
