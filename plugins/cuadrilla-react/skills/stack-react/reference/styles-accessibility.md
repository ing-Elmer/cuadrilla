# Styles (Tailwind v4) and accessibility

## Tailwind v4, CSS-first

- Installed through `@tailwindcss/vite` (see `vite.config.example.ts`); no `tailwind.config.js`,
  no PostCSS config for Tailwind.
- One global stylesheet `src/index.css`, imported once in `main.tsx`:

```css
@import "tailwindcss";

/* Dark mode by class on <html> (ThemeContext toggles it; default from prefers-color-scheme). */
@custom-variant dark (&:where(.dark, .dark *));

/* Raw palette: the only place with literal colors. */
:root {
  --surface: oklch(0.99 0 0);
  --fg: oklch(0.21 0.02 260);
  --muted-fg: oklch(0.45 0.02 260);
  --primary: oklch(0.55 0.2 260);
  --primary-fg: oklch(0.99 0 0);
  --danger: oklch(0.58 0.22 27);
  --border: oklch(0.9 0.01 260);
  --ring: oklch(0.55 0.2 260);
}
.dark {
  --surface: oklch(0.18 0.02 260);
  --fg: oklch(0.96 0.01 260);
  /* … same names, dark values … */
}

/* Semantic tokens → utilities: bg-surface, text-fg, bg-primary, border-border, ring-ring… */
@theme inline {
  --color-surface: var(--surface);
  --color-fg: var(--fg);
  --color-muted-fg: var(--muted-fg);
  --color-primary: var(--primary);
  --color-primary-fg: var(--primary-fg);
  --color-danger: var(--danger);
  --color-border: var(--border);
  --color-ring: var(--ring);
  --radius-card: 0.75rem;
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
}
```

(Verified with Tailwind 4.3 + Vite 8.) Brand values come from the profile or the design; the
token names stay semantic.

## Style rules checkable in a diff

- Components use semantic token utilities (`bg-surface`, `text-fg`, `bg-primary
  text-primary-fg`, `border-border`). Not allowed in components: hex/`rgb()`/`oklch()` literals,
  arbitrary color values (`bg-[#1e40af]`), raw palette classes (`bg-white`, `text-gray-600`,
  `bg-red-500`), inline `style={{ color: … }}`.
- New token → add it to `:root`, `.dark` and `@theme inline` in the same change.
- Hand-written CSS only for what utilities cannot do (keyframes, scrollbar, third-party
  overrides), in `src/index.css`. No CSS modules, Sass, CSS-in-JS.
- Conditional classes with a tiny local `cx()` helper in `utils/` (or `clsx` if the project
  already has it); no new class-merging library without asking.
- Responsive mobile-first (`sm:`, `md:`, `lg:`); no fixed pixel widths for layout containers.
- Respect `prefers-reduced-motion` for animations.

## Shared UI (`components/ui/`) — build once, reuse

| Component | Contract |
|---|---|
| `DataTable<T>` | `@tanstack/react-table`; props `columns`, `data`, `isLoading`, `error`, `onRetry`, `emptyMessage`, server pagination (`page`, `pageSize`, `total`, `onPageChange`), optional sorting callbacks. Renders `<table>` with `<caption>` or `aria-label`, `<th scope="col">`. |
| `LoadingState` | `role="status"`, `aria-live="polite"`, text label (spinner is decorative). |
| `EmptyState` | message + optional action. |
| `ErrorState` | `role="alert"`, the user-facing message, "Retry" button calling `reload`. |
| `FormDialog` | native `<dialog>` (`showModal()`) or equivalent: focus trap, `Esc` closes, focus returns to the trigger, labelled by its title. |
| `ConfirmDialog` | replaces `window.confirm`; destructive action is explicit ("Delete customer"). |
| `FormField` / `SelectField` | `<label htmlFor>` + control + error text linked by `aria-describedby`, `aria-invalid` when in error. |
| `Button` | variants via tokens; `type` always set; `disabled` + busy label while pending. |

Before creating a component, search `components/ui/`; extend instead of duplicating (one modal,
one table, one toast).

## Accessibility minimum (WCAG 2.2 AA)

- Every form control has a visible `<label>` (or `aria-label` when visually impossible); placeholder
  is not a label.
- Icon-only buttons: `aria-label`; decorative icons `aria-hidden="true"`.
- Clickable things are `<button>` (actions) or `<a>`/`<Link>` (navigation); no `onClick` on
  `<div>`/`<span>`.
- Visible focus on every interactive element (`focus-visible:ring-2 ring-ring`); never
  `outline-none` without a replacement.
- Contrast ≥ 4.5:1 for text, 3:1 for large text and UI boundaries — check both themes.
- Keyboard: everything reachable with Tab in a logical order; dialogs trap focus and close on Esc;
  menus/listboxes support arrow keys if custom.
- Errors and async results announced: field errors via `aria-describedby`, form/global errors
  `role="alert"`, toasts in an `aria-live` region.
- One `<h1>` per page, headings in order; landmarks (`<header>`, `<nav aria-label>`, `<main>`).
- Images: meaningful `alt`, or `alt=""` if decorative. `<html lang>` set to the UI language.
- Route changes move focus to the page heading (or announce the new title) and update
  `document.title`.

`eslint-plugin-jsx-a11y` (recommended) catches part of this; the rest is checked in review and
by the core `qa` agent (keyboard pass on the flow).
