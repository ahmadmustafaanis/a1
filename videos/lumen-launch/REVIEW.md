# Review: Lumen hackathon film (78.0 s, 1920×1080, 30 fps)

**Built:** storyline A, "Grey to understood" (STORYLINES.md). Not built: B "Opus at work" (one take inside the app), C "0.29" (the number as the spine).

**Creative calls:** real CT (MSD liver case, CC BY-SA 4.0) for the hook; every product shot is real footage of Lumen recorded by driving the running app (videos/recorder/record.mjs). The kidney pull-out is driven through the app's own drag offset, since the headless recording shows no cursor. Payoff numbers come from the recorded session's held-out results (72% → 90% small lesions, 29% → 64% this spot, 7 of 305 weights by actual weight diff).

**Measured:** `check` passes (one info: the intended camera punch-in overflows its container). Render: 78.0 s, −15.2 LUFS integrated, −1.1 dBTP true peak, no clipping. **The sound was measured, not heard.**

**Fixed after review:** titles were split into word spans at runtime and doubled on re-run (showed `<…>` text): now pre-split at build. Title collisions at 4.5 s, 31 s, 35.5 s and 58 s; a spoiler (edited-model numbers) in the finding shot is pushed out of frame by the punch-in.

**Weakest shot:** 36–38 s, where the inspector briefly shows the edited model's "Detected 64%" before the payoff. Re-recording the finding shot with no saved session loaded would fix it.

**Kept on purpose:** the trade-off (false alarms 0 → 2.3%) isn't in the 78 s cut; it's visible in the app's comparison card.
