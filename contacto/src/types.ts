export type LocationPoint = {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: string;
};

export type Emergency = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: string;
  lastLocationAt: string;
  status: "active" | "finalized";
  startedAt: string;
  finishedAt?: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  track: LocationPoint[];
};

export type ActiveResponse = {
  emergencies: Emergency[];
  finalized: Emergency[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isLocationPoint(value: unknown): value is LocationPoint {
  return (
    isRecord(value) &&
    typeof value.lat === "number" &&
    typeof value.lng === "number" &&
    isNullableNumber(value.accuracy) &&
    typeof value.timestamp === "string"
  );
}

export function isEmergency(value: unknown): value is Emergency {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.lat === "number" &&
    typeof value.lng === "number" &&
    isNullableNumber(value.accuracy) &&
    typeof value.timestamp === "string" &&
    typeof value.lastLocationAt === "string" &&
    (value.status === "active" || value.status === "finalized") &&
    typeof value.startedAt === "string" &&
    (value.finishedAt === undefined ||
      value.finishedAt === null ||
      typeof value.finishedAt === "string") &&
    (value.acknowledgedBy === null || typeof value.acknowledgedBy === "string") &&
    (value.acknowledgedAt === null || typeof value.acknowledgedAt === "string") &&
    Array.isArray(value.track) &&
    value.track.every(isLocationPoint)
  );
}

export function isActiveResponse(value: unknown): value is ActiveResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.emergencies) &&
    value.emergencies.every(
      (emergency: unknown) =>
        isEmergency(emergency) && emergency.status === "active",
    ) &&
    Array.isArray(value.finalized) &&
    value.finalized.every(
      (emergency: unknown) =>
        isEmergency(emergency) && emergency.status === "finalized",
    )
  );
}
