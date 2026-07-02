# Acceptance fixtures

Drop three pairs of real archviz images here, named:

```
ref1.jpg   base1.png      (pair 1)
ref2.jpg   base2.png      (pair 2)
ref3.jpg   base3.png      (pair 3)
```

- `refN` = the look you want (photo or render you're chasing).
- `baseN` = your current flat/unlit render of the scene, saved from the VFB / Vantage as
  display-referred sRGB PNG/JPG (not linear EXR).
- Keep the same VFB display settings across every attempt of a pair.

## Directional expectations (fill in when adding a pair)

| Pair | Must move (direction, not exact values) |
|------|------------------------------------------|
| 1    | e.g. warm the key, lift shadows, reduce highlight burn |
| 2    | |
| 3    | |

These are the manual smoke checks: a recipe for the pair must at minimum move in these
directions. Exact values are judged by the refine loop (look distance + your eyes), not here.

## Acceptance protocol (plan Task 9)

Per scene: full refine loop to look distance ≤5 **or** a structured grade-handoff whose
residual REFGRADE closes; end result judged ≥99% similar by the user; ≤5 rounds.
Log rounds + scores per scene in `docs/acceptance-log.md`.
