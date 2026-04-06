# HermodProgress Component Integration

**Date:** 2026-02-22
**Status:** Approved

## Summary

Integrate a Norse-themed loading modal (`HermodProgress`) into the Hermod app. The component alternates between two visual styles (Molten Forge / Bifrost Constellation) on each loading event via round-robin. It renders as a centered modal dialog with a dark backdrop, canvas-based particle effects, and Elder Futhark rune animations.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Target project | Hermod (this repo) | Component is named for and themed around Hermod |
| Design token adaptation | Keep as-is | Component has its own tuned gold (#D4AF37) for canvas glow effects |
| Integration scope | Long-running ops only | Query execution + test email send. Quick saves/nav keep existing patterns |
| Closeable during ops | No | No way to cancel backend operations; modal hides on complete/error |
| Animation mode | Auto-animated loop | Can't track real % progress of SQL queries or email sends |
| Context pattern | Matches toast.tsx | Provider + hook, single instance in providers.tsx |

## File Structure

```
src/components/
  hermod-progress.tsx          <- Component (from zip, as-is)
  hermod-progress.css          <- Companion CSS (from zip, as-is)
  hermod-loading-context.tsx   <- Context + Provider + Hook (new)
  providers.tsx                <- Edit: add HermodLoadingProvider
```

## Context Hook API

```tsx
interface HermodLoadingContextType {
  showLoading: (statusText?: string) => void;
  hideLoading: () => void;
  setProgress: (value: number) => void;  // 0-100, for future trackable ops
}
```

Provider renders single `<HermodProgress>` with:
- `variant="round-robin"` (alternates forge/bifrost each open)
- `progress={undefined}` by default (auto-animate loop)
- `onClose={undefined}` (non-closeable)
- `statusText` from `showLoading()` argument

## Integration Points

### 1. Query Execution (report-editor.tsx)
- When `running` transitions to `true`: `showLoading("Forging the query results...")`
- When query completes/errors: `hideLoading()`
- Existing `running` state stays (still disables Run button) — HermodProgress is additive

### 2. Test Email Send (report-editor.tsx or test-send handler)
- When send starts: `showLoading("Dispatching the raven...")`
- When send completes/errors: `hideLoading()`
- Existing button disable logic stays

## What NOT to Change in the Component
- Do not refactor canvas animation logic into separate files
- Do not replace companion CSS with Tailwind @keyframes
- Do not remove module-level `globalRoundRobinCounter`
