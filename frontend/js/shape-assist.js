const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function pathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function simplifyOpenPath(points, tolerance) {
  if (points.length < 3) return points;
  let farthestIndex = 0;
  let farthestDistance = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = distanceToSegment(points[index], points[0], points[points.length - 1]);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestDistance <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplifyOpenPath(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplifyOpenPath(points.slice(farthestIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

function simplifyClosedPolygon(points, tolerance) {
  const ring = points.slice();
  if (ring.length > 2 && Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) <= tolerance) ring.pop();
  if (ring.length < 3) return [];

  let farthestIndex = 1;
  let farthestDistance = 0;
  for (let index = 1; index < ring.length; index++) {
    const distance = Math.hypot(ring[index].x - ring[0].x, ring[index].y - ring[0].y);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }

  const firstArc = simplifyOpenPath(ring.slice(0, farthestIndex + 1), tolerance);
  const secondArc = simplifyOpenPath(ring.slice(farthestIndex).concat([ring[0]]), tolerance);
  let vertices = firstArc.slice(0, -1).concat(secondArc.slice(0, -1));
  vertices = vertices.filter((point, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > tolerance * 0.5;
  });

  let changed = true;
  while (changed && vertices.length > 3) {
    changed = false;
    for (let index = 0; index < vertices.length; index++) {
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      const current = vertices[index];
      const next = vertices[(index + 1) % vertices.length];
      if (distanceToSegment(current, previous, next) <= tolerance * 0.65) {
        vertices.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return vertices;
}

function isConvexPolygon(points) {
  let orientation = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1) continue;
    const sign = Math.sign(cross);
    if (orientation && sign !== orientation) return false;
    orientation = sign;
  }
  return orientation !== 0;
}

function boundsOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Remove one-frame fingertip jumps before fitting. Keep endpoints untouched so
// closure and line placement still follow the user's actual stroke.
function filterStrokeJitter(points) {
  if (points.length < 5) return points;
  const filtered = points.map((point) => ({ ...point }));
  for (let index = 1; index < points.length - 1; index++) {
    const window = points.slice(index - 1, index + 2);
    const medianX = median(window.map((point) => point.x));
    const medianY = median(window.map((point) => point.y));
    const jump = Math.hypot(points[index].x - medianX, points[index].y - medianY);
    if (jump > 3) {
      filtered[index] = {
        x: points[index].x * 0.25 + medianX * 0.75,
        y: points[index].y * 0.25 + medianY * 0.75,
      };
    }
  }
  return filtered;
}

function polygonFitError(points, vertices) {
  const errors = points.map((point) => {
    let closest = Infinity;
    for (let index = 0; index < vertices.length; index++) {
      closest = Math.min(closest, distanceToSegment(
        point,
        vertices[index],
        vertices[(index + 1) % vertices.length],
      ));
    }
    return closest;
  }).sort((a, b) => a - b);
  // Brief overshoots and retraced corner strokes are common with hand input.
  // Trim the worst 15% of point-to-edge errors so a small flourish does not
  // invalidate an otherwise clear polygon.
  const inlierCount = Math.max(1, Math.floor(errors.length * 0.85));
  const inlierErrors = errors.slice(0, inlierCount);
  return {
    mean: inlierErrors.reduce((sum, value) => sum + value, 0) / inlierErrors.length,
    p85: errors[Math.min(inlierCount - 1, Math.floor(errors.length * 0.85))],
  };
}

function robustLineFitError(points, start, end) {
  const errors = points.map((point) => distanceToSegment(point, start, end)).sort((a, b) => a - b);
  const inlierCount = Math.max(1, Math.floor(errors.length * 0.92));
  const inliers = errors.slice(0, inlierCount);
  return {
    mean: inliers.reduce((sum, value) => sum + value, 0) / inliers.length,
    p90: errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.9))],
  };
}

function polylineFitError(points, vertices) {
  const errors = points.map((point) => {
    let closest = Infinity;
    for (let index = 1; index < vertices.length; index++) {
      closest = Math.min(closest, distanceToSegment(point, vertices[index - 1], vertices[index]));
    }
    return closest;
  }).sort((a, b) => a - b);
  const inlierCount = Math.max(1, Math.floor(errors.length * 0.9));
  const inliers = errors.slice(0, inlierCount);
  return {
    mean: inliers.reduce((sum, value) => sum + value, 0) / inliers.length,
    p90: errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.9))],
  };
}

/** Return a simple shape only when the stroke strongly matches its geometry. */
export function recognizeCleanShape(points, brushSize = 8) {
  if (!Array.isArray(points) || points.length < 3) return null;
  points = filterStrokeJitter(points);
  const bounds = boundsOf(points);
  const diagonal = Math.hypot(bounds.width, bounds.height);
  const length = pathLength(points);
  if (points.length >= 2 && diagonal <= Math.max(26, brushSize * 3) && length <= Math.max(42, brushSize * 5)) {
    return {
      type: "dot",
      centerX: (bounds.left + bounds.right) / 2,
      centerY: (bounds.top + bounds.bottom) / 2,
      radius: Math.max(brushSize / 2, diagonal / 2),
    };
  }
  if (diagonal < Math.max(24, brushSize * 3)) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);

  // Clean an open, hand-drawn right-angle corner (such as an L or a rotated
  // corner). This is deliberately checked before line fitting so a corner
  // with a shallow overall diagonal is not mistaken for one bent line.
  const cornerTolerance = Math.max(8, diagonal * 0.025);
  const simplified = simplifyOpenPath(points, cornerTolerance);
  if (simplified.length === 3) {
    const [cornerStart, roughCorner, cornerEnd] = simplified;
    const firstLength = Math.hypot(roughCorner.x - cornerStart.x, roughCorner.y - cornerStart.y);
    const secondLength = Math.hypot(cornerEnd.x - roughCorner.x, cornerEnd.y - roughCorner.y);
    const cornerCosine = firstLength && secondLength
      ? Math.abs(((roughCorner.x - cornerStart.x) * (cornerEnd.x - roughCorner.x)
        + (roughCorner.y - cornerStart.y) * (cornerEnd.y - roughCorner.y)) / (firstLength * secondLength))
      : 1;
    if (firstLength >= Math.max(28, diagonal * 0.12)
        && secondLength >= Math.max(28, diagonal * 0.12)
        && cornerCosine <= 0.42) {
      const horizontalThenVertical = {
        x: cornerEnd.x,
        y: cornerStart.y,
      };
      const verticalThenHorizontal = {
        x: cornerStart.x,
        y: cornerEnd.y,
      };
      const corner = Math.hypot(
        roughCorner.x - horizontalThenVertical.x,
        roughCorner.y - horizontalThenVertical.y,
      ) <= Math.hypot(
        roughCorner.x - verticalThenHorizontal.x,
        roughCorner.y - verticalThenHorizontal.y,
      ) ? horizontalThenVertical : verticalThenHorizontal;
      const vertices = [cornerStart, corner, cornerEnd];
      const fit = polylineFitError(points, vertices);
      if (fit.mean <= Math.max(9, diagonal * 0.045)
          && fit.p90 <= Math.max(20, diagonal * 0.09)) {
        return { type: "open-polyline", points: vertices };
      }
    }
  }

  // Straight-line fit: tolerate a visibly wobbly diagonal while rejecting
  // strokes with a real bend. Ignore a few noisy samples from hand tracking.
  if (chord >= 28 && length > 0 && chord / length >= 0.72) {
    const fit = robustLineFitError(points, start, end);
    if (fit.mean <= Math.max(8, diagonal * 0.075)
        && fit.p90 <= Math.max(18, diagonal * 0.15)) {
      return { type: "line", start: { ...start }, end: { ...end } };
    }
  }

  const closeEnough = Math.max(brushSize * 3, diagonal * 0.22);
  const closed = Math.hypot(start.x - end.x, start.y - end.y) <= closeEnough;
  // Polygon paths can have a lower perimeter-to-diagonal ratio than circles,
  // especially for wide, shallow triangles like the user's example.
  if (!closed || bounds.width < 24 || bounds.height < 24 || length < diagonal * 1.55) return null;

  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const radialError = points.reduce((sum, point) => {
    const normalizedRadius = Math.sqrt(
      ((point.x - centerX) / rx) ** 2 + ((point.y - centerY) / ry) ** 2,
    );
    return sum + Math.abs(normalizedRadius - 1);
  }, 0) / points.length;

  // Axis-aligned rectangle fit: most points should follow the four bounds,
  // and the path must visit all four sides (a circle only touches each side).
  const edgeTolerance = Math.max(6, diagonal * 0.045);
  const edges = [0, 0, 0, 0];
  let nearEdgeCount = 0;
  for (const point of points) {
    const distances = [
      Math.abs(point.x - bounds.left),
      Math.abs(point.x - bounds.right),
      Math.abs(point.y - bounds.top),
      Math.abs(point.y - bounds.bottom),
    ];
    const nearest = distances.indexOf(Math.min(...distances));
    if (distances[nearest] <= edgeTolerance) {
      nearEdgeCount++;
      edges[nearest]++;
    }
  }
  if (nearEdgeCount / points.length >= 0.72 && edges.every((count) => count >= Math.max(2, points.length * 0.06))) {
    return { type: "rectangle", ...bounds };
  }

  // Fit triangles and other hand-drawn straight-sided polygons before the
  // ellipse check: wide triangles and trapezoids can have a deceptively low
  // average radial error when compared with their bounding ellipse.
  const closureGap = Math.hypot(start.x - end.x, start.y - end.y);
  const polygonTolerances = [0.025, 0.04, 0.06, 0.085, 0.11].map((fraction) => Math.max(6, diagonal * fraction));
  // If the user finishes with a short overshoot near the starting corner,
  // let simplification discard that tail and close the main polygon there.
  if (closureGap <= closeEnough) {
    polygonTolerances.push(Math.min(diagonal * 0.15, Math.max(7, closureGap * 1.08)));
  }

  let bestPolygon = null;
  let bestPolygonScore = Infinity;
  for (const tolerance of [...new Set(polygonTolerances)]) {
    const vertices = simplifyClosedPolygon(points, tolerance);
    if (vertices.length < 3 || vertices.length > 8 || !isConvexPolygon(vertices)) continue;
    const area = Math.abs(vertices.reduce((sum, point, index) => {
      const next = vertices[(index + 1) % vertices.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
    if (area < diagonal * diagonal * 0.12) continue;

    const fit = polygonFitError(points, vertices);
    const fitsStraightEdges = fit.mean <= Math.max(6, diagonal * 0.024)
      && fit.p85 <= Math.max(14, diagonal * 0.06);
    if (!fitsStraightEdges) continue;

    const score = fit.mean / diagonal + vertices.length * 0.001;
    if (score < bestPolygonScore) {
      bestPolygonScore = score;
      bestPolygon = vertices;
    }
  }
  if (bestPolygon) {
    return { type: bestPolygon.length === 3 ? "triangle" : "polygon", points: bestPolygon };
  }

  // Require a notably better radial fit before calling a closed stroke an
  // ellipse. Loose corners and straight edges should remain polygons.
  if (radialError <= 0.11 && Math.max(rx, ry) / Math.min(rx, ry) <= 2.4) {
    return { type: "ellipse", centerX, centerY, radiusX: rx, radiusY: ry };
  }
  return null;
}

function traceShape(ctx, shape) {
  ctx.beginPath();
  if (shape.type === "line") {
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.end.x, shape.end.y);
  } else if (shape.type === "ellipse") {
    ctx.ellipse(shape.centerX, shape.centerY, shape.radiusX, shape.radiusY, 0, 0, Math.PI * 2);
  } else if (shape.type === "rectangle") {
    ctx.rect(shape.left, shape.top, shape.width, shape.height);
  } else if (shape.type === "dot") {
    ctx.arc(shape.centerX, shape.centerY, shape.radius, 0, Math.PI * 2);
  } else if (shape.type === "open-polyline" || shape.type === "triangle" || shape.type === "polygon") {
    if (!shape.points?.length) return;
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
    if (shape.type !== "open-polyline") ctx.closePath();
  }
}

export function drawCleanShape(ctx, shape, color, brushSize) {
  if (!shape) return;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgb(${color.join(",")})`;
  ctx.fillStyle = `rgb(${color.join(",")})`;
  ctx.lineWidth = brushSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  traceShape(ctx, shape);
  if (shape.type === "dot") ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

/** Cover a recognized shape outline in a white-backed OCR image. */
export function maskCleanShape(ctx, shape, brushSize, offsetX = 0, offsetY = 0) {
  if (!shape) return;
  ctx.save();
  ctx.translate(-offsetX, -offsetY);
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = brushSize + 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  traceShape(ctx, shape);
  if (shape.type === "dot") ctx.fill();
  else ctx.stroke();
  ctx.restore();
}
