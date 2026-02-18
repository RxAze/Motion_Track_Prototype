export class RingBuffer<T> {
  private readonly capacityValue: number;
  private values: T[] = [];

  constructor(capacity: number) {
    this.capacityValue = Math.max(1, Math.floor(capacity));
  }

  push(value: T) {
    this.values.push(value);
    if (this.values.length > this.capacityValue) {
      this.values.shift();
    }
  }

  clear() {
    this.values = [];
  }

  isFull() {
    return this.values.length === this.capacityValue;
  }

  size() {
    return this.values.length;
  }

  capacity() {
    return this.capacityValue;
  }

  toArray() {
    return [...this.values];
  }
}
