"""Both clients and server resolve the same hand-mapped floor areas."""

import json
import unittest
from pathlib import Path

from indoor_location import indoor_area, indoor_label, normalize_indoor_location


class IndoorAreaTests(unittest.TestCase):
    def test_room_library_office_corridor_and_unknown_samples(self):
        samples = json.loads((Path(__file__).parent / "indoor-area-samples.json").read_text())
        for floor, x, y, expected in samples:
            with self.subTest(floor=floor, x=x, y=y):
                point = normalize_indoor_location(
                    {"building_id": "old-cass", "floor_id": floor, "x": x / 1448, "y": y / 1086}
                )
                area = indoor_area(point)
                self.assertEqual(area["name"] if area else None, expected)
                if expected:
                    self.assertTrue(indoor_label(point).endswith(" · " + expected))
                    self.assertNotIn(expected, indoor_label(point, include_area=False))
        self.assertIsNone(indoor_area(None))
        self.assertIsNone(
            indoor_area({"building_id": "old-cass", "floor_id": "ground", "x": None, "y": None})
        )
