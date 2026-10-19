import base64
import io
import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from PIL import Image
from photo_analysis import prepare_photo, suggest_category


def sample_photo(gps=None, color="white"):
    exif = Image.Exif()
    exif[272] = 'Test camera'
    if gps is not None:
        exif[34853] = gps
    output = io.BytesIO()
    Image.new('RGB', (40, 30), color).save(output, 'JPEG', exif=exif)
    return base64.b64encode(output.getvalue()).decode()


class PhotoTests(unittest.TestCase):
    def test_reads_real_gps_and_strips_metadata_from_ai_copy(self):
        gps, encoded = prepare_photo(sample_photo({1: 'S', 2: (8, 14, 30), 3: 'W', 4: (124, 14, 38)}))
        self.assertEqual(gps, {'latitude': -8.241667, 'longitude': -124.243889})
        with Image.open(io.BytesIO(base64.b64decode(encoded))) as image:
            self.assertEqual(dict(image.getexif()), {})

    def test_does_not_invent_gps_for_missing_or_invalid_metadata(self):
        self.assertIsNone(prepare_photo(sample_photo())[0])
        self.assertIsNone(prepare_photo(sample_photo({1: 'N', 2: (98, 0, 0), 3: 'E', 4: (124, 0, 0)}))[0])

    def test_rejects_bad_images(self):
        for data in ('not-base64', base64.b64encode(b'not a photo').decode()):
            with self.assertRaises(ValueError):
                prepare_photo(data)

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_sends_image_to_gemini_and_validates_category(self):
        body = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps({'category': 'Facilities, Infrastructure & Maintenance', 'categories': ['Facilities, Infrastructure & Maintenance', 'Safety, Security & Risk'], 'description': 'A classroom chair has visible damage and requires inspection.', 'reason': 'Damaged chair.', 'title': 'Damaged classroom chair', 'screening': {'status': 'appropriate', 'reason': 'Campus equipment.'}})}]}}]}
        with patch('photo_analysis.urlopen') as call:
            call.return_value.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
            result = suggest_category('test-image-data')
        self.assertEqual(result['category'], 'Facilities, Infrastructure & Maintenance')
        self.assertEqual(result['title'], 'Damaged classroom chair')
        self.assertEqual(result['description'], 'A classroom chair has visible damage and requires inspection.')
        self.assertEqual(result['categories'], ['Facilities, Infrastructure & Maintenance', 'Safety, Security & Risk'])
        request = call.call_args[0][0]
        self.assertIn('generativelanguage.googleapis.com', request.full_url)
        self.assertNotIn('test-key', request.full_url)
        sent = json.loads(request.data)
        self.assertEqual(sent['safetySettings'][0]['threshold'], 'BLOCK_MEDIUM_AND_ABOVE')
        self.assertEqual(result['screening']['status'], 'appropriate')
        self.assertEqual(sent['contents'][0]['parts'][1]['inlineData']['data'], 'test-image-data')

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_rejects_invalid_or_incomplete_ai_result(self):
        for body in ({'candidates': []}, {'candidates': [{'finishReason': 'MAX_TOKENS'}]}, {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{"category":"Other","reason":"Unknown"}'}]}}]}):
            with patch('photo_analysis.urlopen') as call:
                call.return_value.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
                with self.assertRaises(RuntimeError):
                    suggest_category('image')

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_key_does_not_make_network_call(self):
        with patch('photo_analysis.urlopen') as call:
            with self.assertRaisesRegex(RuntimeError, 'not configured'):
                suggest_category('image')
            call.assert_not_called()

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_invalid_key_error_explains_how_to_fix_without_disclosing_key(self):
        body = {'error': {'message': 'API key not valid. Please pass a valid API key.', 'details': [{'reason': 'API_KEY_INVALID'}]}}
        error = HTTPError('https://generativelanguage.googleapis.com', 400, 'Bad request', {}, io.BytesIO(json.dumps(body).encode()))
        with patch('photo_analysis.urlopen', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, 'Replace GEMINI_API_KEY') as raised:
                suggest_category('image')
        self.assertNotIn('test-key', str(raised.exception))

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_provider_safety_blocks_and_model_rejection_never_expose_explicit_output(self):
        # Only mocked verdicts: no explicit images are used or sent.
        bodies = [
            {'promptFeedback': {'blockReason': 'SAFETY'}},
            {'candidates': [{'finishReason': 'SAFETY'}]},
            {'candidates': [{'finishReason': 'PROHIBITED_CONTENT'}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps({
                'category': 'Safety, Security & Risk', 'categories': ['Safety, Security & Risk'], 'title': 'Unwanted detail', 'description': 'Unwanted detail', 'reason': 'Unwanted detail',
                'screening': {'status': 'rejected', 'reason': 'Unwanted detail'}})}]}}]},
        ]
        for body in bodies:
            with patch('photo_analysis.urlopen') as call:
                call.return_value.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
                result = suggest_category('safe-test-placeholder')
                self.assertEqual(result['screening']['status'], 'rejected')
                self.assertIsNone(result['title'])
                self.assertIsNone(result['category'])
                self.assertNotIn('Unwanted detail', json.dumps(result))

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_unclear_evidence_is_flagged_not_rejected(self):
        result = {'category': None, 'categories': [], 'title': None, 'description': None, 'reason': 'No visible concern.',
                  'screening': {'status': 'needs_review', 'reason': 'Relevance is unclear.'}}
        body = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps(result)}]}}]}
        with patch('photo_analysis.urlopen') as call:
            call.return_value.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
            self.assertEqual(suggest_category('safe-test-placeholder'), result)

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_missing_or_invalid_screening_is_not_a_clearance(self):
        for screening in (None, {'status': 'approved', 'reason': 'test'}, {'status': 'appropriate', 'reason': 3}):
            result = {'category': 'Safety, Security & Risk', 'categories': ['Safety, Security & Risk'], 'title': 'Visible hazard', 'description': 'Visible obstruction in the walkway.', 'reason': 'Test', 'screening': screening}
            body = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps(result)}]}}]}
            with patch('photo_analysis.urlopen') as call:
                call.return_value.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
                with self.assertRaises(RuntimeError):
                    suggest_category('safe-test-placeholder')

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_service_outage_is_reported_without_blaming_configuration(self):
        error = HTTPError('https://generativelanguage.googleapis.com', 503, 'Service Unavailable', {}, io.BytesIO(b'{}'))
        with patch('photo_analysis.urlopen', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, 'temporarily unavailable.*manual review'):
                suggest_category('safe-test-placeholder')

    @patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True)
    def test_malformed_description_cannot_be_used_as_a_draft(self):
        result = {'category': 'Safety, Security & Risk', 'categories': ['Safety, Security & Risk'],
                  'title': 'Blocked walkway', 'reason': 'Visible obstruction.', 'description': ['not text'],
                  'screening': {'status': 'appropriate', 'reason': 'Campus evidence.'}}
        body = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps(result)}]}}]}
        with patch('photo_analysis.urlopen') as call:
            call.return_value.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
            with self.assertRaises(RuntimeError):
                suggest_category('safe-test-placeholder')
