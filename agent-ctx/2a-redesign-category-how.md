# Task 2-a: Redesign CategoryShowcase + HowItWorks

## Agent: redesign-category-how

## Summary

Redesigned both CategoryShowcase and HowItWorks components applying all 10 of Jakob Nielsen's Usability Heuristics. Both files maintain backward-compatible TypeScript props interfaces so vitrine.tsx continues to work without changes.

## Files Modified

- `/home/z/my-project/src/components/vitrine/category-showcase.tsx`
- `/home/z/my-project/src/components/vitrine/how-it-works.tsx`

## Key Design Decisions

### CategoryShowcase

- **CATEGORY_META map** — centralizes icon + emoji + examples + tooltip per slug, with fallback logic for substring matching
- **Provider count** — deterministic hash-based count per category ID (simulated; should come from API in production)
- **Scroll arrows** — only on desktop, hidden on mobile where native horizontal scroll is used
- **"Ver todas" expand** — shows first 12 categories by default, expand button when more exist
- **Active filter** — animated ring pulse, Badge chip with X button, "Limpar filtros" ghost button, all wrapped in AnimatePresence

### HowItWorks

- **Animated SVG connector** — uses framer-motion's `useScroll` + `useTransform` for scroll-driven line fill between step cards on desktop
- **Mobile timeline** — vertical line with gradient progress animation, Accordion component for expand/collapse per step
- **Mini illustrations** — small UI mock elements (search bar, calendar+checkmark, star rating) rendered as React nodes, not images
- **Per-step CTAs** — each step card has its own action button that routes contextually (browse providers, request quote, register)
- **Trust badge tooltips** — each trust badge has a descriptive tooltip explaining the guarantee

## Heuristic Mapping (both components)

| Heuristic           | CategoryShowcase                               | HowItWorks                                        |
| ------------------- | ---------------------------------------------- | ------------------------------------------------- |
| H1 Visibility       | Loading skeleton, count counter, animated ring | Scroll-driven progress line, check-mark animation |
| H2 Real world       | Emoji+icon, "Ex: encanador", provider count    | Concrete examples, mini UI illustrations          |
| H3 User control     | Clear filter, X button, re-click deselect      | Accordion, skip link, back-to-top                 |
| H4 Consistency      | Rounded-2xl, emerald accent, shadow system     | Same gradient, card radius, button styles         |
| H5 Error prevention | Empty state, retry, friendly messages          | "Sem compromisso" tagline                         |
| H6 Recognition      | Prominent icons, provider count, examples      | Large gradient icons, mini illustrations          |
| H7 Flexibility      | Scroll arrows, keyboard nav, expand button     | Per-step CTAs, clickable steps                    |
| H8 Minimalism       | Clean cards, whitespace, subtle borders        | One-liner descriptions, visual metaphors          |
| H9 Error recovery   | Graceful empty/error with retry                | "Sem compromisso" reassurance                     |
| H10 Help            | Tooltip per category                           | Expandable details, trust badge tooltips          |
