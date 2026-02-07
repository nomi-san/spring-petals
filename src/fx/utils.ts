
/** Random number utilities */
export const rand = () => Math.random()

/** Returns a random number in [min, max) */
export const randRange = (min: number, max: number) => min + rand() * (max - min)

/** Returns a random number in [-range/2, range/2) */
export const randSigned = (range: number) => (rand() - 0.5) * range