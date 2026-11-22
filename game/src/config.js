// Palmera Heat — shared constants: the city's dimensions, the dusk palette and the tuning
// numbers every other module reads. One place to change how big the world is and how it feels.

/** The playfield canvas is always this size; CSS stretches it to the window. */
export const VIEW = { width: 1280, height: 800 };

/** The simulation's fixed step, in seconds. */
export const STEP = 1 / 60;

/** City grid: square blocks separated by roads, in world pixels. */
export const CITY = {
  cols: 7,
  rows: 6,
  pitch: 312, // one block plus one road
  road: 76, // road width; the rest of the pitch is block
  sidewalk: 16, // pavement ring inside each block
  get width() { return this.cols * this.pitch + this.road; },
  get height() { return this.rows * this.pitch + this.road; },
};

/** Lane offset from a road's centre line; traffic keeps right. */
export const LANE = 19;

/** The person on foot. */
export const FOOT = {
  radius: 9,
  walkSpeed: 148,
  runSpeed: 248,
  enterRange: 48, // how close to a car door F works
};

/** Car handling, shared by the player's car, traffic and police (they scale it). */
export const CAR = {
  length: 46,
  width: 23,
  accel: 270,
  brake: 430,
  reverseAccel: 150,
  maxReverse: 95,
  drag: 0.32,
  turnRate: 2.05, // radians a second at full lock and speed
};

/** Wanted tuning: heat is a float 0..5, the stars shown are its ceiling. */
export const HEAT = {
  stealWitnessed: 1.0,
  stealUnseen: 0.35,
  hitCar: 0.6,
  hitCarUnseen: 0.25,
  hitPed: 1.25,
  witnessRadius: 300, // a pedestrian this close sees a crime
  policeSight: 480, // police this close keep the heat on
  hideSeconds: 5.5, // unseen this long and the stars start to fall
  decayPerSecond: 0.22,
  max: 5,
};

/** Dusk over Palmera: warm roofs, indigo shadows, neon signs. */
export const PALETTE = {
  asphalt: '#33323e',
  asphaltDark: '#2b2a35',
  laneMark: '#c8b98a',
  crosswalk: '#8f8a9c',
  sidewalk: '#8f8a96',
  blockGround: '#59634d',
  blockGroundAlt: '#66584e',
  plaza: '#7a7268',
  player: '#ffd23f',
  objective: '#ffc233',
  policeBlue: '#3f7dff',
  policeRed: '#ff4757',
  cash: '#7be495',
  text: '#f5efe4',
  muted: '#b8b0a0',
};

/** Roof colours at dusk: terracotta, sand, faded teal and rose. */
export const ROOF_COLORS = [
  '#b5654a', '#c98a5a', '#a85f68', '#7d8c99', '#5f7d7a', '#c2a15c',
  '#8a6f9e', '#4f6f8f', '#d09a6a', '#96604f', '#6d8f5f', '#b0524f',
];

/** Original Palmera businesses whose signs glow over the rooftops. */
export const SHOP_SIGNS = [
  'HOTEL BRISA', 'CAFE OLA', 'BANCO DEL MAR', 'CLUB PALMA', 'TORRE AZUL',
  'MERCADO SOL', 'FARMACIA VIDA', 'TALLER REYES', 'CINE LUMEN', 'PIZZA FARO',
  'GYM MAREA', 'LIBROS LUNA', 'BAR CORAL', 'JOYAS PERLA', 'DISCOS ONDA',
];

/** Paint jobs for civilian cars. */
export const CAR_COLORS = [
  '#d94f3d', '#3d7bd9', '#e0a51f', '#43a06a', '#e8e4da', '#7a4fd0',
  '#d96fb0', '#3fb8b0', '#8a8f99', '#23262f', '#c96a2c', '#5b84c4',
];

/** Where progress is kept between visits (this browser only). */
export const SAVE_KEY = 'palmera-heat-save-v1';

export const FONT = '"Avenir Next", "Segoe UI", system-ui, sans-serif';
