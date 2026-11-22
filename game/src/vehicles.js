// Cars: arcade physics (throttle, brake, steering that bites with speed) and the collision
// maths everything shares — a car is two circles, one over each axle, pushed out of
// building rectangles and off other cars' circles. Impacts report their closing speed so
// the world can price damage and crimes from them.
import { CAR, CITY } from './config.js';
import { clamp } from './rng.js';

let nextCarId = 1;

export function makeCar({ x, y, angle, color, kind = 'civil', maxSpeed = 305 }) {
  return {
    id: nextCarId++,
    x, y, angle, speed: 0,
    len: CAR.length, wid: CAR.width,
    color, kind, maxSpeed,
    health: 100,
    driver: null, // 'player', 'ai' or null (parked / stolen and left)
    parked: false,
    throttle: 0, steer: 0,
    brakeLight: false,
    stuckTime: 0, reverseTime: 0,
    hitCooldown: 0,
    ai: null,
  };
}

/** The two collision circles of a car: centres over the axles, radius a touch over half width. */
export function axleCircles(car) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const off = car.len * 0.30;
  const r = car.wid * 0.56;
  return [
    { x: car.x + fx * off, y: car.y + fy * off, r },
    { x: car.x - fx * off, y: car.y - fy * off, r },
  ];
}

/** Advance one car one step under throttle (-1..1) and steer (-1..1). */
export function stepCar(car, dt) {
  const throttle = clamp(car.throttle, -1, 1);
  if (throttle > 0) {
    car.speed += throttle * CAR.accel * dt * (car.health <= 0 ? 0.25 : 1);
  } else if (throttle < 0) {
    if (car.speed > 8) car.speed += throttle * CAR.brake * dt;
    else car.speed = Math.max(-CAR.maxReverse, car.speed + throttle * CAR.reverseAccel * dt);
  }
  car.speed -= car.speed * CAR.drag * dt;
  const cap = car.health <= 0 ? 60 : car.maxSpeed;
  car.speed = clamp(car.speed, -CAR.maxReverse, cap);
  if (Math.abs(car.speed) < 1.5 && throttle === 0) car.speed = 0;

  const steer = clamp(car.steer, -1, 1);
  const bite = clamp(car.speed / 130, -1, 1);
  car.angle += steer * CAR.turnRate * bite * dt * (1 - Math.min(Math.abs(car.speed) / (car.maxSpeed * 2.6), 0.45));

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.brakeLight = throttle < -0.05 || (throttle === 0 && Math.abs(car.speed) > 30);
  if (car.hitCooldown > 0) car.hitCooldown -= dt;
}

/** Push a circle out of a rectangle; returns the push vector or null. */
export function circleRectPush(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  let dx = cx - nx;
  let dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 < 0.0001) {
    // Centre inside the rectangle: leave by the nearest face.
    const left = cx - rect.x;
    const right = rect.x + rect.w - cx;
    const top = cy - rect.y;
    const bottom = rect.y + rect.h - cy;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { x: -(left + r), y: 0 };
    if (m === right) return { x: right + r, y: 0 };
    if (m === top) return { x: 0, y: -(top + r) };
    return { x: 0, y: bottom + r };
  }
  const d = Math.sqrt(d2);
  const push = (r - d) / d;
  return { x: dx * push, y: dy * push };
}

/**
 * Collide a car with the city's solid rectangles and the world edge. Moves the car out
 * and returns the hardest impact speed (0 when it touched nothing).
 */
export function collideCarWithCity(car, solids) {
  let impact = 0;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  for (const rect of solids) {
    for (const c of axleCircles(car)) {
      const push = circleRectPush(c.x, c.y, c.r, rect);
      if (push) {
        car.x += push.x;
        car.y += push.y;
        const into = -(car.speed * (fx * push.x + fy * push.y)) / Math.max(Math.hypot(push.x, push.y), 0.001);
        impact = Math.max(impact, into > 0 ? Math.abs(car.speed) * 0.9 : Math.abs(car.speed) * 0.35);
        car.speed *= 0.35;
      }
    }
  }
  // The world edge is a wall too.
  const m = car.len / 2;
  if (car.x < m) { car.x = m; impact = Math.max(impact, Math.abs(car.speed) * 0.5); car.speed *= 0.4; }
  if (car.y < m) { car.y = m; impact = Math.max(impact, Math.abs(car.speed) * 0.5); car.speed *= 0.4; }
  if (car.x > CITY.width - m) { car.x = CITY.width - m; impact = Math.max(impact, Math.abs(car.speed) * 0.5); car.speed *= 0.4; }
  if (car.y > CITY.height - m) { car.y = CITY.height - m; impact = Math.max(impact, Math.abs(car.speed) * 0.5); car.speed *= 0.4; }
  return impact;
}

/**
 * Collide two cars; both are pushed apart and slowed. Returns the closing speed along
 * the contact (0 when they did not touch).
 */
export function collideCars(a, b) {
  let impact = 0;
  const ca = axleCircles(a);
  const cb = axleCircles(b);
  for (const p of ca) {
    for (const q of cb) {
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const rr = p.r + q.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) / 2;
      const ux = dx / d;
      const uy = dy / d;
      a.x += ux * push; a.y += uy * push;
      b.x -= ux * push; b.y -= uy * push;
      const closing = Math.abs((a.speed * Math.cos(a.angle) - b.speed * Math.cos(b.angle)) * ux
        + (a.speed * Math.sin(a.angle) - b.speed * Math.sin(b.angle)) * uy);
      impact = Math.max(impact, closing);
      a.speed *= 0.72;
      b.speed *= 0.72;
    }
  }
  return impact;
}

/** Is a point within `reach` of the car's body? Used for doors, hits and sightings. */
export function nearCar(car, x, y, reach) {
  const dx = x - car.x;
  const dy = y - car.y;
  return dx * dx + dy * dy < (reach + car.len / 2) ** 2;
}
