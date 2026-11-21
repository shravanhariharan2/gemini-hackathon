import io
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from google.genai.errors import APIError
from PIL import Image
from character_swap.server import create_app


class APITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.client = TestClient(create_app(self.tmp.name, client_factory=lambda: object()))
        buf = io.BytesIO()
        Image.new('RGB', (20, 20)).save(buf, format='JPEG')
        self.photo = buf.getvalue()

    def prepare(self, src, dst):
        Path(dst).write_bytes(b'prepared')
        return {'duration': 8, 'aspect_ratio': '9:16'}

    def upload(self):
        return self.client.post('/api/clips', files={'video': ('clip.mp4', b'clip', 'video/mp4')})

    def poll(self, job_id):
        for _ in range(100):
            result = self.client.get(f'/api/swaps/{job_id}').json()
            if result['status'] in {'done', 'error'}:
                return result
            time.sleep(.01)
        self.fail('Background job did not finish')

    def test_flow(self):
        def swap(clip, photo, target, output, client):
            Path(output).write_bytes(b'generated video')
            return {'seconds': 1.25}
        with patch('character_swap.server.prepare_clip', side_effect=self.prepare), \
             patch('character_swap.server.describe_person', return_value='right dancer'), \
             patch('character_swap.server.swap_character', side_effect=swap):
            response = self.upload()
            self.assertEqual(response.status_code, 200)
            clip = response.json()
            self.assertEqual(self.client.get(clip['url']).content, b'prepared')
            description = self.client.post(f'/api/clips/{clip["clip_id"]}/describe',
                files={'frame': ('frame.jpg', self.photo, 'image/jpeg')}, data={'x': .7, 'y': .3})
            self.assertEqual(description.json(), {'description': 'right dancer'})
            job = self.client.post('/api/swaps', files={'photo': ('photo.jpg', self.photo, 'image/jpeg')},
                data={'clip_id': clip['clip_id'], 'target': 'right dancer'}).json()
            final = self.poll(job['job_id'])
            self.assertEqual(final, {'status': 'done', 'seconds': 1.25, 'error': None,
                                    'video_url': f'/api/swaps/{job["job_id"]}/video'})
            self.assertEqual(self.client.get(final['video_url']).content, b'generated video')

    def test_page_and_demo(self):
        page = self.client.get('/')
        self.assertEqual(page.status_code, 200)
        self.assertIn('Who to replace', page.text)
        self.assertIn('Clips of public figures are blocked by Gemini.', page.text)
        self.assertIn('3–10 seconds', page.text)
        self.assertIn('Add up to 3 clear, well-lit photos of the same face', page.text)
        self.assertIn('multiple hidden', page.text)
        demo = self.client.get('/demo/dancers.mp4')
        self.assertEqual(demo.status_code, 200)
        self.assertEqual(demo.headers['content-type'], 'video/mp4')
        self.assertGreater(len(demo.content), 1000)

    def test_multiple_photos(self):
        contents = [self.photo]
        for format in ('PNG', 'WEBP'):
            buf = io.BytesIO()
            Image.new('RGB', (20, 20)).save(buf, format=format)
            contents.append(buf.getvalue())
        def swap(clip, photos, target, output, client):
            self.assertEqual([path.read_bytes() for path in photos], contents[:len(photos)])
            Path(output).write_bytes(b'video')
            return {'seconds': 1}
        with patch('character_swap.server.prepare_clip', side_effect=self.prepare), \
             patch('character_swap.server.swap_character', side_effect=swap) as generate:
            clip = self.upload().json()['clip_id']
            for count in (2, 3):
                with self.subTest(count=count):
                    files = [('photo', (f'photo.{suffix}', data, mime)) for suffix, mime, data in
                             zip(('jpg', 'png', 'webp'), ('image/jpeg', 'image/png', 'image/webp'), contents)]
                    response = self.client.post('/api/swaps', files=files[:count],
                        data={'clip_id': clip, 'target': 'right dancer'})
                    self.assertEqual(response.status_code, 200)
                    final = self.poll(response.json()['job_id'])
                    self.assertEqual(final['status'], 'done')
                    self.assertEqual(len(generate.call_args.args[1]), count)
            self.assertFalse(list(Path(self.tmp.name).glob('*.jpg')))
            self.assertFalse(list(Path(self.tmp.name).glob('*.png')))
            self.assertFalse(list(Path(self.tmp.name).glob('*.webp')))

    def test_photo_validation_and_cleanup(self):
        good = ('photo', ('photo.jpg', self.photo, 'image/jpeg'))
        with patch('character_swap.server.prepare_clip', side_effect=self.prepare), \
             patch('character_swap.server.swap_character') as generate:
            clip = self.upload().json()['clip_id']
            data = {'clip_id': clip, 'target': 'right dancer'}
            self.assertEqual(self.client.post('/api/swaps', data=data).status_code, 422)
            self.assertEqual(self.client.post('/api/swaps', files=[good]*4, data=data).status_code, 422)
            for content, mime, status in ((b'bad', 'image/jpeg', 400),
                                           (b'', 'image/jpeg', 400),
                                           (b'bad', 'text/plain', 415),
                                           (b'x' * (15*1024*1024+1), 'image/jpeg', 413)):
                with self.subTest(status=status, size=len(content)):
                    response = self.client.post('/api/swaps',
                        files=[good, ('photo', ('bad.jpg', content, mime))], data=data)
                    self.assertEqual(response.status_code, status)
                    self.assertFalse(list(Path(self.tmp.name).glob('*.jpg')))
            generate.assert_not_called()

    def test_job_error_mapping(self):
        blocked = "Input blocked: Sorry, we can't create videos with real people's names or likenesses."
        cases = [
            (APIError(400, {'error': {'message': blocked, 'code': 'content_blocked'}}), True, None),
            (RuntimeError(f"Error code: 400 - { {'error': {'message': blocked, 'code': 'content_blocked'}}!r}"), True, None),
            (RuntimeError('Request rejected for safety reasons'), True, None),
            (RuntimeError('Gemini returned no video; the request may have been filtered'), True, None),
            (APIError(429, {'error': {'message': 'Quota exhausted'}}), False, 'Quota exhausted'),
            (RuntimeError("Error code: 400 - {'error': {'message': 'Invalid input'}}"), False, 'Invalid input'),
            (RuntimeError('model failed'), False, 'model failed'),
            (RuntimeError(''), False, ''),
        ]
        with patch('character_swap.server.prepare_clip', side_effect=self.prepare):
            clip = self.upload().json()['clip_id']
        for error, blocked, expected in cases:
            with self.subTest(error=str(error)), \
                 patch('character_swap.server.swap_character', side_effect=error):
                job = self.client.post('/api/swaps',
                    files={'photo': ('photo.jpg', self.photo, 'image/jpeg')},
                    data={'clip_id': clip, 'target': 'right dancer'}).json()
                result = self.poll(job['job_id'])
                self.assertEqual(result['status'], 'error')
                if blocked:
                    self.assertEqual(result['error_code'], 'content_blocked')
                    self.assertEqual(result['error'], "Gemini blocked this swap: Omni won't edit clips or photos showing recognizable real people (e.g. public figures). Try a different clip or photo.")
                else:
                    self.assertNotIn('error_code', result)
                    self.assertEqual(result['error'], expected)

    def test_errors(self):
        self.assertEqual(self.client.get('/api/swaps/missing').status_code, 404)
        self.assertEqual(self.client.get('/api/clips/missing/video').status_code, 404)
        self.assertEqual(self.client.post('/api/clips', files={'video': ('x', b'', 'video/mp4')}).status_code, 400)
        self.assertEqual(self.client.post('/api/clips', files={'video': ('x', b'x', 'text/plain')}).status_code, 415)
        with patch('character_swap.server.prepare_clip', side_effect=ValueError('bad clip')):
            self.assertEqual(self.upload().status_code, 400)
        with patch('character_swap.server.prepare_clip', side_effect=self.prepare), \
             patch('character_swap.server.swap_character', side_effect=RuntimeError('model failed')):
            clip = self.upload().json()['clip_id']
            for photo, target, expected in [(b'bad', 'target', 400), (self.photo, ' ', 422)]:
                self.assertEqual(self.client.post('/api/swaps',
                    files={'photo': ('photo.jpg', photo, 'image/jpeg')},
                    data={'clip_id': clip, 'target': target}).status_code, expected)
            self.assertEqual(self.client.post(f'/api/clips/{clip}/describe',
                files={'frame': ('frame.jpg', self.photo, 'image/jpeg')},
                data={'x': 2, 'y': .3}).status_code, 422)
            job = self.client.post('/api/swaps', files={'photo': ('photo.jpg', self.photo, 'image/jpeg')},
                data={'clip_id': clip, 'target': 'right dancer'}).json()
            result = self.poll(job['job_id'])
            self.assertEqual(result['status'], 'error')
            self.assertEqual(result['error'], 'model failed')
            self.assertEqual(self.client.get(f'/api/swaps/{job["job_id"]}/video').status_code, 409)
