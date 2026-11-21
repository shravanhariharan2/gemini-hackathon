"""Rebuild the original synthetic SBS fixture. Requires Pillow and ffmpeg.

Two parallel virtual cameras project the same rotating cube and reference grid.
This fixture is not AI-generated footage; it is a known stereo signal for tests.
"""
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

WIDTH, HEIGHT, FPS = 640, 360, 24
OUTPUT = Path(__file__).resolve().parents[1] / "public/demo/stereo-check.mp4"
process = subprocess.Popen([
    "ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH * 2}x{HEIGHT}",
    "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", str(OUTPUT),
], stdin=subprocess.PIPE)

for frame in range(FPS * 6):
    pair = Image.new("RGB", (WIDTH * 2, HEIGHT), "#101820")
    angle = frame / FPS * 0.45 + 0.4
    for eye, eye_x in enumerate((-0.09, 0.09)):
        image = Image.new("RGB", (WIDTH, HEIGHT), "#101820")
        draw = ImageDraw.Draw(image)

        def project(point):
            x, y, z = point
            # Converge the projection plane at z=5 without toe-in distortion.
            return (WIDTH / 2 + 420 * ((x - eye_x) / z + eye_x / 5), HEIGHT / 2 - 420 * y / z)

        for x in range(-8, 9):
            draw.line([project((x, -1.1, 2)), project((x, -1.1, 14))], fill="#293b4c", width=1)
        for z in range(2, 15):
            draw.line([project((-8, -1.1, z)), project((8, -1.1, z))], fill="#293b4c", width=1)

        # Distant dots provide a separate disparity plane from the foreground cube.
        for i in range(24):
            px, py = project((((i * 73) % 150) / 15 - 5, ((i * 37) % 75) / 20 - .4, 8 + i % 3))
            draw.ellipse((px-1, py-1, px+1, py+1), fill="#7790a6")
        points = []
        for x, y, z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
            xx, zz = x * math.cos(angle) + z * math.sin(angle), -x * math.sin(angle) + z * math.cos(angle)
            points.append((xx * .65, y * .65 + math.sin(frame / FPS) * .12, zz * .65 + 3.3))
        faces = [(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7),(1,5,6,2),(0,3,7,4)]
        for index, face in sorted(enumerate(faces), key=lambda item: -sum(points[i][2] for i in item[1])):
            polygon = [project(points[i]) for i in face]
            draw.polygon(polygon, fill=["#22548e", "#366fb1", "#4387d8", "#609cf0", "#316bb8", "#3b7bd1"][index])
            draw.line(polygon + [polygon[0]], fill="#a1d5ff", width=2)
        draw.text((24, 24), "ORBIT STUDY / STEREO SAMPLE", fill="#b7c5d3")
        draw.text((24, HEIGHT - 28), "SYNTHETIC CAMERA PAIR  /  6 SEC", fill="#7790a6")
        pair.paste(image, (eye * WIDTH, 0))
    process.stdin.write(pair.tobytes())
process.stdin.close()
if process.wait() != 0:
    raise SystemExit("ffmpeg failed")
