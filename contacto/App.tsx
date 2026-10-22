import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ack, getActive } from "./src/api";
import { EmergencyMap } from "./src/EmergencyMap";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type ContactSettings,
} from "./src/settings";
import type { Emergency } from "./src/types";
import { useSosFeed } from "./src/useSosFeed";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Screen = "principal" | "configuracion";
type ListRow =
  | { kind: "section"; id: string; title: string; count: number }
  | { kind: "emergency"; emergency: Emergency };

function formatTime(value: string | null): string {
  if (!value) return "Esperando datos";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Hora no disponible";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function AppContent() {
  useKeepAwake();

  const [settings, setSettings] = useState<ContactSettings>(DEFAULT_SETTINGS);
  const [form, setForm] = useState<ContactSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("principal");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const [newAlert, setNewAlert] = useState<Emergency | null>(null);
  const [permissionWarning, setPermissionWarning] = useState<string | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState<string[]>([]);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const [connectionTest, setConnectionTest] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSettings()
      .then((saved) => {
        if (active) {
          setSettings(saved);
          setForm(saved);
        }
      })
      .catch((error: unknown) => {
        if (active) setPermissionWarning(`No se pudo cargar la configuración: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setSettingsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const prepareNotifications = async () => {
      try {
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("sos", {
            name: "Alertas SOS",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 700, 300, 700],
            lightColor: "#ff3347",
            sound: "default",
          });
        }

        let permission = await Notifications.getPermissionsAsync();
        if (!permission.granted) {
          permission = await Notifications.requestPermissionsAsync();
        }
        if (!permission.granted && active) {
          setPermissionWarning(
            "Las notificaciones están desactivadas. Actívalas en Ajustes para recibir la alerta del sistema.",
          );
        }
      } catch (error) {
        if (active) {
          setPermissionWarning(
            `No se pudo preparar las notificaciones: ${errorMessage(error)}`,
          );
        }
      } finally {
        if (active) setNotificationsReady(true);
      }
    };
    void prepareNotifications();
    return () => {
      active = false;
    };
  }, []);

  const handleNewEmergency = useCallback((emergency: Emergency) => {
    setNewAlert(emergency);
    Vibration.vibrate([0, 900, 350, 900]);
    void Notifications.scheduleNotificationAsync({
      content: {
        title: `¡SOS de ${emergency.name}!`,
        body: `Ubicación: ${emergency.lat.toFixed(5)}, ${emergency.lng.toFixed(5)}`,
        sound: "default",
        ...(Platform.OS === "android" ? { channelId: "sos" } : {}),
      },
      trigger: null,
    }).catch((error: unknown) => {
      setPermissionWarning(
        `No se pudo mostrar la notificación local: ${errorMessage(error)}`,
      );
    });
  }, []);

  const feed = useSosFeed(
    settings.backendUrl,
    settingsLoaded && notificationsReady,
    handleNewEmergency,
  );

  const rows = useMemo<ListRow[]>(() => {
    const activeRows: ListRow[] = feed.activas.map((emergency) => ({
      kind: "emergency",
      emergency,
    }));
    const finalizedRows: ListRow[] = feed.finalizadas.map((emergency) => ({
      kind: "emergency",
      emergency,
    }));
    return [
      { kind: "section", id: "active-section", title: "Activas", count: activeRows.length },
      ...activeRows,
      {
        kind: "section",
        id: "finalized-section",
        title: "Finalizadas",
        count: finalizedRows.length,
      },
      ...finalizedRows,
    ];
  }, [feed.activas, feed.finalizadas]);

  const openSettings = () => {
    setConnectionTest(null);
    setForm(settings);
    setScreen("configuracion");
  };

  const focusEmergency = (id: string) => {
    setSelectedId(id);
    setMapFocusRequest((current) => current + 1);
  };

  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionTest(null);
    try {
      const result = await getActive(form.backendUrl);
      setConnectionTest(
        `Conexión correcta: ${result.emergencies.length} activas y ${result.finalized.length} finalizadas.`,
      );
    } catch (error) {
      setConnectionTest(`Error de conexión: ${errorMessage(error)}`);
    } finally {
      setTestingConnection(false);
    }
  };

  const persistSettings = async () => {
    const next = {
      backendUrl: form.backendUrl.trim().replace(/\/+$/, ""),
      contactName: form.contactName.trim(),
      phone: form.phone.trim(),
    };
    if (!next.backendUrl) {
      setConnectionTest("Escribe la URL del backend antes de guardar.");
      return;
    }
    setSavingSettings(true);
    try {
      await saveSettings(next);
      setSettings(next);
      setForm(next);
      setScreen("principal");
      setConnectionTest(null);
    } catch (error) {
      setConnectionTest(`No se pudo guardar: ${errorMessage(error)}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const alertBanner = newAlert ? (
    <View style={styles.alertBanner}>
      <View style={styles.alertBannerText}>
        <Text style={styles.alertBannerTitle}>¡Nueva emergencia!</Text>
        <Text style={styles.alertBannerDescription}>{newAlert.name} necesita ayuda.</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        style={styles.alertViewButton}
        onPress={() => {
          focusEmergency(newAlert.id);
          setScreen("principal");
          setNewAlert(null);
        }}
      >
        <Text style={styles.alertViewButtonText}>Ver</Text>
      </Pressable>
    </View>
  ) : null;

  const callContact = async () => {
    if (!settings.phone.trim()) {
      openSettings();
      return;
    }
    try {
      await Linking.openURL(`tel:${settings.phone.trim()}`);
    } catch (error) {
      Alert.alert("No se pudo iniciar la llamada", errorMessage(error));
    }
  };

  const openDirections = async (emergency: Emergency) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${emergency.lat},${emergency.lng}`;
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert("No se pudo abrir el mapa", errorMessage(error));
    }
  };

  const acknowledge = async (emergency: Emergency) => {
    if (!settings.contactName.trim()) {
      openSettings();
      setAckError("Configura el nombre del contacto antes de confirmar que vas en camino.");
      return;
    }
    setAckingId(emergency.id);
    setAckError(null);
    try {
      const updated = await ack(
        settings.backendUrl,
        emergency.id,
        settings.contactName.trim(),
      );
      feed.applyEmergency(updated);
      setAcknowledgedIds((current) =>
        current.includes(emergency.id) ? current : [...current, emergency.id],
      );
    } catch (error) {
      setAckError(`No se pudo enviar el aviso: ${errorMessage(error)}`);
    } finally {
      setAckingId(null);
    }
  };

  const mainHeader = (
    <View>
      <View style={styles.topBar}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>SOS WEAR</Text>
          <Text style={styles.subtitle}>Contacto de emergencia</Text>
        </View>
        <Pressable style={styles.settingsButton} onPress={openSettings}>
          <Text style={styles.settingsButtonText}>Configuración</Text>
        </Pressable>
      </View>

      <View style={styles.connectionPanel}>
        <View
          style={[
            styles.connectionDot,
            feed.conexion === "en-vivo" && styles.connectionDotLive,
            feed.conexion === "sin-conexion" && styles.connectionDotOffline,
          ]}
        />
        <View style={styles.connectionTextBlock}>
          <Text style={styles.connectionTitle}>
            {feed.conexion === "en-vivo"
              ? "En vivo"
              : feed.conexion === "reconectando"
                ? "Reconectando"
                : "Sin conexión"}
          </Text>
          <Text style={styles.mutedText}>
            Actualizado: {formatTime(feed.ultimaActualizacion)}
          </Text>
        </View>
      </View>

      {feed.ultimoError ? (
        <Text style={styles.errorText}>{feed.ultimoError}</Text>
      ) : null}
      {permissionWarning ? (
        <Text style={styles.warningText}>{permissionWarning}</Text>
      ) : null}
      {ackError ? <Text style={styles.errorText}>{ackError}</Text> : null}

      <Text style={styles.sectionHeading}>Ubicación en tiempo real</Text>
      <EmergencyMap
        emergencies={feed.activas}
        selectedId={selectedId}
        focusRequest={mapFocusRequest}
      />
      {feed.activas.length === 0 ? (
        <Text style={styles.emptyText}>Sin alertas activas</Text>
      ) : null}
    </View>
  );

  const renderRow = ({ item }: { item: ListRow }) => {
    if (item.kind === "section") {
      return (
        <View style={styles.listSection}>
          <Text style={styles.listSectionTitle}>{item.title}</Text>
          <Text style={styles.listSectionCount}>{item.count}</Text>
        </View>
      );
    }

    const emergency = item.emergency;
    const active = emergency.status === "active";
    const hasAcknowledged =
      Boolean(emergency.acknowledgedBy) || acknowledgedIds.includes(emergency.id);
    return (
      <View style={[styles.card, !active && styles.finalizedCard]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (active) focusEmergency(emergency.id);
          }}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardHeading}>
              <Text style={styles.personName}>{emergency.name}</Text>
              <Text style={[styles.status, active ? styles.activeStatus : styles.finalizedStatus]}>
                {active ? "SOS ACTIVO" : "Finalizada"}
              </Text>
            </View>
            <Text style={styles.coordinates}>
              {emergency.lat.toFixed(5)}, {emergency.lng.toFixed(5)}
            </Text>
          </View>
          <Text style={styles.detailText}>
            Precisión: {emergency.accuracy === null ? "No disponible" : `${emergency.accuracy} m`}
          </Text>
          <Text style={styles.detailText}>
            Última ubicación: {formatTime(emergency.lastLocationAt)}
          </Text>
          {emergency.acknowledgedBy ? (
            <Text style={styles.acknowledgedText}>
              Contacto en camino: {emergency.acknowledgedBy}
            </Text>
          ) : null}
        </Pressable>
        {active ? (
          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={() => void callContact()}>
              <Text style={styles.secondaryButtonText}>Llamar</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void openDirections(emergency)}
            >
              <Text style={styles.secondaryButtonText}>Cómo llegar</Text>
            </Pressable>
            <Pressable
              disabled={hasAcknowledged || ackingId === emergency.id}
              style={[
                styles.primaryButton,
                hasAcknowledged && styles.disabledButton,
              ]}
              onPress={() => void acknowledge(emergency)}
            >
              <Text style={styles.primaryButtonText}>
                {hasAcknowledged
                  ? "Avisaste que vas en camino"
                  : ackingId === emergency.id
                    ? "Enviando..."
                    : "Voy en camino"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  if (screen === "configuracion") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.settingsPage} keyboardShouldPersistTaps="handled">
          <Pressable style={styles.backButton} onPress={() => setScreen("principal")}>
            <Text style={styles.backButtonText}>‹  Volver</Text>
          </Pressable>
          {alertBanner}
          <Text style={styles.pageTitle}>Configuración</Text>
          <Text style={styles.helpText}>
            Usa la IP de tu PC en la red Wi-Fi, no localhost.
          </Text>

          <Text style={styles.inputLabel}>URL del backend</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={DEFAULT_SETTINGS.backendUrl}
            placeholderTextColor="#777b86"
            value={form.backendUrl}
            onChangeText={(backendUrl) => setForm((current) => ({ ...current, backendUrl }))}
            style={styles.input}
          />

          <Text style={styles.inputLabel}>Nombre del contacto</Text>
          <TextInput
            maxLength={80}
            placeholder="Ej. Ana"
            placeholderTextColor="#777b86"
            value={form.contactName}
            onChangeText={(contactName) => setForm((current) => ({ ...current, contactName }))}
            style={styles.input}
          />

          <Text style={styles.inputLabel}>Teléfono de contacto / usuario</Text>
          <TextInput
            keyboardType="phone-pad"
            placeholder="Ej. +52 123 456 7890"
            placeholderTextColor="#777b86"
            value={form.phone}
            onChangeText={(phone) => setForm((current) => ({ ...current, phone }))}
            style={styles.input}
          />

          <Pressable
            disabled={testingConnection}
            style={styles.secondaryWideButton}
            onPress={() => void testConnection()}
          >
            <Text style={styles.secondaryButtonText}>
              {testingConnection ? "Probando..." : "Probar conexión"}
            </Text>
          </Pressable>
          {connectionTest ? (
            <Text
              style={
                connectionTest.startsWith("Conexión correcta")
                  ? styles.successText
                  : styles.errorText
              }
            >
              {connectionTest}
            </Text>
          ) : null}
          <Pressable
            disabled={savingSettings}
            style={styles.primaryWideButton}
            onPress={() => void persistSettings()}
          >
            <Text style={styles.primaryButtonText}>
              {savingSettings ? "Guardando..." : "Guardar"}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <StatusBar style="light" />
      <FlatList
        data={rows}
        keyExtractor={(item) =>
          item.kind === "section" ? item.id : `emergency-${item.emergency.id}`
        }
        renderItem={renderRow}
        ListHeaderComponent={mainHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#101116" },
  listContent: { paddingHorizontal: 18, paddingBottom: 36 },
  topBar: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandBlock: { gap: 2 },
  brand: { color: "#ff3347", fontSize: 19, fontWeight: "900", letterSpacing: 1.5 },
  subtitle: { color: "#a8abb5", fontSize: 13 },
  settingsButton: {
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderColor: "#363943",
    borderWidth: 1,
    borderRadius: 12,
  },
  settingsButtonText: { color: "#f4f4f6", fontSize: 12, fontWeight: "700" },
  connectionPanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "#1b1d24",
    borderRadius: 15,
    padding: 14,
    marginTop: 5,
    marginBottom: 14,
  },
  connectionDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#f2a93b" },
  connectionDotLive: { backgroundColor: "#33cf83" },
  connectionDotOffline: { backgroundColor: "#ff3347" },
  connectionTextBlock: { gap: 2 },
  connectionTitle: { color: "#f7f7f8", fontSize: 14, fontWeight: "800" },
  mutedText: { color: "#999da8", fontSize: 12 },
  sectionHeading: {
    color: "#f3f3f5",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 7,
    marginBottom: 12,
  },
  emptyText: { color: "#a8abb5", textAlign: "center", marginVertical: 18, fontSize: 14 },
  listSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 22,
    marginBottom: 10,
  },
  listSectionTitle: { color: "#f3f3f5", fontSize: 17, fontWeight: "800" },
  listSectionCount: {
    color: "#b7bac3",
    backgroundColor: "#292c35",
    minWidth: 23,
    textAlign: "center",
    overflow: "hidden",
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
  },
  card: {
    padding: 15,
    marginBottom: 11,
    borderRadius: 17,
    backgroundColor: "#1b1d24",
    borderColor: "#3b2027",
    borderWidth: 1,
  },
  finalizedCard: { borderColor: "#30323a", opacity: 0.82 },
  cardHeader: { marginBottom: 8 },
  cardHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 5,
  },
  personName: { color: "#f5f5f7", fontSize: 16, fontWeight: "800", flexShrink: 1 },
  status: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  activeStatus: { color: "#ff5263" },
  finalizedStatus: { color: "#a7a9b2" },
  coordinates: { color: "#d6d7dc", fontSize: 13, fontVariant: ["tabular-nums"] },
  detailText: { color: "#a8abb5", fontSize: 12, marginTop: 3 },
  acknowledgedText: { color: "#61d69a", fontSize: 13, fontWeight: "700", marginTop: 9 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 13,
    backgroundColor: "#2a2d36",
    borderRadius: 11,
  },
  secondaryButtonText: { color: "#f2f2f4", fontSize: 12, fontWeight: "700" },
  primaryButton: {
    flexGrow: 1,
    alignItems: "center",
    backgroundColor: "#c82137",
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 11,
  },
  primaryButtonText: { color: "#fff", fontSize: 12, fontWeight: "800", textAlign: "center" },
  disabledButton: { backgroundColor: "#344338" },
  alertBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#b51f32",
    borderRadius: 14,
    padding: 13,
    marginBottom: 16,
  },
  alertBannerText: { flex: 1, gap: 3 },
  alertBannerTitle: { color: "white", fontWeight: "900", fontSize: 15 },
  alertBannerDescription: { color: "#ffe7e9", fontSize: 12 },
  alertViewButton: { paddingVertical: 8, paddingHorizontal: 16 },
  alertViewButtonText: { color: "white", fontWeight: "900", fontSize: 14 },
  errorText: { color: "#ff8792", fontSize: 12, marginBottom: 12 },
  warningText: { color: "#ffca73", fontSize: 12, marginBottom: 12 },
  successText: { color: "#61d69a", fontSize: 13, marginTop: 12 },
  settingsPage: { paddingHorizontal: 20, paddingBottom: 36 },
  backButton: { paddingVertical: 14, alignSelf: "flex-start" },
  backButtonText: { color: "#ff6978", fontSize: 15, fontWeight: "700" },
  pageTitle: { color: "#f7f7f8", fontSize: 27, fontWeight: "900", marginTop: 9 },
  helpText: { color: "#b5b8c1", fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  inputLabel: { color: "#e3e4e8", fontSize: 13, fontWeight: "700", marginBottom: 7 },
  input: {
    color: "#fff",
    backgroundColor: "#1b1d24",
    borderColor: "#383b45",
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 49,
    paddingHorizontal: 13,
    marginBottom: 17,
    fontSize: 14,
  },
  secondaryWideButton: {
    alignItems: "center",
    borderColor: "#4a4d57",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 5,
  },
  primaryWideButton: {
    alignItems: "center",
    backgroundColor: "#c82137",
    borderRadius: 12,
    paddingVertical: 15,
    marginTop: 17,
  },
});
