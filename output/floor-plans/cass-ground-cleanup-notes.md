# CASS ground-floor cleanup preview

Source: `/Users/laputa/Desktop/Cass Ground Floor.jpeg`.

Output: `cass-ground-cleaned-draft.png`.

Created with the built-in image-generation editing tool. The original photograph is unchanged. This draft has not been installed in the application or validated as an accurate architectural plan.

The cleanup removes the photographed person's reflection, uneven lighting, glare, and surrounding background, and presents the drawing on white paper. Room numbers 109, 108, and 107 in the short left wing were checked against the original after correcting generation errors.

Small room labels, doors, stairs, and wall positions still need verification against the original photograph and the building before using this as an indoor reporting map. AI cleanup can change drawing details, even with preservation instructions. The preview demonstrates a possible visual treatment rather than a certified reconstruction. The second, third, and fourth floors now have separate cleaned drafts; see `cass-upper-floors-cleanup-notes.md`.

## Cleanup prompt

Use case: precise-object-edit. Edit target: the supplied photograph of the CASS GROUND FLOOR architectural plan. Produce one faithful cleaned scan, suitable as a draft indoor-map background, NOT a redesigned or imagined floor plan. Remove only photographic artifacts: person silhouette/reflections, glare, glass texture/moire, shadows, uneven illumination and surrounding photographed background. Correct the slight perspective so the sheet is flat, retaining the relative geometry of every drawn wall, door, staircase, corridor, room and external path. White paper, crisp near-black original linework, grayscale, no decorative color, no new symbols or features. Preserve the entire original floor plan including the upper diagonal classroom wing, lower library/department wing, right entrance/path, and GROUND FLOOR label; do not truncate it. Preserve readable room numbers and existing labels exactly at their original positions. If a label is illegible, leave that specific label faint or blank rather than inventing a room name or number. Critical invariants: no added or removed rooms, no guessed doors, no altered connectivity, no invented architectural geometry. Preserve imperfections in ambiguous original linework rather than hallucinating structural information. This is document restoration, not a polished architectural re-drawing.

## Final correction prompt

Change ONE room label and nothing else. In this floor-plan image there are TWO rooms labeled 108 in the short sloping wing near the left edge, beneath the stairs and above room 107. The UPPER 108, immediately below the left staircase, is wrong. Replace the UPPER 108 with the exact digits 109. The room number is centered approximately 15.8% of image width from the left and 51.4% of image height from the top. It must read 109 (one zero nine), NOT 108. Keep the LOWER 108 and bottom 107 unchanged. Keep EVERY other pixel/line/label, dimensions and appearance unchanged. No new architecture, no room edits, no cleanup or redesign. Single text correction only: upper 108 -> 109.
