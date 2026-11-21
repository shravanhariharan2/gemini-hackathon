"""Synthesize a horizontal stereo pair from relative inverse depth."""

import math

import cv2
import numpy as np


class StereoWarper:
    def __init__(self, height: int, width: int):
        self.height, self.width = height, width
        self.y, self.x = np.indices((height, width), dtype=np.int32)
        self.y_float = self.y.astype(np.float32)
        self.rows = self.y * width

    def _eye(self, frame, near, shift, crop):
        w = self.width
        target = np.rint(self.x + shift).astype(np.int32)
        inside = (target >= 0) & (target < w)
        # Keep the nearest sample at each collision, with its source column attached.
        ranks = (near * 4095).astype(np.int32) * w + self.x
        winner = np.full(self.height * w, -1, dtype=np.int32)
        np.maximum.at(winner, (self.rows + target)[inside], ranks[inside])
        winner = winner.reshape(self.height, w)
        visible = winner >= 0
        source = np.maximum(winner, 0) % w
        source_map = (self.x - shift[self.y, source]).astype(np.float32)

        # Fill disocclusions using the farther visible neighbor along the same row.
        left = np.maximum.accumulate(np.where(visible, self.x, -1), axis=1)
        right = np.minimum.accumulate(np.where(visible, self.x, w)[:, ::-1], axis=1)[:, ::-1]
        lc, rc = np.maximum(left, 0), np.minimum(right, w - 1)
        left_near, right_near = winner[self.y, lc] // w, winner[self.y, rc] // w
        choose_left = (right == w) | (
            (left != -1) & (
                (left_near + 40 < right_near)
                | ((np.abs(left_near - right_near) <= 40) & (self.x - left <= right - self.x))
            )
        )
        use_col = np.where(choose_left, lc, rc)
        source_map = np.where(visible, source_map, source_map[self.y, use_col])
        result = cv2.remap(
            frame, source_map, self.y_float, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        )
        if crop:
            result = cv2.resize(result[:, crop:-crop], (w, self.height), interpolation=cv2.INTER_LINEAR)
        return result

    def stereo(self, frame, near, strength, convergence):
        if strength == 0:
            return np.hstack((frame, frame))
        # A near point moves right in the left eye and left in the right eye.
        eye_range = strength * self.width / 2
        crop = math.ceil(eye_range * max(convergence, 1 - convergence))
        shift = (near - convergence) * eye_range
        return np.hstack((self._eye(frame, near, shift, crop), self._eye(frame, near, -shift, crop)))
