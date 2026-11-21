import base64
import io
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

from PIL import Image
from character_swap import core


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def clip(self, seconds=3, size='320x180'):
        path = self.root / 'input.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                        f'color=c=blue:s={size}:r=10', '-t', str(seconds),
                        '-c:v', 'libx264', str(path)], check=True)
        return path

    def test_prepare_landscape_trim(self):
        out = self.root / 'out.mp4'
        info = core.prepare_clip(self.clip(16), out)
        self.assertAlmostEqual(info['duration'], 15, places=1)
        self.assertEqual(info['aspect_ratio'], '16:9')
        self.assertEqual(core._probe(out)['streams'][0]['codec_name'], 'h264')

    def test_prepare_portrait_and_cap(self):
        out = self.root / 'out.mp4'
        info = core.prepare_clip(self.clip(3, '900x1600'), out)
        self.assertEqual(info['aspect_ratio'], '9:16')
        stream = core._probe(out)['streams'][0]
        self.assertEqual((stream['width'], stream['height']), (720, 1280))

    def test_prepare_rotation(self):
        source = self.clip()
        help_text = subprocess.check_output(
            ['ffmpeg', '-hide_banner', '-h', 'full'], stderr=subprocess.STDOUT, text=True)
        for angle in (90, -90):
            with self.subTest(angle=angle):
                rotated = self.root / f'rotated-{angle}.mp4'
                command = ['ffmpeg', '-v', 'error']
                if '-display_rotation' in help_text:
                    command += ['-display_rotation:v:0', str(angle), '-i', str(source),
                                '-c', 'copy']
                else:
                    command += ['-i', str(source), '-c', 'copy',
                                '-metadata:s:v:0', f'rotate={angle}']
                subprocess.run(command + [str(rotated)], check=True)
                stream = core._probe(rotated)['streams'][0]
                self.assertEqual((stream['width'], stream['height']), (320, 180))
                self.assertTrue(any(abs(side.get('rotation', 0)) == 90
                                    for side in stream.get('side_data_list', [])),
                                'Fixture must have rotation metadata, not rotated pixels')
                out = self.root / f'out-{angle}.mp4'
                self.assertEqual(core.prepare_clip(rotated, out)['aspect_ratio'], '9:16')
                stream = core._probe(out)['streams'][0]
                self.assertGreater(stream['height'], stream['width'])

    def test_rotation_metadata_formats(self):
        for metadata in ({'tags': {'rotate': '90'}},
                         {'tags': {'rotate': '-90'}},
                         {'side_data_list': [{'rotation': -90}]},
                         {'tags': {'rotate': '0'}, 'side_data_list': [{'rotation': 90}]}):
            with self.subTest(metadata=metadata):
                stream = {'codec_type': 'video', 'duration': '3',
                          'width': 320, 'height': 180, **metadata}
                with patch.object(core, '_probe', return_value={'streams': [stream]}):
                    self.assertEqual(core._video_info('clip'), (3, '9:16'))

    def test_prepare_rejects_short_and_invalid(self):
        with self.assertRaisesRegex(ValueError, 'at least 3'):
            core.prepare_clip(self.clip(2), self.root / 'out.mp4')
        invalid = self.root / 'invalid.mp4'
        invalid.write_bytes(b'')
        with self.assertRaises(ValueError):
            core.prepare_clip(invalid, self.root / 'out.mp4')

    def test_prompt(self):
        prompt = core.build_prompt('the blonde dancer on the right')
        for text in ['ONLY the blonde dancer on the right', 'clothing',
                     'choreography', 'other people', 'duration', 'Do not add']:
            self.assertIn(text, prompt)

    def client(self):
        client = Mock()
        client.files.upload.side_effect = [
            NS(state=NS(name='PROCESSING'), name='files/clip'),
            NS(state=NS(name='ACTIVE'), uri='photo-uri')]
        client.files.get.return_value = NS(state=NS(name='ACTIVE'), uri='clip-uri')
        client.interactions.create.return_value = NS(
            output_video=NS(data=base64.b64encode(b'video bytes').decode()))
        return client

    def test_swap(self):
        client = self.client()
        out = self.root / 'out.mp4'
        with patch.object(core, '_video_info', return_value=(8, '9:16')), patch.object(core.time, 'sleep'):
            result = core.swap_character('clip.mp4', 'photo.jpg', 'right dancer', out, client)
        self.assertEqual(out.read_bytes(), b'video bytes')
        call = client.interactions.create.call_args.kwargs
        self.assertEqual(call['model'], 'gemini-omni-1.2-flash')
        self.assertEqual(call['input'][:2], [{'type': 'video', 'uri': 'clip-uri'},
                                          {'type': 'image', 'uri': 'photo-uri'}])
        self.assertEqual(call['response_format'], {'type': 'video', 'aspect_ratio': '9:16'})
        self.assertFalse(call['store'])
        self.assertEqual(result['prompt'], call['input'][2]['text'])
        self.assertGreaterEqual(result['seconds'], 0)

    def test_swap_empty_and_failed_upload(self):
        for output in [None, NS(data=''), NS(data='%%%')]:
            client = self.client()
            client.interactions.create.return_value = NS(output_video=output)
            with patch.object(core, '_video_info', return_value=(8, '16:9')), patch.object(core.time, 'sleep'):
                with self.assertRaises((RuntimeError, ValueError)):
                    core.swap_character('clip', 'photo', 'target', self.root / 'out', client)
        client = Mock()
        client.files.upload.return_value = NS(state=NS(name='FAILED'))
        with patch.object(core, '_video_info', return_value=(8, '16:9')):
            with self.assertRaisesRegex(RuntimeError, 'processing failed'):
                core.swap_character('clip', 'photo', 'target', self.root / 'out', client)

    def test_describe_marker_and_fallback(self):
        buf = io.BytesIO()
        Image.new('RGB', (200, 200), 'white').save(buf, format='JPEG')
        client = Mock()
        client.interactions.create.return_value = NS(steps=[NS(type='model_output', content=[
            NS(type='text', text='the blonde dancer on the right')])])
        self.assertEqual(core.describe_person(buf.getvalue(), .7, .4, client),
                         'the blonde dancer on the right')
        marked = base64.b64decode(client.interactions.create.call_args.kwargs['input'][0]['data'])
        self.assertNotEqual(marked, buf.getvalue())
        client.interactions.create.side_effect = RuntimeError('offline')
        fallback = 'the person at about 70% from the left and 40% from the top of the frame'
        self.assertEqual(core.describe_person(buf.getvalue(), .7, .4, client), fallback)
        self.assertEqual(core.describe_person(b'', .7, .4, client), fallback)
        client.interactions.create.side_effect = None
        client.interactions.create.return_value = NS(steps=[])
        self.assertEqual(core.describe_person(buf.getvalue(), .7, .4, client), fallback)
