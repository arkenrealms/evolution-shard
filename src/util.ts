export function distanceBetweenPoints(pos1, pos2) {
  return Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
}

export function moveVectorTowards(
  current: { x: number; y: number },
  target: { x: number; y: number },
  maxDistanceDelta: number
): { x: number; y: number } {
  const a = {
    x: target.x - current.x,
    y: target.y - current.y,
  };

  const magnitude = Math.sqrt(a.x * a.x + a.y * a.y);

  if (magnitude <= maxDistanceDelta || magnitude === 0) return target;

  return {
    x: current.x + (a.x / magnitude) * maxDistanceDelta,
    y: current.y + (a.y / magnitude) * maxDistanceDelta,
  };
}

// Method to format a number as a string with a sign
export function formatNumber(num: number): string {
  return num >= 0 ? '+' + num : '-' + num;
}
// Assume normalizeFloat is defined elsewhere in the class
export function normalizeFloat(value: number, precision: number = 2): number {
  return parseFloat(value.toFixed(precision));
}
