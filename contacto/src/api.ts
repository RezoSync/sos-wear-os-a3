import { isActiveResponse, isEmergency, type ActiveResponse, type Emergency } from "./types";

export const DEFAULT_BACKEND_URL = "http://192.168.x.x:3000";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("El servidor respondió con datos que no son JSON.");
    }

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `Error HTTP ${response.status}.`;
      throw new Error(message);
    }

    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("La solicitud tardó más de 5 segundos.");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("No se pudo conectar con el backend.");
  } finally {
    clearTimeout(timeout);
  }
}

export function getActive(baseUrl: string): Promise<ActiveResponse> {
  return request(`${normalizeBaseUrl(baseUrl)}/api/sos/active`).then(
    (body) => {
      if (!isActiveResponse(body)) {
        throw new Error("El servidor respondió con un estado SOS inválido.");
      }
      return body;
    },
  );
}

export function ack(
  baseUrl: string,
  id: string,
  contactName: string,
): Promise<Emergency> {
  return request(
    `${normalizeBaseUrl(baseUrl)}/api/sos/${encodeURIComponent(id)}/ack`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactName }),
    },
  ).then((body) => {
    if (!isEmergency(body)) {
      throw new Error("El servidor respondió con una emergencia inválida.");
    }
    return body;
  });
}

export function streamUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/sos/stream`;
}
