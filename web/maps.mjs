export const DEFAULT_MAP = 'crossyard';

// Entries are in the same order as the C++ MapId enum.
export const maps = Object.freeze({
  crossyard: 'CROSSYARD',
  cachette: 'Cachette',
  cafe: 'Cafe',
  library: 'Library',
  nyc: 'NYC',
  smuggler: 'Smuggler',
});
const mapKeys = Object.keys(maps);
export const mapId = key => typeof key === 'string' ? mapKeys.indexOf(key) : -1;
