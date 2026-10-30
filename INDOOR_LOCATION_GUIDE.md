# Building and floor-plan locations

Seven buildings currently support the subtle hover enlargement and click selection: Old CASS, Main Library, Administration, Gymnasium, PRISM, Auditorium, and CCS. These footprints follow the supplied site-plan image. Buildings are selected directly on the map by mouse, touch, or keyboard focus. More footprints can be added as their outlines are checked.

Only Old CASS currently has supplied floor plans. Clicking any of the other six selects its campus pin and building name, and explains that the floor and room must be entered in **Location details**. **Use this building** returns to the map with that selection preserved. No floor count or blueprint is invented for buildings without supplied plans.

Old CASS is the first building with indoor reporting. Its clickable footprint on the campus plan opens four floor choices: Ground, Second, Third, and Fourth (Rooftop theatre). Hover or keyboard focus enlarges only the building's roof by 10% in place. The campus map and neighboring buildings stay at their original size. Click the building to choose a floor. Tap the building on phones, or focus its outline and press Enter or Space with a keyboard.

## Reporting a concern

The report dialog has three steps: **Location → Evidence photo → Report details**. Only the current step is shown, so the map opens before the title, categories, and description.

1. Open **Report a concern**. The campus map appears immediately in the Location step.
2. Click or tap the Old CASS footprint on the campus map.
3. Within one map frame, the campus map shifts left and floor-plan previews slide in on the right. On phones, both views share the frame vertically. There is no separate floor-choice card. The campus view fits the entire site plan into its available space.
4. Choose a preview: that floor slides to the center and fills the frame. It opens fitted to the visible drawing, excluding its hidden page margins. You can zoom, use **Fit floor**, or pan and use **Pin at center**.
5. Click the room, corridor, or area on the plan. Its mapped name fills the location, for example **Old CASS Building · Ground floor · Room 117**, and the dialog automatically advances to Evidence photo. Choosing only a building or floor does not complete an indoor pin.
6. Add an evidence photo, or continue without one. Photo screening and AI suggestions run before continuing. A blocked photo must be removed or replaced. Existing manual-review/unavailable-screening handling is unchanged.
7. Choose **Continue to report details**. Review and edit the suggested title, primary/additional categories, description, location, and extra directions. Submit for validation only from this final step.

**Back to location**, **Back to evidence**, and **Change location** move between steps while preserving the selected image, AI analysis, pin, and typed fields. To refine a pin, go back to Location and click or drag it; a completed selection advances to evidence again. Merely navigating back does not clear or submit the draft.

Inside the Location step, **Back to floor choices** returns to the campus map and in-map previews, preserving the floor and indoor pin. The campus map stays mounted; returning to floor choices fits the whole campus again. **Back to campus map** dismisses the floor panel. Map views are preserved while their wizard step is hidden.

Outdoor pins and a successful **Use current location** also advance to evidence. For buildings without supplied floor plans, **Use this building** confirms the building-level location; extra floor/room details can be entered in the final step. **Continue without a pin** preserves the existing ability to report a written location: it clears the map selection and the final step requires a campus location. Evidence remains optional.

Changing floors clears the previous floor's pin. Placing an outdoor pin or using current location replaces an indoor selection; **Clear pin** clears both. An explicit photo-geotag selection retains its existing behavior and does not replace an indoor pin.

The reporter, Main Admin, Validator, and authorized responsible-office staff can reopen the report and inspect its saved floor plan and pin. Other campus members receive only the approved shared summary, without the private indoor coordinates.

## Room and area identification

Each floor has named area polygons in `indoor-buildings.json`, traced against the existing cleaned 1448 × 1086 plan. Their `outline` points use the same normalized image coordinates as the pin. The browser and server both find the polygon containing the point; they do not pick the nearest text label or call an AI service for each click.

The current mapping covers readable ground-floor rooms 107–121 and second-floor rooms 208–222, named libraries/departments/offices, marked corridors, comfort rooms, stairs, and the ground-floor lift. The third floor includes readable rooms 302, 304, and 306, the Dean’s office, Law office, Law Library, corridors, and marked service areas. The fourth floor includes the labeled rooftop theatre and its stair/comfort-room areas. Unlabeled rooms and shaded roof areas are deliberately not assigned invented room numbers.

The selected polygon receives a subtle highlight and the pin has its area-name tooltip. An unmapped point keeps the building/floor label and prompts for written details. These are draft traced boundaries, so the reporter should check the name and use **Location details** for corrections. Replacing/cropping a source plan requires updating both area polygons and existing pin coordinates.

The server derives the area from the saved coordinates instead of accepting a client-supplied room name. Authorized reporters/staff see the specific room; shared campus summaries keep only the building and floor. Existing indoor pins can resolve against this catalog too. No new database table or migration is required for room identification.

## What the database stores

There is one report row, with one additional field rather than a separate report for each floor:

```json
{
  "building_id": "old-cass",
  "floor_id": "second",
  "x": 0.25,
  "y": 0.8
}
```

This JSON is stored as text in `reports.indoor_location`. `x` runs left to right and `y` runs top to bottom, each from 0 to 1. The example is 25% across and 80% down the image. Fractions keep the point in the same place when the display resizes or zooms.

These indoor coordinates are **not GPS**. `reports.latitude` and `reports.longitude` hold the building's approximate campus-map anchor. `reports.location` contains the building and floor label. `reports.location_details` holds the reporter's written room/office details. Existing outdoor reports have no indoor location.

The API rejects unknown buildings/floors, missing points, and coordinates outside the image. A selected floor without a point cannot be submitted as an indoor location.

## Database setup and deployment

SQLite adds the column automatically at server startup. New PostgreSQL installations include it in the initial schema. For existing Supabase installations, apply:

```text
supabase/migrations/202610290001_indoor_locations.sql
```

Run that file in Supabase SQL Editor as the project database owner before deploying the updated application. It adds the column to both `iit_voice.reports` and `iit_voice_demo.reports`. It is safe to run again and does not delete or replace reports. If the column is missing, the API gives an explicit setup error for indoor submissions; outdoor submissions continue to work.

The current project's regular and demo schemas received this migration on October 29, 2026. Application code still needs to be committed, pushed, and deployed by the project owner.

## Files and future buildings

- `indoor-buildings.json`: building IDs, campus-image footprint/anchor, available floor IDs/names, and named area polygons. Both Python and JavaScript use this catalog.
- `src/assets/floor-plans/`: cleaned plan images shipped with the application.
- `src/indoor-location.js`: coordinate helpers and labels.
- `src/components/FloorPlans.jsx`: floor selection, interactive indoor map, and saved-location viewer.
- `indoor_location.py`: server-side validation.

To add a building, obtain its floor plans, add a catalog entry with its actual campus footprint and available floors, and register the image imports in `FloorPlans.jsx`. Verify the footprint and each plan before enabling it. Keep existing IDs stable so saved reports continue to point to the correct plan.

The present plans are cleaned drafts derived from photographs. Some labels remain unverified. Pin accuracy depends on the source drawing; they are not surveyed indoor maps. GPS cannot determine which floor someone occupies. If a plan is replaced with a differently cropped or rotated image, existing pin coordinates must be transformed before switching assets.

The displayed floor plans hide the printed rectangular page frames with CSS clipping. Source images and normalized indoor coordinates stay unchanged; the building layout is not rescaled or redrawn.
