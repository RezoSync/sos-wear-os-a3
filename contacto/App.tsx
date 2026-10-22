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
import { ActionButton, Card, StatusChip } from "./src/components";
import { EmergencyMap } from "./src/EmergencyMap";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type ContactSettings,
} from "./src/settings";
import type { Emergency } from "./src/types";
import { useSosFeed } from "./src/useSosFeed";
import { theme } from "./src/theme";

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

function formatRelative(value: string, now: number): string {
  const elapsed = Math.max(0, Math.floor((now - Date.parse(value)) / 1_000));
  if (!Number.isFinite(elapsed)) return "hora no disponible";
  if (elapsed < 60) return `hace ${elapsed} s`;
  if (elapsed < 3_600) return `hace ${Math.floor(elapsed / 60)} min`;
  return `hace ${Math.floor(elapsed / 3_600)} h`;
}

function triggerLabel(trigger: Emergency["trigger"]): string {
  switch (trigger) {
    case "voz":
      return "Voz";
    case "pulso":
      return "Pulso anómalo";
    case "carrera":
      return "Carrera";
    default:
      return "Manual";
  }
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
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

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
        title: `¡SOS ${triggerLabel(emergency.trigger)} de ${emergency.name}!`,
        body: `Motivo: ${triggerLabel(emergency.trigger)} · ${emergency.lat.toFixed(5)}, ${emergency.lng.toFixed(5)}`,
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
        <Text style={styles.alertBannerDescription}>
          {triggerLabel(newAlert.trigger)} · {newAlert.name} necesita ayuda.
        </Text>
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
        <View style={styles.connectionTextBlock}>
          <StatusChip
            label={feed.conexion === "en-vivo" ? "En vivo" :
              feed.conexion === "reconectando" ? "Reconectando" : "Sin conexión"}
            tone={feed.conexion === "en-vivo" ? "green" :
              feed.conexion === "reconectando" ? "amber" : "red"}
            pulse={feed.conexion === "en-vivo"}
          />
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
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>◉</Text>
          <Text style={styles.emptyText}>Sin alertas activas</Text>
          <Text style={styles.mutedText}>Las nuevas emergencias aparecerán aquí.</Text>
        </View>
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
      <Card style={!active && styles.finalizedCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (active) focusEmergency(emergency.id);
          }}
        >
          <View style={styles.cardHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{emergency.name.trim().charAt(0).toLocaleUpperCase()}</Text>
            </View>
            <View style={styles.cardHeading}>
              <Text style={styles.personName}>{emergency.name}</Text>
              <View style={styles.chipRow}>
                <StatusChip
                  label={active ? "SOS ACTIVO" : "Finalizada"}
                  tone={active ? "red" : "neutral"}
                  pulse={active}
                />
                <StatusChip label={triggerLabel(emergency.trigger)} tone="amber" />
              </View>
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
          <Text style={styles.relativeTime}>
            {formatRelative(emergency.lastLocationAt, now)}
          </Text>
          {emergency.acknowledgedBy ? (
            <Text style={styles.acknowledgedText}>
              Contacto en camino: {emergency.acknowledgedBy}
            </Text>
          ) : null}
        </Pressable>
        {active ? (
          <View style={styles.actions}>
            <ActionButton label="Llamar" icon="call-outline" onPress={() => void callContact()} />
            <ActionButton label="Cómo llegar" icon="navigate-outline" onPress={() => void openDirections(emergency)} />
            <ActionButton
              label={hasAcknowledged ? "En camino" : ackingId === emergency.id ? "Enviando…" : "Voy en camino"}
              icon="checkmark-circle-outline"
              primary
              disabled={hasAcknowledged || ackingId === emergency.id}
              onPress={() => void acknowledge(emergency)}
            />
          </View>
        ) : null}
      </Card>
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

          <Text style={styles.settingsSectionTitle}>Backend</Text>
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

          <Text style={styles.settingsSectionTitle}>Contacto</Text>
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

          <Text style={styles.settingsSectionTitle}>Conectividad</Text>
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
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  listContent: { paddingHorizontal: 18, paddingBottom: 36 },
  topBar: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandBlock: { gap: 2 },
  brand: { color: theme.colors.red, fontSize: 19, fontWeight: "900", letterSpacing: 1.5 },
  subtitle: { color: theme.colors.muted, fontSize: 13 },
  settingsButton: {
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
  },
  settingsButtonText: { color: "#f4f4f6", fontSize: 12, fontWeight: "700" },
  connectionPanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    padding: 14,
    marginTop: 5,
    marginBottom: 14,
  },
  connectionTextBlock: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flex: 1, gap: 8 },
  mutedText: { color: theme.colors.muted, fontSize: 12 },
  sectionHeading: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 7,
    marginBottom: 12,
  },
  emptyState: { alignItems: "center", paddingVertical: 20, marginTop: 8, marginBottom: 6, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.card, backgroundColor: theme.colors.surface },
  emptyIcon: { color: theme.colors.muted, fontSize: 28, marginBottom: 6 },
  emptyText: { color: theme.colors.text, textAlign: "center", marginBottom: 5, fontSize: 14, fontWeight: "700" },
  listSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 22,
    marginBottom: 10,
  },
  listSectionTitle: {   color: theme.colors.text, fontSize: 17, fontWeight: "800" },
  listSectionCount: {
    color: "#b7bac3",
    backgroundColor: theme.colors.surfaceRaised,
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
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  finalizedCard: { borderColor: theme.colors.border, opacity: 0.82 },
  cardHeader: { marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 45, height: 45, borderRadius: 23, backgroundColor: `${theme.colors.red}22`, borderWidth: 1, borderColor: `${theme.colors.red}66`, alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.colors.red, fontSize: 20, fontWeight: "900" },
  cardHeading: {
    flex: 1,
    gap: 7,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  personName: { color: theme.colors.text, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  status: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  activeStatus: { color: theme.colors.red },
  finalizedStatus: { color: theme.colors.muted },
  coordinates: { color: "#D6DAE2", fontSize: 13, fontVariant: ["tabular-nums"] },
  detailText: { color: theme.colors.muted, fontSize: 12, marginTop: 3 },
  relativeTime: { color: theme.colors.amber, fontSize: 11, marginTop: 4 },
  acknowledgedText: { color: theme.colors.green, fontSize: 13, fontWeight: "700", marginTop: 9 },
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
    backgroundColor: theme.colors.redDark,
    borderRadius: theme.radii.control,
    padding: 13,
    marginBottom: 16,
  },
  alertBannerText: { flex: 1, gap: 3 },
  alertBannerTitle: { color: "white", fontWeight: "900", fontSize: 15 },
  alertBannerDescription: { color: "#ffe7e9", fontSize: 12 },
  alertViewButton: { paddingVertical: 8, paddingHorizontal: 16 },
  alertViewButtonText: { color: "white", fontWeight: "900", fontSize: 14 },
  errorText: { color: theme.colors.red, fontSize: 12, marginBottom: 12 },
  warningText: { color: theme.colors.amber, fontSize: 12, marginBottom: 12 },
  successText: { color: theme.colors.green, fontSize: 13, marginTop: 12 },
  settingsPage: { paddingHorizontal: 20, paddingBottom: 36 },
  backButton: { paddingVertical: 14, alignSelf: "flex-start" },
  backButtonText: { color: "#ff6978", fontSize: 15, fontWeight: "700" },
  pageTitle: { color: theme.colors.text, fontSize: 27, fontWeight: "900", marginTop: 9 },
  helpText: { color: theme.colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  settingsSectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "800", marginTop: 8, marginBottom: 13 },
  inputLabel: { color: theme.colors.text, fontSize: 13, fontWeight: "700", marginBottom: 7 },
  input: {
    color: "#fff",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
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
    backgroundColor: theme.colors.redDark,
    borderRadius: 12,
    paddingVertical: 15,
    marginTop: 17,
  },
});
