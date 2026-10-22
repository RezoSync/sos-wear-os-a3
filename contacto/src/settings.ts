import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_BACKEND_URL } from "./api";

const STORAGE_KEY = "sos-contact-settings";

export type ContactSettings = {
  backendUrl: string;
  contactName: string;
  phone: string;
};

export const DEFAULT_SETTINGS: ContactSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  contactName: "",
  phone: "",
};

export async function loadSettings(): Promise<ContactSettings> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_SETTINGS;

  const parsed: unknown = JSON.parse(saved);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("La configuración guardada no es válida.");
  }

  const values = parsed as Partial<ContactSettings>;
  return {
    backendUrl:
      typeof values.backendUrl === "string"
        ? values.backendUrl
        : DEFAULT_SETTINGS.backendUrl,
    contactName: typeof values.contactName === "string" ? values.contactName : "",
    phone: typeof values.phone === "string" ? values.phone : "",
  };
}

export async function saveSettings(settings: ContactSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
