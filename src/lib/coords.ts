/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import proj4 from 'proj4';

export class CoordinateTransformer {
  private proj: string;
  private netOffset: [number, number];

  constructor(projParameter: string, netOffset: [number, number]) {
    // SUMO's projParameter is often something like "!" (Cartesian) or a PROJ string.
    // If it's "!", it's usually already in Cartesian or needs a simple offset.
    // If it's a PROJ string, we use proj4.
    this.proj = projParameter === '!' ? '' : projParameter;
    this.netOffset = netOffset;
  }

  /**
   * Converts WGS84 (lat, lon) to SUMO Cartesian (x, y)
   */
  toCartesian(lat: number, lon: number): [number, number] {
    let x, y;

    if (this.proj) {
      // Convert WGS84 to the network's projection
      [x, y] = proj4('EPSG:4326', this.proj, [lon, lat]);
    } else {
      x = lon;
      y = lat;
    }

    // Apply SUMO's netOffset
    return [x + this.netOffset[0], y + this.netOffset[1]];
  }

  /**
   * Converts SUMO Cartesian (x, y) to WGS84 (lat, lon)
   */
  toWGS84(x: number, y: number): [number, number] {
    // Reverse SUMO's netOffset
    const ox = x - this.netOffset[0];
    const oy = y - this.netOffset[1];

    if (this.proj) {
      const [lon, lat] = proj4(this.proj, 'EPSG:4326', [ox, oy]);
      return [lat, lon];
    } else {
      return [oy, ox];
    }
  }
}
