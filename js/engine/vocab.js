/* Constants the whole explainer shares. Units: 1 world unit = 1000 km. */

export const EARTH_R = 6.371;          // km / 1000
export const EARTH_R_KM = 6371.0;
export const MU = 398600.4418;         // km^3 / s^2  (Earth's gravitational parameter)
export const C_KM_S = 299792.458;      // speed of light, km/s
export const GPS_A_KM = 26560;         // semi-major axis of a GPS orbit
export const GPS_I_DEG = 55;           // inclination
export const GPS_PERIOD_S = 43082;     // 11 h 58 m sidereal
export const GPS_N_SATS = 24;          // baseline constellation
export const KM = 1 / 1000;            // km -> world units
export const WGS_A = 6378.137;         // WGS84 semi-major axis, km
export const WGS_F = 1 / 298.257223563;

/** km -> world units */
export const u = (km) => km * KM;
/** world units -> km */
export const km = (uu) => uu * 1000;
