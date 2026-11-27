import model from "./anime-face-model.json" with { type: "json" };

const WINDOW_SIZE = 24;
type Face = { x: number; y: number; size: number };
type FaceGroup = Face & { votes: number };
const stages = model.stages as [number, number[][]][];

function grayscale(rgba: Uint8ClampedArray) {
  const pixels = new Uint8Array(rgba.length / 4);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i++) {
    const offset = i * 4;
    const value = Math.round(.299 * rgba[offset] + .587 * rgba[offset + 1] + .114 * rgba[offset + 2]);
    pixels[i] = value;
    histogram[value]++;
  }
  const first = histogram.findIndex(count => count > 0);
  const range = pixels.length - histogram[first];
  if (range <= 0) return pixels;
  const levels = new Uint8Array(256);
  let total = 0;
  for (let value = first + 1; value < levels.length; value++) {
    total += histogram[value];
    levels[value] = Math.round(255 * total / range);
  }
  return pixels.map(value => levels[value]);
}

// The integral image lets a feature compare nine rectangular blocks in constant time.
function integralImage(gray: Uint8Array, originalWidth: number, originalHeight: number, width: number, height: number) {
  const stride = width + 1;
  const sums = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    const sourceY = y * originalHeight / height;
    const top = Math.floor(sourceY);
    const bottom = Math.min(top + 1, originalHeight - 1);
    let row = 0;
    for (let x = 0; x < width; x++) {
      const sourceX = x * originalWidth / width;
      const left = Math.floor(sourceX);
      const right = Math.min(left + 1, originalWidth - 1);
      const blend = sourceX - left;
      const a = gray[top * originalWidth + left] * (1 - blend) + gray[top * originalWidth + right] * blend;
      const b = gray[bottom * originalWidth + left] * (1 - blend) + gray[bottom * originalWidth + right] * blend;
      row += Math.round(a + (b - a) * (sourceY - top));
      const i = y * stride + x + 1;
      sums[i + stride] = sums[i] + row;
    }
  }
  return sums;
}

function blockSum(sums: Int32Array, offset: number, width: number, row: number) {
  return sums[offset + width + row] - sums[offset + width] - sums[offset + row] + sums[offset];
}

function localPattern(sums: Int32Array, start: number, width: number, row: number, neighbors: number[]) {
  const mid = blockSum(sums, start + row + width, width, row);
  let pattern = 0;
  for (const offset of neighbors) {
    pattern = (pattern << 1) | Number(blockSum(sums, start + offset, width, row) >= mid);
  }
  return pattern;
}

function overlap(a: Face, b: Face) {
  const width = Math.max(0, Math.min(a.x + a.size, b.x + b.size) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.size, b.y + b.size) - Math.max(a.y, b.y));
  const shared = width * height;
  return shared / (a.size ** 2 + b.size ** 2 - shared);
}

export function detectAnimeFace(rgba: Uint8ClampedArray, width: number, height: number) {
  const gray = grayscale(rgba);
  const groups: FaceGroup[] = [];
  for (let scale = 1; Math.min(width, height) >= WINDOW_SIZE * scale; scale *= 1.08) {
    const w = Math.floor(width / scale);
    const h = Math.floor(height / scale);
    const stride = w + 1;
    const sums = integralImage(gray, width, height, w, h);
    const rectangles = model.features.map(([x, y, cellWidth, cellHeight]) => {
      const row = cellHeight * stride;
      const neighbors = [0, cellWidth, 2 * cellWidth, row + 2 * cellWidth, 2 * row + 2 * cellWidth, 2 * row + cellWidth, 2 * row, row];
      return { offset: x + y * stride, cellWidth, row, neighbors };
    });
    for (let y = 0; y <= h - WINDOW_SIZE; y++) {
      window: for (let x = 0; x <= w - WINDOW_SIZE; x++) {
        for (const [threshold, classifiers] of stages) {
          let score = 0;
          for (const classifier of classifiers) {
            const { offset, cellWidth, row, neighbors } = rectangles[classifier[0]];
            const pattern = localPattern(sums, y * stride + x + offset, cellWidth, row, neighbors);
            const matchesCategory = classifier[1 + (pattern >>> 5)] & (1 << (pattern & 31));
            score += classifier[matchesCategory ? 9 : 10];
          }
          if (score < threshold) continue window;
        }
        const candidate = { x: x * scale, y: y * scale, size: WINDOW_SIZE * scale };
        const group = groups.find(face => overlap(face, candidate) >= .32);
        if (group) {
          group.votes++;
          group.x += (candidate.x - group.x) / group.votes;
          group.y += (candidate.y - group.y) / group.votes;
          group.size += (candidate.size - group.size) / group.votes;
        } else groups.push({ ...candidate, votes: 1 });
      }
    }
  }
  const faces = groups.filter(face => face.votes >= 5);
  return faces.length === 1 ? faces[0] : null;
}

export function faceThumbnailPosition(face: Face, width: number, height: number): string {
  const side = Math.min(width, height);
  const position = (center: number, axis: number, target: number) => axis === side ? 50 :
    Math.round(100 * Math.max(0, Math.min(1, (center - side * target) / (axis - side))));
  return `${position(face.x + face.size / 2, width, .5)}% ${position(face.y + face.size / 2, height, .44)}%`;
}
