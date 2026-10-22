import { useCallback, useEffect, useRef, useState } from "react";
import EventSource from "react-native-sse";
import { getActive, streamUrl } from "./api";
import {
  isActiveResponse,
  isEmergency,
  type ActiveResponse,
  type Emergency,
} from "./types";

type ConnectionStatus = "en-vivo" | "reconectando" | "sin-conexion";
type FeedEvent =
  | "snapshot"
  | "sos-created"
  | "sos-location"
  | "sos-ack"
  | "sos-finalized";

type SosFeed = {
  activas: Emergency[];
  finalizadas: Emergency[];
  conexion: ConnectionStatus;
  ultimaActualizacion: string | null;
  ultimoError: string | null;
};

const EMPTY_FEED: SosFeed = {
  activas: [],
  finalizadas: [],
  conexion: "reconectando",
  ultimaActualizacion: null,
  ultimoError: null,
};

function newerLocation(incoming: Emergency, current: Emergency): Emergency {
  const incomingAt = Date.parse(incoming.lastLocationAt);
  const currentAt = Date.parse(current.lastLocationAt);
  if (
    Number.isFinite(incomingAt) &&
    Number.isFinite(currentAt) &&
    incomingAt < currentAt
  ) {
    const incomingAckAt = incoming.acknowledgedAt
      ? Date.parse(incoming.acknowledgedAt)
      : 0;
    const currentAckAt = current.acknowledgedAt
      ? Date.parse(current.acknowledgedAt)
      : 0;
    const latestAcknowledgement =
      incomingAckAt >= currentAckAt ? incoming : current;
    return {
      ...incoming,
      lat: current.lat,
      lng: current.lng,
      accuracy: current.accuracy,
      timestamp: current.timestamp,
      lastLocationAt: current.lastLocationAt,
      track: current.track,
      acknowledgedBy: latestAcknowledgement.acknowledgedBy,
      acknowledgedAt: latestAcknowledgement.acknowledgedAt,
    };
  }
  return incoming;
}

function mergeEmergency(
  currentActives: Emergency[],
  currentFinalized: Emergency[],
  emergency: Emergency,
): Pick<SosFeed, "activas" | "finalizadas"> {
  const previous =
    [...currentActives, ...currentFinalized].find(
      (item) => item.id === emergency.id,
    ) ?? null;
  if (previous?.status === "finalized" && emergency.status === "active") {
    emergency = previous;
  } else if (previous) {
    emergency = newerLocation(emergency, previous);
  }

  const all = [...currentActives, ...currentFinalized].filter(
    (item) => item.id !== emergency.id,
  );
  all.push(emergency);
  return {
    activas: all.filter((item) => item.status === "active"),
    finalizadas: all.filter((item) => item.status === "finalized"),
  };
}

export function useSosFeed(
  backendUrl: string,
  enabled: boolean,
  onNewEmergency: (emergency: Emergency) => void,
) {
  const [feed, setFeed] = useState<SosFeed>(EMPTY_FEED);
  const seenIds = useRef(new Set<string>());
  const initializedForUrl = useRef<string | null>(null);
  const baselineReady = useRef(false);
  const newEmergencyCallback = useRef(onNewEmergency);
  newEmergencyCallback.current = onNewEmergency;

  const applyEmergency = useCallback((emergency: Emergency) => {
    setFeed((current) => ({
      ...current,
      ...mergeEmergency(current.activas, current.finalizadas, emergency),
      ultimaActualizacion: new Date().toISOString(),
    }));
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let source: EventSource<FeedEvent> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setInterval> | null = null;
    let polling = false;

    if (initializedForUrl.current !== backendUrl) {
      initializedForUrl.current = backendUrl;
      baselineReady.current = false;
      setFeed(EMPTY_FEED);
    }

    const updateBaseline = (snapshot: ActiveResponse) => {
      const incoming = [...snapshot.emergencies, ...snapshot.finalized];
      if (!baselineReady.current) {
        baselineReady.current = true;
        incoming.forEach((emergency) => seenIds.current.add(emergency.id));
        setFeed((current) => ({
          ...current,
          activas: snapshot.emergencies,
          finalizadas: snapshot.finalized,
          ultimaActualizacion: new Date().toISOString(),
          ultimoError: null,
        }));
        return;
      }

      for (const emergency of snapshot.emergencies) {
        if (!seenIds.current.has(emergency.id)) {
          seenIds.current.add(emergency.id);
          newEmergencyCallback.current(emergency);
        }
      }
      incoming.forEach((emergency) => seenIds.current.add(emergency.id));
      setFeed((current) => {
        const merged = [...current.activas, ...current.finalizadas];
        let result: Pick<SosFeed, "activas" | "finalizadas"> = {
          activas: current.activas,
          finalizadas: current.finalizadas,
        };
        for (const emergency of [...merged, ...incoming]) {
          result = mergeEmergency(result.activas, result.finalizadas, emergency);
        }
        return {
          ...current,
          ...result,
          ultimaActualizacion: new Date().toISOString(),
          ultimoError: null,
        };
      });
    };

    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const poll = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        updateBaseline(await getActive(backendUrl));
        if (!disposed && source === null) {
          setFeed((current) => ({
            ...current,
            conexion: "reconectando",
            ultimoError: null,
          }));
        }
      } catch (error) {
        if (!disposed && source === null) {
          setFeed((current) => ({
            ...current,
            conexion: "sin-conexion",
            ultimoError:
              error instanceof Error
                ? error.message
                : "No se pudo consultar el backend.",
          }));
        }
      } finally {
        polling = false;
      }
    };

    const startPolling = () => {
      if (pollTimer !== null || disposed) return;
      void poll();
      pollTimer = setInterval(() => void poll(), 2_000);
    };

    const connect = () => {
      if (disposed || source !== null) return;
      setFeed((current) => ({ ...current, conexion: "reconectando" }));
      const connection = new EventSource<FeedEvent>(streamUrl(backendUrl), {
        pollingInterval: 0,
        timeout: 0,
      });
      source = connection;

      connection.addEventListener("open", () => {
        if (disposed || source !== connection) return;
        stopPolling();
        setFeed((current) => ({
          ...current,
          conexion: "en-vivo",
          ultimoError: null,
        }));
      });

      connection.addEventListener("snapshot", (event) => {
        if (disposed || source !== connection || !event.data) return;
        try {
          const snapshot: unknown = JSON.parse(event.data);
          if (!isActiveResponse(snapshot)) {
            throw new Error("El snapshot no coincide con el contrato esperado.");
          }
          updateBaseline(snapshot);
        } catch (error) {
          setFeed((current) => ({
            ...current,
            ultimoError:
              error instanceof Error
                ? `No se pudo leer el snapshot: ${error.message}`
                : "No se pudo leer el snapshot SSE.",
          }));
        }
      });

      const handleEmergency = (event: { data: string | null }) => {
        if (disposed || source !== connection || !event.data) return;
        try {
          const parsed: unknown = JSON.parse(event.data);
          if (!isEmergency(parsed)) {
            throw new Error("El evento no contiene una emergencia válida.");
          }
          const emergency = parsed;
          if (emergency.status === "active" && !seenIds.current.has(emergency.id)) {
            seenIds.current.add(emergency.id);
            newEmergencyCallback.current(emergency);
          }
          seenIds.current.add(emergency.id);
          applyEmergency(emergency);
        } catch (error) {
          setFeed((current) => ({
            ...current,
            ultimoError:
              error instanceof Error
                ? `No se pudo leer un evento SSE: ${error.message}`
                : "No se pudo leer un evento SSE.",
          }));
        }
      };

      connection.addEventListener("sos-created", handleEmergency);
      connection.addEventListener("sos-location", handleEmergency);
      connection.addEventListener("sos-ack", handleEmergency);
      connection.addEventListener("sos-finalized", handleEmergency);
      connection.addEventListener("error", () => {
        if (disposed || source !== connection) return;
        source = null;
        connection.close();
        setFeed((current) => ({
          ...current,
          conexion: "reconectando",
          ultimoError: "Se perdió la conexión en tiempo real.",
        }));
        startPolling();
      });
    };

    connect();
    reconnectTimer = setInterval(connect, 10_000);

    return () => {
      disposed = true;
      stopPolling();
      if (reconnectTimer !== null) clearInterval(reconnectTimer);
      source?.close();
      source = null;
    };
  }, [applyEmergency, backendUrl, enabled]);

  return { ...feed, applyEmergency };
}
