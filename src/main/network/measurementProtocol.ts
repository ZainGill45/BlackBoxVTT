import {
  MAX_MEASUREMENT_POINTS,
  type MeasurementEvent,
  type MeasurementPoint,
  type MeasurementUpdate,
} from '../../shared/network';

const UUID_BYTES = 16;
const CLIENT_HEADER_BYTES = 38;
const SERVER_HEADER_BYTES = CLIENT_HEADER_BYTES + UUID_BYTES;
const POINT_BYTES = 16;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClientMeasurement = Omit<MeasurementUpdate, 'campaignId'>;
type ServerMeasurement = Omit<MeasurementEvent, 'campaignId'>;

function uuidBytes(value: string): Buffer {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('Invalid measurement UUID.');
  }
  return Buffer.from(value.replaceAll('-', ''), 'hex');
}

function readUuid(payload: Buffer, offset: number): string {
  const hex = payload.subarray(offset, offset + UUID_BYTES).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function validateMeasurement(
  input: ClientMeasurement,
): ClientMeasurement {
  if (
    !Number.isInteger(input.updateSequence) ||
    input.updateSequence < 0 ||
    input.updateSequence > 0xffff_ffff ||
    input.points.length > MAX_MEASUREMENT_POINTS ||
    (input.active && input.points.length === 0) ||
    (!input.active && input.points.length !== 0) ||
    input.points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    throw new Error('Invalid measurement snapshot.');
  }
  uuidBytes(input.sceneId);
  uuidBytes(input.measurementId);
  return input;
}

function encodePoints(
  payload: Buffer,
  offset: number,
  points: MeasurementPoint[],
): void {
  points.forEach((point, index) => {
    const pointOffset = offset + index * POINT_BYTES;
    payload.writeDoubleBE(point.x, pointOffset);
    payload.writeDoubleBE(point.y, pointOffset + 8);
  });
}

function decodePoints(
  payload: Buffer,
  offset: number,
  count: number,
): MeasurementPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const pointOffset = offset + index * POINT_BYTES;
    return {
      x: payload.readDoubleBE(pointOffset),
      y: payload.readDoubleBE(pointOffset + 8),
    };
  });
}

function encodeBase(
  input: ClientMeasurement,
  headerBytes: number,
): Buffer {
  validateMeasurement(input);
  const payload = Buffer.alloc(headerBytes + input.points.length * POINT_BYTES);
  payload.writeUInt8(input.active ? 1 : 0, 0);
  payload.writeUInt8(input.points.length, 1);
  payload.writeUInt32BE(input.updateSequence, 2);
  uuidBytes(input.sceneId).copy(payload, 6);
  uuidBytes(input.measurementId).copy(payload, 22);
  return payload;
}

function decodeBase(
  payload: Buffer,
  headerBytes: number,
): ClientMeasurement {
  if (payload.length < headerBytes) {
    throw new Error('Measurement snapshot is truncated.');
  }
  const flags = payload.readUInt8(0);
  const pointCount = payload.readUInt8(1);
  if (
    flags > 1 ||
    pointCount > MAX_MEASUREMENT_POINTS ||
    payload.length !== headerBytes + pointCount * POINT_BYTES
  ) {
    throw new Error('Invalid measurement snapshot.');
  }
  return validateMeasurement({
    active: flags === 1,
    measurementId: readUuid(payload, 22),
    points: decodePoints(payload, headerBytes, pointCount),
    sceneId: readUuid(payload, 6),
    updateSequence: payload.readUInt32BE(2),
  });
}

export function encodeClientMeasurement(input: ClientMeasurement): Buffer {
  const payload = encodeBase(input, CLIENT_HEADER_BYTES);
  encodePoints(payload, CLIENT_HEADER_BYTES, input.points);
  return payload;
}

export function decodeClientMeasurement(payload: Buffer): ClientMeasurement {
  return decodeBase(payload, CLIENT_HEADER_BYTES);
}

export function encodeServerMeasurement(input: ServerMeasurement): Buffer {
  uuidBytes(input.sourceId);
  const payload = encodeBase(input, SERVER_HEADER_BYTES);
  uuidBytes(input.sourceId).copy(payload, CLIENT_HEADER_BYTES);
  encodePoints(payload, SERVER_HEADER_BYTES, input.points);
  return payload;
}

export function decodeServerMeasurement(payload: Buffer): ServerMeasurement {
  const input = decodeBase(payload, SERVER_HEADER_BYTES);
  return {
    ...input,
    sourceId: readUuid(payload, CLIENT_HEADER_BYTES),
  };
}
