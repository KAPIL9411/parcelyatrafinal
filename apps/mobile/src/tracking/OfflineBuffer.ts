import type { CompactTransmissionPacket } from './GpsFilter.ts';

const MAX_BUFFER_SIZE = 500;

export class OfflineBuffer {
  private buffer: CompactTransmissionPacket[] = [];

  enqueue(packet: CompactTransmissionPacket): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      // Drop oldest point if buffer exceeds limit
      this.buffer.shift();
    }
    this.buffer.push(packet);
  }

  hasPoints(): boolean {
    return this.buffer.length > 0;
  }

  size(): number {
    return this.buffer.length;
  }

  /**
   * Returns copy of all buffered points.
   */
  getPoints(): CompactTransmissionPacket[] {
    return [...this.buffer];
  }

  /**
   * Clears successfully synced points.
   */
  clear(): void {
    this.buffer = [];
  }
}

