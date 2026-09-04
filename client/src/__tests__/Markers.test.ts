import { describe, it, expect } from 'vitest';
import { adjacentMarker, currentMarkerIndex } from '../lib/markers';

const markers = [1000, 2000, 3000];

describe('adjacentMarker', () => {
  it('finds the next marker after the current position', () => {
    expect(adjacentMarker(markers, 1500, 1)).toBe(2000);
  });

  it('finds the previous marker before the current position', () => {
    expect(adjacentMarker(markers, 1500, -1)).toBe(1000);
  });

  it('skips the marker we are standing on (within tolerance)', () => {
    expect(adjacentMarker(markers, 2000, 1, 40)).toBe(3000);
    expect(adjacentMarker(markers, 2010, -1, 40)).toBe(1000);
  });

  it('returns null past the last / before the first marker', () => {
    expect(adjacentMarker(markers, 3000, 1)).toBeNull();
    expect(adjacentMarker(markers, 1000, -1)).toBeNull();
    expect(adjacentMarker([], 500, 1)).toBeNull();
  });

  it('does not depend on input ordering', () => {
    expect(adjacentMarker([3000, 1000, 2000], 1500, 1)).toBe(2000);
    expect(adjacentMarker([3000, 1000, 2000], 2500, -1)).toBe(2000);
  });
});

describe('currentMarkerIndex', () => {
  it('returns the index of the last marker at or before the position', () => {
    expect(currentMarkerIndex(markers, 2500)).toBe(1);
    expect(currentMarkerIndex(markers, 3000)).toBe(2);
  });

  it('returns -1 before the first marker or without markers', () => {
    expect(currentMarkerIndex(markers, 500)).toBe(-1);
    expect(currentMarkerIndex([], 500)).toBe(-1);
  });

  it('counts a marker slightly ahead within tolerance as current', () => {
    expect(currentMarkerIndex(markers, 1990, 40)).toBe(1);
    expect(currentMarkerIndex(markers, 1900, 40)).toBe(0);
  });
});
