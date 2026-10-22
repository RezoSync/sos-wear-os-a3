import { useEffect, useRef, type PropsWithChildren } from "react";
import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "./theme";

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatusChip({
  label,
  tone,
  pulse = false,
}: {
  label: string;
  tone: "green" | "red" | "amber" | "neutral";
  pulse?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) {
      scale.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.45, duration: 750, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 750, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, scale]);

  const color = {
    green: theme.colors.green,
    red: theme.colors.red,
    amber: theme.colors.amber,
    neutral: theme.colors.muted,
  }[tone];

  return (
    <View style={[styles.chip, { borderColor: `${color}45`, backgroundColor: `${color}18` }]}>
      <View style={styles.dotBox}>
        <Animated.View style={[styles.dot, { backgroundColor: color, transform: [{ scale }] }]} />
      </View>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export function ActionButton({
  label,
  icon,
  primary = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary ? styles.primary : styles.secondary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={17} color={theme.colors.white} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    ...theme.shadows.card,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: theme.radii.pill,
  },
  dotBox: { width: 9, height: 9, justifyContent: "center", alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: theme.typography.micro, fontWeight: "800", letterSpacing: 0.35 },
  action: {
    minHeight: 44,
    minWidth: 112,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: theme.radii.control,
  },
  primary: { backgroundColor: theme.colors.redDark },
  secondary: { backgroundColor: theme.colors.surfaceRaised, borderWidth: 1, borderColor: theme.colors.border },
  disabled: { opacity: 0.58 },
  pressed: { opacity: 0.82 },
  actionText: { color: theme.colors.white, fontSize: theme.typography.caption, fontWeight: "800" },
});
